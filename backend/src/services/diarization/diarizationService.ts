import { ContractViolationError, DiarizationFailedError, NameMappingServiceError } from './errors';
import { recordAuditEvent } from './auditLog';
import {
  Attendee,
  DiarizationClient,
  DiarizedSegment,
  NameMappingClient,
  RawSpeakerSegment,
  SpeakerMapping,
  UNIDENTIFIED_SPEAKER_LABEL,
} from './types';
import { Transcript, TranscriptSegment } from '../transcription/types';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface DiarizationLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: DiarizationLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.transcriptId === 'string' ? context.transcriptId : 'unresolved',
      context,
    });
  },
};

/**
 * Speaker mappings keyed by the source transcript's id, so re-diarizing the same transcript
 * is a no-op instead of calling the (paid) providers twice.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, SpeakerMapping>();

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableUpstreamError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError;
}

function hasValidBounds(segment: RawSpeakerSegment): boolean {
  return (
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.startMs >= 0 &&
    segment.endMs > segment.startMs
  );
}

/** Confirms the diarization provider returned a well-formed array before anything else touches it. */
function validateRawSegments(raw: RawSpeakerSegment[], transcriptId: string): RawSpeakerSegment[] {
  if (!Array.isArray(raw)) {
    throw new ContractViolationError('Diarization provider did not return an array of segments', { transcriptId });
  }
  for (const segment of raw) {
    if (typeof segment.speakerTag !== 'string' || segment.speakerTag.length === 0) {
      throw new ContractViolationError('Diarization segment is missing its speaker tag', { transcriptId, segment });
    }
    if (!hasValidBounds(segment)) {
      throw new ContractViolationError(
        `Diarization segment has invalid timestamps (startMs=${segment.startMs}, endMs=${segment.endMs})`,
        { transcriptId, segment }
      );
    }
  }
  return raw;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Attributes each transcript segment to whichever raw speaker segment overlaps it the most.
 * A transcript segment with no diarization coverage at all (a gap the provider left) gets the
 * "UNKNOWN" tag rather than failing the whole run — one uncovered segment shouldn't invalidate
 * an otherwise-good diarization.
 */
function assignSpeakerTag(segment: TranscriptSegment, rawSegments: RawSpeakerSegment[]): string {
  let bestTag = 'UNKNOWN';
  let bestOverlap = 0;
  for (const raw of rawSegments) {
    const overlap = overlapMs(segment.startMs, segment.endMs, raw.startMs, raw.endMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestTag = raw.speakerTag;
    }
  }
  return bestTag;
}

function recordFailure(transcriptId: string, event: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId: transcriptId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Resolves raw speaker tags to attendee names, degrading deterministically rather than
 * failing the whole diarization: a mapping-service failure or an unrecognized name both
 * result in `UNIDENTIFIED_SPEAKER_LABEL` for the affected tag(s), never a guess.
 */
async function resolveSpeakerNames(
  transcriptId: string,
  speakerTags: string[],
  attendees: Attendee[],
  client: NameMappingClient,
  retryOptions: { timeoutMs: number; maxAttempts: number; backoffMs?: (attempt: number) => number }
): Promise<Record<string, string>> {
  if (attendees.length === 0 || speakerTags.length === 0) {
    return {};
  }

  let rawMap: Record<string, string>;
  try {
    rawMap = await withTimeoutAndRetry(() => client.mapSpeakersToNames(speakerTags, attendees), {
      ...retryOptions,
      isRetryable: isRetryableUpstreamError,
      operationName: `diarization.mapSpeakersToNames(${transcriptId})`,
    });
  } catch (error) {
    recordFailure(transcriptId, 'name_mapping_failed', error instanceof Error ? error : new NameMappingServiceError(String(error)));
    return {};
  }

  const attendeeNames = new Set(attendees.map((attendee) => attendee.name));
  const validatedMap: Record<string, string> = {};
  for (const [tag, name] of Object.entries(rawMap)) {
    if (attendeeNames.has(name)) {
      validatedMap[tag] = name;
    } else {
      recordFailure(
        transcriptId,
        'incorrect_speaker_mapping',
        new NameMappingServiceError(`Name mapping returned "${name}" for tag "${tag}", which is not on the attendee list`, {
          transcriptId,
          tag,
          name,
        })
      );
    }
  }
  return validatedMap;
}

export interface DiarizeOptions {
  diarizationClient: DiarizationClient;
  nameMappingClient: NameMappingClient;
  logger?: DiarizationLogger;
  idempotencyStore?: Map<string, SpeakerMapping>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
}

/**
 * Diarizes a transcript's source audio and maps the resulting speakers to attendee names
 * (REQ-006), deduping on `transcript.id` so re-diarizing the same transcript never re-calls
 * either provider. Failure paths: the diarization provider fails or times out after retries
 * (`DiarizationFailedError` — no fallback exists without speaker boundaries, so this throws);
 * the provider returns a malformed response (`ContractViolationError`); the name-mapping
 * service fails or times out (caught internally — every speaker degrades to
 * `UNIDENTIFIED_SPEAKER_LABEL` rather than failing the whole result); a mapping response names
 * someone not on the attendee list (dropped, not trusted — same fallback). Every attempt,
 * dedup hit, success, and failure is recorded to the audit trail.
 */
export async function diarizeAndMapSpeakers(
  transcript: Transcript,
  buffer: Buffer,
  attendees: Attendee[],
  {
    diarizationClient,
    nameMappingClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
  }: DiarizeOptions
): Promise<SpeakerMapping> {
  const existing = idempotencyStore.get(transcript.id);
  if (existing) {
    logger.info('diarization_deduplicated', { transcriptId: transcript.id });
    return existing;
  }

  logger.info('diarization_attempted', {
    transcriptId: transcript.id,
    segmentCount: transcript.segments.length,
    attendeeCount: attendees.length,
  });

  let rawSegments: RawSpeakerSegment[];
  try {
    const result = await withTimeoutAndRetry(() => diarizationClient.diarize({ audioId: transcript.audioId, buffer }), {
      timeoutMs,
      maxAttempts,
      backoffMs,
      isRetryable: isRetryableUpstreamError,
      operationName: `diarization.diarize(${transcript.audioId})`,
    });
    rawSegments = validateRawSegments(result, transcript.id);
  } catch (error) {
    const wrapped =
      error instanceof ContractViolationError
        ? error
        : new DiarizationFailedError(error instanceof Error ? error.message : String(error), { transcriptId: transcript.id });
    recordFailure(transcript.id, 'diarization_failed', wrapped);
    throw wrapped;
  }

  const rawTagsInUse = Array.from(new Set(transcript.segments.map((segment) => assignSpeakerTag(segment, rawSegments)))).filter(
    (tag) => tag !== 'UNKNOWN'
  );

  const nameByTag = await resolveSpeakerNames(transcript.id, rawTagsInUse, attendees, nameMappingClient, {
    timeoutMs,
    maxAttempts,
    backoffMs,
  });

  const segments: DiarizedSegment[] = transcript.segments.map((segment) => {
    const rawSpeakerTag = assignSpeakerTag(segment, rawSegments);
    return {
      ...segment,
      rawSpeakerTag,
      speakerLabel: nameByTag[rawSpeakerTag] ?? UNIDENTIFIED_SPEAKER_LABEL,
    };
  });

  const mapping: SpeakerMapping = {
    id: transcript.id,
    transcriptId: transcript.id,
    segments,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(transcript.id, mapping);
  logger.info('diarization_completed', {
    transcriptId: transcript.id,
    speakerCount: new Set(segments.map((segment) => segment.speakerLabel)).size,
  });

  return mapping;
}

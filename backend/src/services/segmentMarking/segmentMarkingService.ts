import { ContractViolationError } from './errors';
import { recordAuditEvent } from './auditLog';
import {
  INAUDIBLE_CONFIDENCE_THRESHOLD,
  INAUDIBLE_LABEL,
  MarkedSegment,
  MarkedTranscript,
  SegmentAudibility,
  UNCLEAR_CONFIDENCE_THRESHOLD,
  UNCLEAR_LABEL,
} from './types';
import { Transcript, TranscriptSegment } from '../transcription/types';

export interface SegmentMarkingLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: SegmentMarkingLogger = {
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
 * Marked transcripts keyed by the source transcript's id, so re-marking the same transcript is
 * a no-op.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, MarkedTranscript>();

function recordFailure(transcriptId: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event: 'segment_marking_failed',
    outcome: 'failure',
    resourceId: transcriptId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/** Rejects a segment this logic cannot safely judge, rather than guessing an audibility for it. */
function validateSegment(segment: TranscriptSegment, transcriptId: string): void {
  if (typeof segment.text !== 'string') {
    throw new ContractViolationError('Segment is missing its text', { transcriptId, segment });
  }
  if (
    segment.confidence !== undefined &&
    (!Number.isFinite(segment.confidence) || segment.confidence < 0 || segment.confidence > 1)
  ) {
    throw new ContractViolationError(`Segment has an out-of-range confidence (${segment.confidence})`, {
      transcriptId,
      segment,
    });
  }
}

/**
 * Judges one segment's audibility (REQ-007). See `types.ts`'s `SegmentAudibility` doc for why
 * two independent signals feed this: empty/whitespace text is a direct provider-independent
 * "couldn't be heard" signal; `confidence` bands apply only when a provider supplies one. A
 * segment with neither signal tripped is `clear` — absence of trouble is never guessed into
 * `unclear`.
 */
function judgeAudibility(segment: TranscriptSegment): SegmentAudibility {
  if (segment.text.trim().length === 0) {
    return 'inaudible';
  }
  if (segment.confidence === undefined) {
    return 'clear';
  }
  if (segment.confidence < INAUDIBLE_CONFIDENCE_THRESHOLD) {
    return 'inaudible';
  }
  if (segment.confidence < UNCLEAR_CONFIDENCE_THRESHOLD) {
    return 'unclear';
  }
  return 'clear';
}

function labelFor(audibility: SegmentAudibility): string | undefined {
  if (audibility === 'inaudible') {
    return INAUDIBLE_LABEL;
  }
  if (audibility === 'unclear') {
    return UNCLEAR_LABEL;
  }
  return undefined;
}

export interface MarkSegmentsOptions {
  logger?: SegmentMarkingLogger;
  idempotencyStore?: Map<string, MarkedTranscript>;
}

/**
 * Marks each segment of a transcript as `[inaudible]`, `[unclear — verify]`, or leaves it
 * unmarked (REQ-007), deduping on `transcript.id` so re-marking the same transcript is a no-op.
 * Unlike transcription/diarization, this makes no external call — it judges audibility purely
 * from data the transcript already carries, so there's no timeout/retry to wrap. Failure path:
 * malformed input (`ContractViolationError` — a non-array `segments`, non-string `text`, or an
 * out-of-range `confidence`) fails the whole transcript rather than shipping a guessed mark.
 * Every attempt, dedup hit, success, and failure is recorded to the audit trail.
 */
export function markSegments(
  transcript: Transcript,
  { logger = defaultLogger, idempotencyStore = defaultIdempotencyStore }: MarkSegmentsOptions = {}
): MarkedTranscript {
  const existing = idempotencyStore.get(transcript.id);
  if (existing) {
    logger.info('segment_marking_deduplicated', { transcriptId: transcript.id });
    return existing;
  }

  logger.info('segment_marking_attempted', {
    transcriptId: transcript.id,
    segmentCount: transcript.segments.length,
  });

  if (!Array.isArray(transcript.segments)) {
    const error = new ContractViolationError('Transcript did not contain an array of segments', {
      transcriptId: transcript.id,
    });
    recordFailure(transcript.id, error);
    throw error;
  }

  let segments: MarkedSegment[];
  try {
    segments = transcript.segments.map((segment) => {
      validateSegment(segment, transcript.id);
      const audibility = judgeAudibility(segment);
      const marker = labelFor(audibility);
      return { ...segment, audibility, ...(marker ? { marker } : {}) };
    });
  } catch (error) {
    recordFailure(transcript.id, error);
    throw error;
  }

  const marked: MarkedTranscript = {
    id: transcript.id,
    transcriptId: transcript.id,
    segments,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(transcript.id, marked);

  logger.info('segment_marking_completed', {
    transcriptId: transcript.id,
    segmentCount: segments.length,
    inaudibleCount: segments.filter((s) => s.audibility === 'inaudible').length,
    unclearCount: segments.filter((s) => s.audibility === 'unclear').length,
  });

  return marked;
}

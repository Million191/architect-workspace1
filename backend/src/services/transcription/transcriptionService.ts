import { AudioDecodingError, ContractViolationError, TimestampMisalignmentError } from './errors';
import { recordAuditEvent } from './auditLog';
import { RawTranscriptSegment, Transcript, TranscriptionClient, TranscriptionInput, TranscriptSegment } from './types';
import { SupportedAudioFormat } from '../audioIngestion/types';
import { sniffAudioFormat } from '../audioIngestion/audioFormatSniffer';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface TranscriptionLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: TranscriptionLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.audioId === 'string' ? context.audioId : 'unresolved',
      context,
    });
  },
};

/**
 * Transcripts keyed by the source audio's id, so re-transcribing the same audio is a no-op
 * instead of calling the (paid) provider twice.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, Transcript>();

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableTranscriptionError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError;
}

/** A segment's bounds are only trustworthy if both are finite, non-negative, and end strictly after start. */
function hasValidBounds(segment: RawTranscriptSegment): boolean {
  return (
    Number.isFinite(segment.startMs) &&
    Number.isFinite(segment.endMs) &&
    segment.startMs >= 0 &&
    segment.endMs > segment.startMs
  );
}

/**
 * Confirms every segment's timestamps are individually valid and that segments run in
 * chronological, non-overlapping order — the shape REQ-005's "follow the meeting timeline"
 * acceptance criterion depends on. Never fabricates or repairs a bad timestamp; a provider
 * that returns misaligned segments fails the whole transcript rather than shipping one that
 * silently misrepresents the timeline.
 */
function validateSegments(raw: RawTranscriptSegment[], audioId: string): TranscriptSegment[] {
  if (!Array.isArray(raw)) {
    throw new ContractViolationError('Transcription provider did not return an array of segments', { audioId });
  }

  let previousEndMs = -1;
  for (const segment of raw) {
    if (typeof segment.text !== 'string') {
      throw new ContractViolationError('Transcription segment is missing its text', { audioId, segment });
    }
    if (!hasValidBounds(segment)) {
      throw new TimestampMisalignmentError(
        `Segment has invalid timestamps (startMs=${segment.startMs}, endMs=${segment.endMs})`,
        { audioId, segment }
      );
    }
    if (segment.startMs < previousEndMs) {
      throw new TimestampMisalignmentError(
        `Segment starting at ${segment.startMs}ms overlaps the previous segment, which ended at ${previousEndMs}ms`,
        { audioId, segment, previousEndMs }
      );
    }
    previousEndMs = segment.endMs;
  }

  return raw.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }));
}

export interface TranscribeOptions {
  client: TranscriptionClient;
  logger?: TranscriptionLogger;
  idempotencyStore?: Map<string, Transcript>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
}

function recordFailure(audioId: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event: 'transcription_failed',
    outcome: 'failure',
    resourceId: audioId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Transcribes audio into a timestamped transcript (REQ-005), deduping on `audioId` so
 * re-transcribing the same audio never re-calls the provider. Failure paths: the audio's
 * bytes don't match its claimed format (`AudioDecodingError` — corrupted/truncated file,
 * checked before any provider call is made); the provider times out (`UpstreamTimeoutError`,
 * retried up to `maxAttempts` with capped backoff); the provider returns a malformed
 * response (`ContractViolationError`) or timestamps that don't hold up
 * (`TimestampMisalignmentError`). Every attempt, dedup hit, success, and failure is recorded
 * to the audit trail.
 */
export async function transcribeAudio(
  audioId: string,
  format: SupportedAudioFormat,
  buffer: Buffer,
  {
    client,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
  }: TranscribeOptions
): Promise<Transcript> {
  const existing = idempotencyStore.get(audioId);
  if (existing) {
    logger.info('transcription_deduplicated', { audioId });
    return existing;
  }

  logger.info('transcription_attempted', { audioId, format, sizeBytes: buffer.length });

  const sniffed = sniffAudioFormat(buffer);
  if (sniffed === null || sniffed !== format) {
    const error = new AudioDecodingError(
      sniffed === null
        ? `Audio for "${audioId}" claims to be ${format} but its bytes don't match any known audio format signature`
        : `Audio for "${audioId}" claims to be ${format} but its bytes look like ${sniffed}`,
      { audioId, claimedFormat: format, sniffedFormat: sniffed }
    );
    recordFailure(audioId, error);
    throw error;
  }

  const input: TranscriptionInput = { audioId, format, buffer };

  let rawSegments: RawTranscriptSegment[];
  try {
    rawSegments = await withTimeoutAndRetry(() => client.transcribe(input), {
      timeoutMs,
      maxAttempts,
      backoffMs,
      isRetryable: isRetryableTranscriptionError,
      operationName: `transcription.transcribe(${audioId})`,
    });
  } catch (error) {
    recordFailure(audioId, error);
    throw error;
  }

  let segments: TranscriptSegment[];
  try {
    segments = validateSegments(rawSegments, audioId);
  } catch (error) {
    recordFailure(audioId, error);
    throw error;
  }

  const transcript: Transcript = {
    id: audioId,
    audioId,
    segments,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(audioId, transcript);
  logger.info('transcription_completed', { audioId, segmentCount: segments.length });

  return transcript;
}

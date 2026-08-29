import { ContractViolationError, IncorrectTopicGroupingError, TopicSummarizationFailedError } from './errors';
import { recordAuditEvent } from './auditLog';
import { DiscussionSummary, DiscussionTopic, RawTopicSegment, SummarizeDiscussionInput, TopicSummarizationClient } from './types';
import { INAUDIBLE_LABEL, MarkedSegment, MarkedTranscript, UNCLEAR_LABEL } from '../segmentMarking/types';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface DiscussionSummaryLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: DiscussionSummaryLogger = {
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
 * Discussion summaries keyed by the source transcript's id, so re-summarizing the same
 * transcript never re-calls the (paid) topic-summarization provider.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, DiscussionSummary>();

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableUpstreamError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError;
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
 * Rejects input this logic cannot safely extract discussion points from, rather than guessing
 * topics from data that doesn't hold up. This is the story's "discussion point extraction
 * failure" failure path.
 */
function validateInput(input: SummarizeDiscussionInput): MarkedTranscript {
  const markedTranscript = input?.markedTranscript;
  if (typeof markedTranscript?.transcriptId !== 'string' || markedTranscript.transcriptId.length === 0) {
    throw new ContractViolationError('MarkedTranscript is missing its transcriptId', { markedTranscript });
  }
  if (!Array.isArray(markedTranscript.segments) || markedTranscript.segments.length === 0) {
    throw new ContractViolationError('MarkedTranscript.segments must be a non-empty array', {
      transcriptId: markedTranscript.transcriptId,
    });
  }
  markedTranscript.segments.forEach((segment: MarkedSegment, index: number) => {
    if (typeof segment?.text !== 'string') {
      throw new ContractViolationError(`Segment at index ${index} has non-string text`, {
        transcriptId: markedTranscript.transcriptId,
        index,
      });
    }
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.endMs <= segment.startMs) {
      throw new ContractViolationError(
        `Segment at index ${index} has invalid timestamps (startMs=${segment.startMs}, endMs=${segment.endMs})`,
        { transcriptId: markedTranscript.transcriptId, index }
      );
    }
  });
  return markedTranscript;
}

/**
 * Confirms the provider's topic ranges are individually well-formed: a non-empty label and a
 * valid, positive-length time range. This is a prerequisite check before the coverage check
 * below can even compare ranges against each other.
 */
function hasValidTopicShape(raw: RawTopicSegment): boolean {
  return (
    typeof raw.topic === 'string' &&
    raw.topic.length > 0 &&
    typeof raw.summary === 'string' &&
    raw.summary.length > 0 &&
    Number.isFinite(raw.startMs) &&
    Number.isFinite(raw.endMs) &&
    raw.endMs > raw.startMs
  );
}

/**
 * Confirms the provider's topic ranges validly cover the transcript's segments — in order,
 * contiguous, with no gap or overlap between consecutive topics, spanning exactly from the
 * first segment's start to the last segment's end. This is the story's "incorrect topic
 * grouping" failure path: a provider that drops time (a gap), double-counts it (an overlap),
 * or returns topics out of order produces a summary that silently loses or duplicates
 * discussion, so this rejects the whole response rather than shipping it.
 */
function validateTopicCoverage(rawTopics: RawTopicSegment[], segments: MarkedSegment[], transcriptId: string): RawTopicSegment[] {
  if (!Array.isArray(rawTopics) || rawTopics.length === 0) {
    throw new IncorrectTopicGroupingError('Topic-summarization provider did not return any topics', { transcriptId });
  }
  for (const raw of rawTopics) {
    if (!hasValidTopicShape(raw)) {
      throw new IncorrectTopicGroupingError('Topic-summarization provider returned a malformed topic', { transcriptId, raw });
    }
  }

  const expectedStart = segments[0].startMs;
  const expectedEnd = segments[segments.length - 1].endMs;

  if (rawTopics[0].startMs !== expectedStart) {
    throw new IncorrectTopicGroupingError(
      `Topic coverage does not start at the transcript's first segment (expected ${expectedStart}, got ${rawTopics[0].startMs})`,
      { transcriptId }
    );
  }
  if (rawTopics[rawTopics.length - 1].endMs !== expectedEnd) {
    throw new IncorrectTopicGroupingError(
      `Topic coverage does not end at the transcript's last segment (expected ${expectedEnd}, got ${rawTopics[rawTopics.length - 1].endMs})`,
      { transcriptId }
    );
  }
  for (let i = 1; i < rawTopics.length; i++) {
    if (rawTopics[i].startMs !== rawTopics[i - 1].endMs) {
      throw new IncorrectTopicGroupingError(
        `Topic ranges are not contiguous between index ${i - 1} and ${i} (gap or overlap detected)`,
        { transcriptId, previous: rawTopics[i - 1], next: rawTopics[i] }
      );
    }
  }

  return rawTopics;
}

/**
 * Builds the final topic list from validated ranges: assigns each transcript segment to the
 * topic range containing its start time, then folds in STORY-007's audibility marking — any
 * segment marked `unclear`/`inaudible` inside a topic's range flags that topic for review,
 * satisfying the "flag unclear discussion points for review" criterion without re-deriving
 * audibility.
 */
function buildTopics(rawTopics: RawTopicSegment[], segments: MarkedSegment[]): DiscussionTopic[] {
  return rawTopics.map((raw) => {
    const segmentsInRange = segments.filter((segment) => segment.startMs >= raw.startMs && segment.startMs < raw.endMs);
    const flagReasons = segmentsInRange
      .filter((segment) => segment.audibility !== 'clear')
      .map((segment) => segment.marker ?? (segment.audibility === 'inaudible' ? INAUDIBLE_LABEL : UNCLEAR_LABEL));

    return {
      topic: raw.topic,
      startMs: raw.startMs,
      endMs: raw.endMs,
      summary: raw.summary,
      flaggedForReview: flagReasons.length > 0,
      flagReasons,
    };
  });
}

export interface SummarizeDiscussionOptions {
  topicSummarizationClient: TopicSummarizationClient;
  logger?: DiscussionSummaryLogger;
  idempotencyStore?: Map<string, DiscussionSummary>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
}

/**
 * Summarizes a meeting's key discussion points grouped by topic with timestamp references
 * (REQ-009), deduping on `markedTranscript.transcriptId` so re-summarizing the same transcript
 * never re-calls the (paid) topic-summarization provider. Failure paths: malformed input
 * (`ContractViolationError` — missing transcript id, non-array segments, invalid segment
 * text/timestamps); the provider succeeding but returning ranges that don't validly cover the
 * transcript (`IncorrectTopicGroupingError` — out of order, overlapping, or gapped); the
 * provider failing or timing out after exhausting retries (`TopicSummarizationFailedError` — no
 * heuristic fallback exists for topic grouping, same seam STORY-005/006 left open). Segments
 * STORY-007 marked `unclear`/`inaudible` flag their containing topic for review. Every attempt,
 * dedup hit, success, and failure is recorded to the audit trail.
 */
export async function summarizeDiscussionPoints(
  input: SummarizeDiscussionInput,
  {
    topicSummarizationClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
  }: SummarizeDiscussionOptions
): Promise<DiscussionSummary> {
  // Best-effort id for logging/dedup only — real validation (including that this is actually a
  // string) happens inside the try block below, so a malformed transcriptId still gets audited.
  const transcriptId = input?.markedTranscript?.transcriptId;

  const existing = typeof transcriptId === 'string' ? idempotencyStore.get(transcriptId) : undefined;
  if (existing) {
    logger.info('discussion_summary_deduplicated', { transcriptId });
    return existing;
  }

  logger.info('discussion_summary_attempted', {
    transcriptId,
    segmentCount: Array.isArray(input?.markedTranscript?.segments) ? input.markedTranscript.segments.length : undefined,
  });

  let topics: DiscussionTopic[];
  let validatedTranscriptId: string;
  try {
    const markedTranscript = validateInput(input);
    validatedTranscriptId = markedTranscript.transcriptId;
    const segments = markedTranscript.segments;
    const rawTopics = await withTimeoutAndRetry(
      () =>
        topicSummarizationClient.summarizeTopics({
          transcriptId: markedTranscript.transcriptId,
          segments: segments.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
        }),
      {
        timeoutMs,
        maxAttempts,
        backoffMs,
        isRetryable: isRetryableUpstreamError,
        operationName: `discussionSummary.summarizeTopics(${markedTranscript.transcriptId})`,
      }
    );
    topics = buildTopics(validateTopicCoverage(rawTopics, segments, markedTranscript.transcriptId), segments);
  } catch (error) {
    const resolvedId = typeof transcriptId === 'string' ? transcriptId : 'unresolved';
    if (error instanceof ContractViolationError || error instanceof IncorrectTopicGroupingError) {
      recordFailure(resolvedId, error instanceof ContractViolationError ? 'discussion_extraction_failed' : 'incorrect_topic_grouping', error);
      throw error;
    }
    const wrapped =
      error instanceof TopicSummarizationFailedError
        ? error
        : new TopicSummarizationFailedError(error instanceof Error ? error.message : String(error), { transcriptId: resolvedId });
    recordFailure(resolvedId, 'discussion_summary_failed', wrapped);
    throw wrapped;
  }

  const summary: DiscussionSummary = {
    id: validatedTranscriptId,
    transcriptId: validatedTranscriptId,
    topics,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(validatedTranscriptId, summary);
  logger.info('discussion_summary_completed', {
    transcriptId: validatedTranscriptId,
    topicCount: topics.length,
    flaggedTopicCount: topics.filter((topic) => topic.flaggedForReview).length,
    topics: topics.map((topic) => ({ topic: topic.topic, startMs: topic.startMs, endMs: topic.endMs, flaggedForReview: topic.flaggedForReview })),
  });

  return summary;
}

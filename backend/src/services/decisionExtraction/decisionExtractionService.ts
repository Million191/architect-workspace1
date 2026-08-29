import { ContractViolationError, DecisionExtractionFailedError, IncorrectDecisionListingError } from './errors';
import { recordAuditEvent } from './auditLog';
import { Decision, DecisionExtractionClient, DecisionListing, ListDecisionsInput, RawDecision } from './types';
import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface DecisionExtractionLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: DecisionExtractionLogger = {
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
 * Decision listings keyed by the source transcript's id, so re-listing the same transcript never
 * re-calls the (paid) decision-extraction provider.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, DecisionListing>();

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
 * Rejects input this logic cannot safely extract decisions from, rather than guessing decisions
 * from data that doesn't hold up. This is the story's "decision extraction failure" failure path
 * at the input boundary.
 */
function validateInput(input: ListDecisionsInput): MarkedTranscript {
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
 * Confirms the provider's response is a well-formed array of decisions with a non-empty
 * `decision` label, and that any `timestampMs` a decision does carry falls within the
 * transcript's own segment span. This is the story's "incorrect decision listing" failure path:
 * the provider call succeeded, but its shape can't be trusted to build a listing from — a
 * fabricated or misaligned timestamp is worse than a missing one, so this fails the whole
 * operation rather than shipping a listing that silently lies about when a decision was made.
 * A decision missing `rationale`/`approver`/`timestampMs` entirely is NOT rejected here — that's
 * the separate "missing decision fields" path, handled by `buildDecisions` as a per-decision flag.
 */
function validateDecisionListing(rawDecisions: RawDecision[], segments: MarkedSegment[], transcriptId: string): RawDecision[] {
  if (!Array.isArray(rawDecisions)) {
    throw new IncorrectDecisionListingError('Decision-extraction provider did not return an array of decisions', { transcriptId });
  }

  const expectedStart = segments[0].startMs;
  const expectedEnd = segments[segments.length - 1].endMs;

  rawDecisions.forEach((raw, index) => {
    if (typeof raw?.decision !== 'string' || raw.decision.length === 0) {
      throw new IncorrectDecisionListingError(`Decision at index ${index} is missing its decision text`, { transcriptId, index });
    }
    if (raw.timestampMs !== undefined) {
      if (!Number.isFinite(raw.timestampMs) || raw.timestampMs < expectedStart || raw.timestampMs > expectedEnd) {
        throw new IncorrectDecisionListingError(
          `Decision at index ${index} has a timestamp outside the transcript's span (expected ${expectedStart}-${expectedEnd}, got ${raw.timestampMs})`,
          { transcriptId, index }
        );
      }
    }
  });

  return rawDecisions;
}

/**
 * Builds the final decision list from a validated (but not necessarily complete) provider
 * response: any decision missing `rationale`, `approver`, or `timestampMs` is listed anyway, with
 * those gaps named in `missingFields` and `flaggedForReview` set — satisfying the "flag missing
 * fields for review" acceptance criterion without dropping the decision from the minutes.
 */
function buildDecisions(rawDecisions: RawDecision[]): Decision[] {
  return rawDecisions.map((raw) => {
    const missingFields: Decision['missingFields'] = [];
    if (!raw.rationale) missingFields.push('rationale');
    if (!raw.approver) missingFields.push('approver');
    if (raw.timestampMs === undefined) missingFields.push('timestampMs');

    return {
      decision: raw.decision,
      rationale: raw.rationale,
      approver: raw.approver,
      timestampMs: raw.timestampMs,
      missingFields,
      flaggedForReview: missingFields.length > 0,
    };
  });
}

export interface ListDecisionsOptions {
  decisionExtractionClient: DecisionExtractionClient;
  logger?: DecisionExtractionLogger;
  idempotencyStore?: Map<string, DecisionListing>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
}

/**
 * Lists a meeting's decisions with rationale, approver, and timestamp (REQ-010), deduping on
 * `markedTranscript.transcriptId` so re-listing the same transcript never re-calls the (paid)
 * decision-extraction provider. Failure paths: malformed input (`ContractViolationError` —
 * missing transcript id, non-array segments, invalid segment text/timestamps); the provider
 * succeeding but returning a listing that can't structurally be trusted
 * (`IncorrectDecisionListingError` — not an array, a decision missing its label, or a timestamp
 * outside the transcript's span); the provider failing or timing out after exhausting retries
 * (`DecisionExtractionFailedError` — no heuristic fallback exists, same seam STORY-005/006/009
 * left open). A decision missing `rationale`, `approver`, or `timestampMs` is listed anyway with
 * those gaps flagged for review, rather than rejected outright. Every attempt, dedup hit,
 * success, and failure is recorded to the audit trail.
 */
export async function listDecisions(
  input: ListDecisionsInput,
  {
    decisionExtractionClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
  }: ListDecisionsOptions
): Promise<DecisionListing> {
  // Best-effort id for logging/dedup only — real validation (including that this is actually a
  // string) happens inside the try block below, so a malformed transcriptId still gets audited.
  const transcriptId = input?.markedTranscript?.transcriptId;

  const existing = typeof transcriptId === 'string' ? idempotencyStore.get(transcriptId) : undefined;
  if (existing) {
    logger.info('decision_listing_deduplicated', { transcriptId });
    return existing;
  }

  logger.info('decision_listing_attempted', {
    transcriptId,
    segmentCount: Array.isArray(input?.markedTranscript?.segments) ? input.markedTranscript.segments.length : undefined,
  });

  let decisions: Decision[];
  let validatedTranscriptId: string;
  try {
    const markedTranscript = validateInput(input);
    validatedTranscriptId = markedTranscript.transcriptId;
    const segments = markedTranscript.segments;
    const rawDecisions = await withTimeoutAndRetry(
      () =>
        decisionExtractionClient.extractDecisions({
          transcriptId: markedTranscript.transcriptId,
          segments: segments.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
        }),
      {
        timeoutMs,
        maxAttempts,
        backoffMs,
        isRetryable: isRetryableUpstreamError,
        operationName: `decisionExtraction.extractDecisions(${markedTranscript.transcriptId})`,
      }
    );
    decisions = buildDecisions(validateDecisionListing(rawDecisions, segments, markedTranscript.transcriptId));
  } catch (error) {
    const resolvedId = typeof transcriptId === 'string' ? transcriptId : 'unresolved';
    if (error instanceof ContractViolationError || error instanceof IncorrectDecisionListingError) {
      recordFailure(resolvedId, error instanceof ContractViolationError ? 'decision_extraction_failed' : 'incorrect_decision_listing', error);
      throw error;
    }
    const wrapped =
      error instanceof DecisionExtractionFailedError
        ? error
        : new DecisionExtractionFailedError(error instanceof Error ? error.message : String(error), { transcriptId: resolvedId });
    recordFailure(resolvedId, 'decision_extraction_failed', wrapped);
    throw wrapped;
  }

  const listing: DecisionListing = {
    id: validatedTranscriptId,
    transcriptId: validatedTranscriptId,
    decisions,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(validatedTranscriptId, listing);
  logger.info('decision_listing_completed', {
    transcriptId: validatedTranscriptId,
    decisionCount: decisions.length,
    flaggedDecisionCount: decisions.filter((decision) => decision.flaggedForReview).length,
    decisions: decisions.map((decision) => ({ decision: decision.decision, timestampMs: decision.timestampMs, flaggedForReview: decision.flaggedForReview })),
  });

  return listing;
}

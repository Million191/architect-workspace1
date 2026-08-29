import { ActionItemExtractionFailedError, ContractViolationError, IncorrectActionItemExtractionError } from './errors';
import { recordAuditEvent } from './auditLog';
import { ActionItem, ActionItemExtractionClient, ActionItemTable, ExtractActionItemsInput, RawActionItem } from './types';
import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface ActionItemExtractionLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: ActionItemExtractionLogger = {
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
 * Action item tables keyed by the source transcript's id, so re-extracting the same transcript
 * never re-calls the (paid) action-item-extraction provider.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, ActionItemTable>();

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
 * Rejects input this logic cannot safely extract action items from, rather than guessing action
 * items from data that doesn't hold up. This is the story's "action item extraction failure"
 * failure path at the input boundary.
 */
function validateInput(input: ExtractActionItemsInput): MarkedTranscript {
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

const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'done']);

/**
 * Confirms the provider's response is a well-formed array of action items with a non-empty
 * `task` label, that any `priority`/`status` a raw item does carry is one of the known enum
 * values, and that any `sourceTimestampMs` falls within the transcript's own segment span. This is
 * the story's "incorrect action item extraction" failure path: the provider call succeeded, but
 * its shape can't be trusted to build a table from — a fabricated or misaligned timestamp, or an
 * enum value the rest of the system doesn't understand, is worse than a missing one, so this fails
 * the whole operation rather than shipping a table that silently lies about it.
 * An action item missing `owner`/`dueDate`/`priority`/`status`/`sourceTimestampMs` entirely is NOT
 * rejected here — that's the separate "missing action item fields" path, handled by
 * `buildActionItems` as a per-item flag.
 */
function validateActionItemExtraction(rawItems: RawActionItem[], segments: MarkedSegment[], transcriptId: string): RawActionItem[] {
  if (!Array.isArray(rawItems)) {
    throw new IncorrectActionItemExtractionError('Action-item-extraction provider did not return an array of action items', { transcriptId });
  }

  const expectedStart = segments[0].startMs;
  const expectedEnd = segments[segments.length - 1].endMs;

  rawItems.forEach((raw, index) => {
    if (typeof raw?.task !== 'string' || raw.task.length === 0) {
      throw new IncorrectActionItemExtractionError(`Action item at index ${index} is missing its task text`, { transcriptId, index });
    }
    if (raw.priority !== undefined && !VALID_PRIORITIES.has(raw.priority)) {
      throw new IncorrectActionItemExtractionError(`Action item at index ${index} has an unrecognized priority "${raw.priority}"`, {
        transcriptId,
        index,
      });
    }
    if (raw.status !== undefined && !VALID_STATUSES.has(raw.status)) {
      throw new IncorrectActionItemExtractionError(`Action item at index ${index} has an unrecognized status "${raw.status}"`, {
        transcriptId,
        index,
      });
    }
    if (raw.sourceTimestampMs !== undefined) {
      if (!Number.isFinite(raw.sourceTimestampMs) || raw.sourceTimestampMs < expectedStart || raw.sourceTimestampMs > expectedEnd) {
        throw new IncorrectActionItemExtractionError(
          `Action item at index ${index} has a timestamp outside the transcript's span (expected ${expectedStart}-${expectedEnd}, got ${raw.sourceTimestampMs})`,
          { transcriptId, index }
        );
      }
    }
  });

  return rawItems;
}

/**
 * Builds the final action item table from a validated (but not necessarily complete) provider
 * response: any item missing `owner`, `dueDate`, `priority`, `status`, or `sourceTimestampMs` is
 * listed anyway, with those gaps named in `missingFields` and `flaggedForReview` set — satisfying
 * the "flag unclear action items for review" acceptance criterion without dropping the item from
 * the minutes.
 */
function buildActionItems(rawItems: RawActionItem[]): ActionItem[] {
  return rawItems.map((raw) => {
    const missingFields: ActionItem['missingFields'] = [];
    if (!raw.owner) missingFields.push('owner');
    if (!raw.dueDate) missingFields.push('dueDate');
    if (!raw.priority) missingFields.push('priority');
    if (!raw.status) missingFields.push('status');
    if (raw.sourceTimestampMs === undefined) missingFields.push('sourceTimestampMs');

    return {
      task: raw.task,
      owner: raw.owner,
      dueDate: raw.dueDate,
      priority: raw.priority,
      status: raw.status,
      sourceTimestampMs: raw.sourceTimestampMs,
      missingFields,
      flaggedForReview: missingFields.length > 0,
    };
  });
}

export interface ExtractActionItemsOptions {
  actionItemExtractionClient: ActionItemExtractionClient;
  logger?: ActionItemExtractionLogger;
  idempotencyStore?: Map<string, ActionItemTable>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
}

/**
 * Extracts a meeting's action items into a table with owner, due date, priority, status, and
 * source timestamp (REQ-011), deduping on `markedTranscript.transcriptId` so re-extracting the
 * same transcript never re-calls the (paid) action-item-extraction provider. Failure paths:
 * malformed input (`ContractViolationError` — missing transcript id, non-array segments, invalid
 * segment text/timestamps); the provider succeeding but returning a table that can't structurally
 * be trusted (`IncorrectActionItemExtractionError` — not an array, an item missing its task text,
 * an unrecognized priority/status enum, or a timestamp outside the transcript's span); the
 * provider failing or timing out after exhausting retries (`ActionItemExtractionFailedError` — no
 * heuristic fallback exists, same seam STORY-005/006/009/010 left open). An action item missing
 * `owner`, `dueDate`, `priority`, `status`, or `sourceTimestampMs` is listed anyway with those gaps
 * flagged for review, rather than rejected outright. Every attempt, dedup hit, success, and failure
 * is recorded to the audit trail.
 */
export async function extractActionItems(
  input: ExtractActionItemsInput,
  {
    actionItemExtractionClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
  }: ExtractActionItemsOptions
): Promise<ActionItemTable> {
  // Best-effort id for logging/dedup only — real validation (including that this is actually a
  // string) happens inside the try block below, so a malformed transcriptId still gets audited.
  const transcriptId = input?.markedTranscript?.transcriptId;

  const existing = typeof transcriptId === 'string' ? idempotencyStore.get(transcriptId) : undefined;
  if (existing) {
    logger.info('action_item_table_deduplicated', { transcriptId });
    return existing;
  }

  logger.info('action_item_extraction_attempted', {
    transcriptId,
    segmentCount: Array.isArray(input?.markedTranscript?.segments) ? input.markedTranscript.segments.length : undefined,
  });

  let actionItems: ActionItem[];
  let validatedTranscriptId: string;
  try {
    const markedTranscript = validateInput(input);
    validatedTranscriptId = markedTranscript.transcriptId;
    const segments = markedTranscript.segments;
    const rawItems = await withTimeoutAndRetry(
      () =>
        actionItemExtractionClient.extractActionItems({
          transcriptId: markedTranscript.transcriptId,
          segments: segments.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
        }),
      {
        timeoutMs,
        maxAttempts,
        backoffMs,
        isRetryable: isRetryableUpstreamError,
        operationName: `actionItemExtraction.extractActionItems(${markedTranscript.transcriptId})`,
      }
    );
    actionItems = buildActionItems(validateActionItemExtraction(rawItems, segments, markedTranscript.transcriptId));
  } catch (error) {
    const resolvedId = typeof transcriptId === 'string' ? transcriptId : 'unresolved';
    if (error instanceof ContractViolationError || error instanceof IncorrectActionItemExtractionError) {
      recordFailure(resolvedId, error instanceof ContractViolationError ? 'action_item_extraction_failed' : 'incorrect_action_item_extraction', error);
      throw error;
    }
    const wrapped =
      error instanceof ActionItemExtractionFailedError
        ? error
        : new ActionItemExtractionFailedError(error instanceof Error ? error.message : String(error), { transcriptId: resolvedId });
    recordFailure(resolvedId, 'action_item_extraction_failed', wrapped);
    throw wrapped;
  }

  const table: ActionItemTable = {
    id: validatedTranscriptId,
    transcriptId: validatedTranscriptId,
    actionItems,
    generatedAt: new Date().toISOString(),
  };

  idempotencyStore.set(validatedTranscriptId, table);
  logger.info('action_item_extraction_completed', {
    transcriptId: validatedTranscriptId,
    actionItemCount: actionItems.length,
    flaggedActionItemCount: actionItems.filter((item) => item.flaggedForReview).length,
    actionItems: actionItems.map((item) => ({ task: item.task, owner: item.owner, dueDate: item.dueDate, status: item.status, flaggedForReview: item.flaggedForReview })),
  });

  return table;
}

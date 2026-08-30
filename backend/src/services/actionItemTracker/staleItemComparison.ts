import { ActionItemTrackerError, ContractViolationError, StaleComparisonFailedError } from './errors';
import { recordAuditEvent } from './auditLog';
import { StaleComparisonInput, StaleComparisonResult, StaleComparisonResultItem, TrackedActionItem } from './types';

/** REQ-017: an item still open after this many days (since it was first seen, across occurrences
 * of a recurring meeting) is flagged stale. */
const STALE_THRESHOLD_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** No single entity (session, batch) identifies a stale comparison the way `sendingReviewGateSessionId`
 * identifies a tracker log — it's a comparison across two lists. Used as `recordAuditEvent`'s
 * `resourceId`; the actual counts/details live in each event's `context`. */
const RESOURCE_ID = 'stale-item-comparison';

export interface StaleComparisonLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: StaleComparisonLogger = {
  info(event, context) {
    recordAuditEvent({ event, outcome: 'success', resourceId: RESOURCE_ID, context });
  },
};

function recordFailure(event: string, error: unknown): void {
  const errorClass = error instanceof ActionItemTrackerError ? error.errorClass : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId: RESOURCE_ID,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

export interface CompareOpenItemsOptions {
  logger?: StaleComparisonLogger;
}

function validateInput(input: StaleComparisonInput | undefined): StaleComparisonInput {
  if (!Array.isArray(input?.priorOpenItems)) {
    throw new ContractViolationError('StaleComparisonInput.priorOpenItems must be an array', { input });
  }
  if (!Array.isArray(input.currentOpenItems)) {
    throw new ContractViolationError('StaleComparisonInput.currentOpenItems must be an array', { input });
  }
  return input;
}

/** `(task, owner)` case-insensitive, matching `emailDraftingService`'s existing owner-matching
 * convention. A missing `owner` normalizes to `''` rather than being excluded from matching. */
function matchKey(item: TrackedActionItem): string {
  const task = item.actionItem.task?.trim().toLowerCase() ?? '';
  const owner = item.actionItem.owner?.trim().toLowerCase() ?? '';
  return `${task}::${owner}`;
}

/** Parses `loggedAt` into epoch ms, or throws `StaleComparisonFailedError` — the story's
 * "comparison logic failure" path. A malformed timestamp can't be safely aged, so the whole
 * comparison fails loud rather than guessing at a fallback that could under- or over-flag it. */
function parseLoggedAtMs(item: TrackedActionItem, listName: string): number {
  const parsed = Date.parse(item.loggedAt);
  if (Number.isNaN(parsed)) {
    throw new StaleComparisonFailedError(`Invalid loggedAt "${item.loggedAt}" on an item in ${listName}`, {
      task: item.actionItem.task,
      owner: item.actionItem.owner,
      loggedAt: item.loggedAt,
      listName,
    });
  }
  return parsed;
}

/**
 * REQ-017: compares this run's open action items against what was already on record as open for
 * the same recurring meeting, and flags anything open more than 14 days as `'Stale'`. Matching is
 * by `(task, owner)`, case-insensitive; when an item matches one from `priorOpenItems`, its age is
 * computed from the earlier of the two `loggedAt` timestamps (the item's true first-seen date),
 * not just the current run's. An unmatched item (new this run) ages from its own `loggedAt`.
 *
 * Failure paths: malformed input (`ContractViolationError` — not an array); an unparseable
 * `loggedAt` on any item in either list (`StaleComparisonFailedError` — "comparison logic
 * failure"). Both are the story's "failure to detect stale items" path made concrete: rather than
 * skip a bad record silently, the whole comparison fails loud so the record gets fixed.
 *
 * Trust: every call logs an attempt, then either `stale_items_flagged` (with each stale item's
 * task/owner/daysOpen) or `all_items_current` on success, or `stale_item_comparison_failed` with
 * the error class on failure — satisfying "the system logs stale item flagging attempts and
 * results" directly, not just the flagging outcome.
 */
export function compareOpenItems(
  input: StaleComparisonInput,
  { logger = defaultLogger }: CompareOpenItemsOptions = {}
): StaleComparisonResult {
  logger.info('stale_item_comparison_attempted', {
    priorCount: input?.priorOpenItems?.length,
    currentCount: input?.currentOpenItems?.length,
  });

  let result: StaleComparisonResult;
  try {
    const { priorOpenItems, currentOpenItems, now = new Date() } = validateInput(input);

    const priorByKey = new Map<string, number>();
    for (const priorItem of priorOpenItems) {
      const priorMs = parseLoggedAtMs(priorItem, 'priorOpenItems');
      const key = matchKey(priorItem);
      const existing = priorByKey.get(key);
      priorByKey.set(key, existing === undefined ? priorMs : Math.min(existing, priorMs));
    }

    const items: StaleComparisonResultItem[] = currentOpenItems.map((currentItem) => {
      const currentMs = parseLoggedAtMs(currentItem, 'currentOpenItems');
      const priorMs = priorByKey.get(matchKey(currentItem));
      const firstSeenMs = priorMs === undefined ? currentMs : Math.min(priorMs, currentMs);

      const daysOpen = (now.getTime() - firstSeenMs) / MS_PER_DAY;
      const status: TrackedActionItem['status'] = daysOpen > STALE_THRESHOLD_DAYS ? 'Stale' : 'Not Started';

      return {
        actionItem: currentItem.actionItem,
        status,
        daysOpen,
        firstLoggedAt: new Date(firstSeenMs).toISOString(),
      };
    });

    const staleCount = items.filter((item) => item.status === 'Stale').length;
    result = { items, staleCount, allCurrent: staleCount === 0 };
  } catch (error) {
    recordFailure('stale_item_comparison_failed', error);
    throw error;
  }

  if (result.staleCount > 0) {
    logger.info('stale_items_flagged', {
      staleCount: result.staleCount,
      staleItems: result.items
        .filter((item) => item.status === 'Stale')
        .map((item) => ({ task: item.actionItem.task, owner: item.actionItem.owner, daysOpen: item.daysOpen })),
    });
  } else {
    logger.info('all_items_current', { currentCount: result.items.length });
  }

  return result;
}

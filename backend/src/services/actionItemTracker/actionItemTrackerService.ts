import { ActionItemLoggingFailedError, ContractViolationError, SendConfirmationNotVerifiedError } from './errors';
import { recordAuditEvent } from './auditLog';
import { ActionItemTrackerClient, EmailSendConfirmation, LogActionItemsInput, TrackedActionItem, TrackerLogResult } from './types';
import { SendingReviewGateSession } from '../reviewGateSending/types';
import { assertApprovedForSending, ReviewGateSendingOptions } from '../reviewGateSending/reviewGateSendingService';
import { SendingReviewGateError } from '../reviewGateSending/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface ActionItemTrackerLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: ActionItemTrackerLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.sendingReviewGateSessionId === 'string' ? context.sendingReviewGateSessionId : 'unresolved',
      context,
    });
  },
};

/**
 * Tracker log results keyed by `EmailSendConfirmation.sendingReviewGateSessionId`, so re-confirming
 * the same send never re-calls the (real) tracker system a second time.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, TrackerLogResult>();

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function recordFailure(sessionId: string, event: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId: sessionId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Rejects a confirmation this service cannot safely act on, rather than logging action items off
 * data that doesn't hold up. This is the story's "incorrect action item logging" failure path at
 * the input boundary.
 */
function validateConfirmation(confirmation: EmailSendConfirmation | undefined): EmailSendConfirmation {
  if (typeof confirmation?.sendingReviewGateSessionId !== 'string' || confirmation.sendingReviewGateSessionId.length === 0) {
    throw new ContractViolationError('EmailSendConfirmation is missing its sendingReviewGateSessionId', { confirmation });
  }
  if (typeof confirmation.sentAt !== 'string' || confirmation.sentAt.length === 0) {
    throw new ContractViolationError('EmailSendConfirmation.sentAt is missing or not a string', {
      sendingReviewGateSessionId: confirmation.sendingReviewGateSessionId,
    });
  }
  if (!Array.isArray(confirmation.confirmedRecipients)) {
    throw new ContractViolationError('EmailSendConfirmation.confirmedRecipients must be an array', {
      sendingReviewGateSessionId: confirmation.sendingReviewGateSessionId,
    });
  }
  return confirmation;
}

/**
 * Collects every action item in the approved batch — both those attached to a participant's email
 * and any left in `unmatchedActionItems` — so the tracker gets the complete list Records would hand
 * it, not just the subset that happened to reach a real attendee. Per-item order isn't meaningful
 * here; each action item appears exactly once, since `emailDraftingService` already guarantees every
 * item lands in exactly one of the two places.
 */
function collectActionItems(session: SendingReviewGateSession) {
  const fromEmails = session.batch.emails.flatMap((email) => email.actionItems);
  const fromUnmatched = session.batch.unmatchedActionItems.map((unmatched) => unmatched.actionItem);
  return [...fromEmails, ...fromUnmatched];
}

export interface LogActionItemsOptions {
  actionItemTrackerClient: ActionItemTrackerClient;
  logger?: ActionItemTrackerLogger;
  idempotencyStore?: Map<string, TrackerLogResult>;
  /** Passed through to `assertApprovedForSending` so tests can verify against the same Gate #2
   * session store a fake batch was submitted/approved in, rather than the real module-level one. */
  sendingReviewGateOptions?: ReviewGateSendingOptions;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
  /** Called once retries are exhausted and logging has definitively failed — the story's "notify
   * the user" requirement. Defaults to a structured audit event, since no real user-notification
   * channel (email, in-app alert) is wired into this project yet; wiring one is an external-
   * dependency decision outside this story's scope, the same boundary this codebase already draws
   * for every provider seam (STORY-005/006/009/010/011). */
  notifyUserOfFailure?: (context: { sendingReviewGateSessionId: string; error: ActionItemLoggingFailedError }) => void;
}

const defaultNotifyUserOfFailure: NonNullable<LogActionItemsOptions['notifyUserOfFailure']> = ({ sendingReviewGateSessionId, error }) => {
  recordAuditEvent({
    event: 'user_notified_of_logging_failure',
    outcome: 'success',
    resourceId: sendingReviewGateSessionId,
    context: { message: error.message },
  });
};

/**
 * Logs every action item from an approved, confirmed-sent batch to the Action Item Tracker with
 * status 'Not Started' (REQ-016), deduping on `confirmation.sendingReviewGateSessionId` so
 * re-confirming the same send never re-calls the (real) tracker system twice. Trusts nothing about
 * "the emails were sent" beyond what Gate #2 itself already proved: `assertApprovedForSending` is
 * called first, and a confirmation referencing a session that was never submitted or never approved
 * is rejected as `SendConfirmationNotVerifiedError` rather than logged anyway. Failure paths:
 * malformed input (`ContractViolationError`); an unverifiable send confirmation
 * (`SendConfirmationNotVerifiedError` — the "incorrect action item logging" path); the tracker
 * client failing or timing out after exhausting retries (`ActionItemLoggingFailedError` — "logging
 * service failure" / "action item logging retry failure", after which `notifyUserOfFailure` fires).
 * Every attempt, dedup hit, success, and failure is recorded to the audit trail.
 */
export async function logActionItems(
  input: LogActionItemsInput,
  {
    actionItemTrackerClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    sendingReviewGateOptions,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
    notifyUserOfFailure = defaultNotifyUserOfFailure,
  }: LogActionItemsOptions
): Promise<TrackerLogResult> {
  const rawSessionId = input?.confirmation?.sendingReviewGateSessionId;

  const existing = typeof rawSessionId === 'string' ? idempotencyStore.get(rawSessionId) : undefined;
  if (existing) {
    logger.info('action_item_logging_deduplicated', { sendingReviewGateSessionId: rawSessionId });
    return existing;
  }

  logger.info('action_item_logging_attempted', { sendingReviewGateSessionId: rawSessionId });

  let loggedItems: TrackedActionItem[];
  let confirmedSessionId: string;
  let loggedAt: string;
  try {
    const confirmation = validateConfirmation(input?.confirmation);
    confirmedSessionId = confirmation.sendingReviewGateSessionId;

    let session: SendingReviewGateSession;
    try {
      session = assertApprovedForSending(confirmedSessionId, sendingReviewGateOptions);
    } catch (gateError) {
      const errorClass = gateError instanceof SendingReviewGateError ? gateError.errorClass : 'Error';
      throw new SendConfirmationNotVerifiedError(
        `Cannot trust this send confirmation — Gate #2 was never satisfied for session "${confirmedSessionId}" (${errorClass})`,
        { sendingReviewGateSessionId: confirmedSessionId, gateErrorClass: errorClass }
      );
    }

    const actionItems = collectActionItems(session);
    loggedAt = new Date().toISOString();
    const trackedItems: TrackedActionItem[] = actionItems.map((actionItem) => ({
      actionItem,
      status: 'Not Started',
      loggedAt,
    }));

    // Unlike other services in this project, this deliberately does not restrict retries to
    // UpstreamTimeoutError: the story's "action item logging retry failure" criterion is about
    // any tracker-write failure being retried, not only a hung call, so the default
    // retry-everything policy applies.
    await withTimeoutAndRetry(() => actionItemTrackerClient.logActionItems(trackedItems), {
      timeoutMs,
      maxAttempts,
      backoffMs,
      operationName: `actionItemTracker.logActionItems(${confirmedSessionId})`,
    });

    loggedItems = trackedItems;
  } catch (error) {
    const resolvedId = typeof rawSessionId === 'string' ? rawSessionId : 'unresolved';

    if (error instanceof ContractViolationError || error instanceof SendConfirmationNotVerifiedError) {
      recordFailure(resolvedId, 'action_item_logging_failed', error);
      throw error;
    }

    const wrapped =
      error instanceof ActionItemLoggingFailedError
        ? error
        : new ActionItemLoggingFailedError(error instanceof Error ? error.message : String(error), { sendingReviewGateSessionId: resolvedId });
    recordFailure(resolvedId, 'action_item_logging_failed', wrapped);
    notifyUserOfFailure({ sendingReviewGateSessionId: resolvedId, error: wrapped });
    throw wrapped;
  }

  const result: TrackerLogResult = {
    id: confirmedSessionId,
    sendingReviewGateSessionId: confirmedSessionId,
    loggedItems,
    loggedAt,
  };

  idempotencyStore.set(confirmedSessionId, result);
  logger.info('action_items_logged', {
    sendingReviewGateSessionId: confirmedSessionId,
    loggedItemCount: loggedItems.length,
    status: 'Not Started',
  });

  return result;
}

import { EmailDraftBatch } from '../emailDrafting/types';
import { ContractViolationError, SendingNotApprovedError, SessionAlreadyApprovedError, SessionNotFoundError } from './errors';
import { recordAuditEvent } from './auditLog';
import { ApproveInput, RequestRevisionInput, RevisionRecord, SendingReviewGateSession, SubmitForReviewInput } from './types';

export interface ReviewGateSendingLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: ReviewGateSendingLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.sessionId === 'string' ? context.sessionId : 'unresolved',
      context,
    });
  },
};

/**
 * Review sessions keyed by `EmailDraftBatch.id` (== `SendingReviewGateSession.id`), so the same
 * drafted batch always maps to one Gate #2 session across submit/revise/approve calls.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only holds within one process.
 */
const defaultSessionStore = new Map<string, SendingReviewGateSession>();

export interface ReviewGateSendingOptions {
  logger?: ReviewGateSendingLogger;
  sessionStore?: Map<string, SendingReviewGateSession>;
}

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

/** Shared shape check for a drafted batch, used by both `submitForReview` and `requestRevision` —
 * rejects a batch this service cannot safely hold for review, rather than opening a session on it. */
function validateBatch(batch: EmailDraftBatch | undefined, label: string): EmailDraftBatch {
  if (!batch || typeof batch.id !== 'string' || batch.id.length === 0) {
    throw new ContractViolationError(`${label} is missing an id`, { batch });
  }
  if (typeof batch.reviewGateSessionId !== 'string' || batch.reviewGateSessionId.length === 0) {
    throw new ContractViolationError(`${label}.reviewGateSessionId is missing`, { batchId: batch.id });
  }
  if (!Array.isArray(batch.emails)) {
    throw new ContractViolationError(`${label}.emails must be an array`, { batchId: batch.id });
  }
  if (batch.emails.length === 0) {
    throw new ContractViolationError(`${label}.emails is empty — nothing to send for review`, { batchId: batch.id });
  }
  return batch;
}

/**
 * Opens Gate #2 for a freshly-drafted batch of participant emails (REQ-015), presenting them for
 * review and waiting for an explicit decision. Idempotent on `batch.id`: re-submitting while a
 * session is already `pending_review` is a no-op that returns the existing session unchanged;
 * re-submitting once a session is already `approved` is rejected with
 * `SessionAlreadyApprovedError` rather than silently reopening a decided gate. The only other
 * failure path is malformed input (`ContractViolationError`) — a batch that doesn't hold up is
 * never opened for review. Every attempt, dedup hit, and outcome is recorded to the audit trail.
 */
export function submitForReview(
  input: SubmitForReviewInput,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateSendingOptions = {}
): SendingReviewGateSession {
  const rawBatchId = input?.batch?.id;
  logger.info('sending_review_submission_attempted', { sessionId: rawBatchId });

  const existing = typeof rawBatchId === 'string' ? sessionStore.get(rawBatchId) : undefined;
  if (existing) {
    if (existing.status === 'approved') {
      const error = new SessionAlreadyApprovedError(
        'Cannot re-submit for review — this batch of emails was already approved for sending',
        { sessionId: existing.id, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt }
      );
      recordFailure(existing.id, 'sending_review_submission_failed', error);
      throw error;
    }
    logger.info('sending_review_submission_deduplicated', { sessionId: existing.id, status: existing.status });
    return existing;
  }

  let session: SendingReviewGateSession;
  try {
    const batch = validateBatch(input?.batch, 'batch');
    const now = new Date().toISOString();
    session = {
      id: batch.id,
      reviewGateSessionId: batch.reviewGateSessionId,
      status: 'pending_review',
      batch,
      revisions: [],
      submittedAt: now,
      updatedAt: now,
    };
  } catch (error) {
    recordFailure(typeof rawBatchId === 'string' ? rawBatchId : 'unresolved', 'sending_review_submission_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('sending_review_submitted', { sessionId: session.id, status: session.status });
  return session;
}

/**
 * Applies a reviewer's requested adjustments and re-presents the emails for review in one action
 * (the story's "revise and re-present" acceptance criterion) — there is no separate "revision
 * requested" holding state; the session goes straight back to `pending_review` carrying the
 * revised batch and a new `RevisionRecord` on its history. Fails loud on a missing session
 * (`SessionNotFoundError`), a session already past Gate #2 (`SessionAlreadyApprovedError`), or
 * malformed input including a revised batch for the wrong session (`ContractViolationError`) —
 * this is the story's "incorrect handling of requested adjustments" failure path handled explicitly
 * rather than silently accepted. Every attempt and outcome is recorded to the audit trail.
 */
export function requestRevision(
  input: RequestRevisionInput,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateSendingOptions = {}
): SendingReviewGateSession {
  const rawSessionId = input?.sessionId;
  logger.info('sending_revision_requested_attempted', { sessionId: rawSessionId });

  let session: SendingReviewGateSession;
  try {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId: rawSessionId });
    }
    if (typeof input?.changesRequested !== 'string' || input.changesRequested.length === 0) {
      throw new ContractViolationError('changesRequested is missing or empty', { sessionId: rawSessionId });
    }

    const existing = sessionStore.get(rawSessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No Gate #2 review session found for id "${rawSessionId}"`, { sessionId: rawSessionId });
    }
    if (existing.status === 'approved') {
      throw new SessionAlreadyApprovedError('Cannot request a revision — this batch was already approved for sending', {
        sessionId: rawSessionId,
        approvedBy: existing.approvedBy,
        approvedAt: existing.approvedAt,
      });
    }

    const revisedBatch = validateBatch(input.revisedBatch, 'revisedBatch');
    if (revisedBatch.id !== existing.id) {
      throw new ContractViolationError('revisedBatch.id does not match the session being revised', {
        sessionId: rawSessionId,
        expectedBatchId: existing.id,
        actualBatchId: revisedBatch.id,
      });
    }

    const now = new Date().toISOString();
    const revisionRecord: RevisionRecord = {
      requestedAt: now,
      requestedBy: input.requestedBy,
      changesRequested: input.changesRequested,
      batchAtRequest: existing.batch,
    };

    session = {
      ...existing,
      status: 'pending_review',
      batch: revisedBatch,
      revisions: [...existing.revisions, revisionRecord],
      updatedAt: now,
    };
  } catch (error) {
    recordFailure(typeof rawSessionId === 'string' ? rawSessionId : 'unresolved', 'sending_revision_request_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('sending_revision_applied_and_resubmitted', {
    sessionId: session.id,
    revisionCount: session.revisions.length,
    changesRequested: input.changesRequested,
  });
  return session;
}

/**
 * Records an explicit approval decision, the only way a session's status can become `approved`.
 * Fails loud on a missing session (`SessionNotFoundError`), a session already approved
 * (`SessionAlreadyApprovedError` — approval is recorded once, not silently re-recorded, so two
 * reviewers racing to approve the same session both get a clear, auditable answer), or a missing
 * `approvedBy` (`ContractViolationError` — an approval must be attributable to someone). Every
 * attempt and outcome is recorded to the audit trail, satisfying the story's Trust criterion.
 */
export function approve(
  input: ApproveInput,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateSendingOptions = {}
): SendingReviewGateSession {
  const rawSessionId = input?.sessionId;
  logger.info('sending_approval_attempted', { sessionId: rawSessionId, approvedBy: input?.approvedBy });

  let session: SendingReviewGateSession;
  try {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId: rawSessionId });
    }
    if (typeof input?.approvedBy !== 'string' || input.approvedBy.length === 0) {
      throw new ContractViolationError('approvedBy is missing or not a string', { sessionId: rawSessionId });
    }

    const existing = sessionStore.get(rawSessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No Gate #2 review session found for id "${rawSessionId}"`, { sessionId: rawSessionId });
    }
    if (existing.status === 'approved') {
      throw new SessionAlreadyApprovedError('This batch was already approved for sending', {
        sessionId: rawSessionId,
        approvedBy: existing.approvedBy,
        approvedAt: existing.approvedAt,
      });
    }

    const now = new Date().toISOString();
    session = { ...existing, status: 'approved', approvedBy: input.approvedBy, approvedAt: now, updatedAt: now };
  } catch (error) {
    recordFailure(typeof rawSessionId === 'string' ? rawSessionId : 'unresolved', 'sending_approval_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('sending_review_approved', { sessionId: session.id, approvedBy: session.approvedBy, approvedAt: session.approvedAt });
  return session;
}

/**
 * Gate #2 itself. The future Email Delivery Service must call this before it is allowed to
 * dispatch any mail, and must treat a thrown error as "do not send" — there is no bypass. Throws
 * `SessionNotFoundError` if a batch was never submitted for review, or `SendingNotApprovedError`
 * if a session exists but is not yet `approved`. This is the story's "failure to wait for
 * approval" failure path made structurally impossible to skip rather than merely documented: no
 * other function in this module ever returns a session claiming `approved` status without an
 * explicit `approve()` call having happened first. Every check — passed or blocked — is recorded
 * to the audit trail.
 */
export function assertApprovedForSending(
  sessionId: string,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateSendingOptions = {}
): SendingReviewGateSession {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId });
    }
    const existing = sessionStore.get(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No Gate #2 review session found for id "${sessionId}"`, { sessionId });
    }
    if (existing.status !== 'approved') {
      throw new SendingNotApprovedError(
        'Gate #2 is not satisfied — emails have not been approved for sending yet, delivery must not proceed',
        { sessionId, status: existing.status }
      );
    }
    logger.info('sending_gate_check_passed', { sessionId, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt });
    return existing;
  } catch (error) {
    recordFailure(typeof sessionId === 'string' ? sessionId : 'unresolved', 'sending_gate_check_blocked', error);
    throw error;
  }
}

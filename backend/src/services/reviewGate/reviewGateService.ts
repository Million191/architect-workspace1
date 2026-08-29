import { ContractViolationError, ReviewNotApprovedError, SessionAlreadyApprovedError, SessionNotFoundError } from './errors';
import { recordAuditEvent } from './auditLog';
import { ApproveInput, DraftMinutes, RequestRevisionInput, RevisionRecord, ReviewGateSession, SubmitForReviewInput } from './types';

export interface ReviewGateLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: ReviewGateLogger = {
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
 * Review sessions keyed by `transcriptId` (== `ReviewGateSession.id`), so the same transcript's
 * minutes always map to one session across submit/revise/approve calls.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only holds within one process.
 */
const defaultSessionStore = new Map<string, ReviewGateSession>();

export interface ReviewGateOptions {
  logger?: ReviewGateLogger;
  sessionStore?: Map<string, ReviewGateSession>;
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

/** Shared shape check for a draft, used by both `submitForReview` and `requestRevision` — rejects
 * a draft this service cannot safely hold for review, rather than opening a session on it. */
function validateDraft(draft: DraftMinutes | undefined, label: string): DraftMinutes {
  if (!draft || typeof draft.transcriptId !== 'string' || draft.transcriptId.length === 0) {
    throw new ContractViolationError(`${label} is missing a transcriptId`, { draft });
  }
  if (!draft.meetingSummary || typeof draft.meetingSummary !== 'object') {
    throw new ContractViolationError(`${label}.meetingSummary is missing`, { transcriptId: draft.transcriptId });
  }
  if (!Array.isArray(draft.discussionTopics)) {
    throw new ContractViolationError(`${label}.discussionTopics must be an array`, { transcriptId: draft.transcriptId });
  }
  if (!Array.isArray(draft.decisions)) {
    throw new ContractViolationError(`${label}.decisions must be an array`, { transcriptId: draft.transcriptId });
  }
  if (!Array.isArray(draft.actionItems)) {
    throw new ContractViolationError(`${label}.actionItems must be an array`, { transcriptId: draft.transcriptId });
  }
  return draft;
}

/**
 * Opens Gate #1 for a freshly-drafted set of minutes (REQ-013), presenting them for review and
 * waiting for an explicit decision. Idempotent on `draft.transcriptId`: re-submitting while a
 * session is already `pending_review` is a no-op that returns the existing session unchanged;
 * re-submitting once a session is already `approved` is rejected with
 * `SessionAlreadyApprovedError` rather than silently reopening a decided gate. The only other
 * failure path is malformed input (`ContractViolationError`) — a draft that doesn't hold up is
 * never opened for review. Every attempt, dedup hit, and outcome is recorded to the audit trail.
 */
export function submitForReview(
  input: SubmitForReviewInput,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateOptions = {}
): ReviewGateSession {
  const rawTranscriptId = input?.draft?.transcriptId;
  logger.info('review_submission_attempted', { transcriptId: rawTranscriptId });

  const existing = typeof rawTranscriptId === 'string' ? sessionStore.get(rawTranscriptId) : undefined;
  if (existing) {
    if (existing.status === 'approved') {
      const error = new SessionAlreadyApprovedError(
        'Cannot re-submit for review — this transcript\'s minutes were already approved',
        { sessionId: existing.id, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt }
      );
      recordFailure(existing.id, 'review_submission_failed', error);
      throw error;
    }
    logger.info('review_submission_deduplicated', { sessionId: existing.id, status: existing.status });
    return existing;
  }

  let session: ReviewGateSession;
  try {
    const draft = validateDraft(input?.draft, 'draft');
    const now = new Date().toISOString();
    session = {
      id: draft.transcriptId,
      transcriptId: draft.transcriptId,
      status: 'pending_review',
      draft,
      revisions: [],
      submittedAt: now,
      updatedAt: now,
    };
  } catch (error) {
    recordFailure(typeof rawTranscriptId === 'string' ? rawTranscriptId : 'unresolved', 'review_submission_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('review_submitted', { sessionId: session.id, status: session.status });
  return session;
}

/**
 * Applies a reviewer's requested edits and re-presents the draft for review in one action (the
 * story's "revise and re-present" acceptance criterion) — there is no separate "revision
 * requested" holding state; the session goes straight back to `pending_review` carrying the
 * revised draft and a new `RevisionRecord` on its history. Fails loud on a missing session
 * (`SessionNotFoundError`), a session already past Gate #1 (`SessionAlreadyApprovedError`), or
 * malformed input including a revised draft for the wrong transcript (`ContractViolationError`) —
 * this is the story's "incorrect handling of requested edits" failure path handled explicitly
 * rather than silently accepted. Every attempt and outcome is recorded to the audit trail.
 */
export function requestRevision(
  input: RequestRevisionInput,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateOptions = {}
): ReviewGateSession {
  const rawSessionId = input?.sessionId;
  logger.info('revision_requested_attempted', { sessionId: rawSessionId });

  let session: ReviewGateSession;
  try {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId: rawSessionId });
    }
    if (typeof input?.changesRequested !== 'string' || input.changesRequested.length === 0) {
      throw new ContractViolationError('changesRequested is missing or empty', { sessionId: rawSessionId });
    }

    const existing = sessionStore.get(rawSessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No review session found for id "${rawSessionId}"`, { sessionId: rawSessionId });
    }
    if (existing.status === 'approved') {
      throw new SessionAlreadyApprovedError('Cannot request a revision — this session was already approved', {
        sessionId: rawSessionId,
        approvedBy: existing.approvedBy,
        approvedAt: existing.approvedAt,
      });
    }

    const revisedDraft = validateDraft(input.revisedDraft, 'revisedDraft');
    if (revisedDraft.transcriptId !== existing.transcriptId) {
      throw new ContractViolationError('revisedDraft.transcriptId does not match the session being revised', {
        sessionId: rawSessionId,
        expectedTranscriptId: existing.transcriptId,
        actualTranscriptId: revisedDraft.transcriptId,
      });
    }

    const now = new Date().toISOString();
    const revisionRecord: RevisionRecord = {
      requestedAt: now,
      requestedBy: input.requestedBy,
      changesRequested: input.changesRequested,
      draftAtRequest: existing.draft,
    };

    session = {
      ...existing,
      status: 'pending_review',
      draft: revisedDraft,
      revisions: [...existing.revisions, revisionRecord],
      updatedAt: now,
    };
  } catch (error) {
    recordFailure(typeof rawSessionId === 'string' ? rawSessionId : 'unresolved', 'revision_request_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('revision_applied_and_resubmitted', {
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
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateOptions = {}
): ReviewGateSession {
  const rawSessionId = input?.sessionId;
  logger.info('approval_attempted', { sessionId: rawSessionId, approvedBy: input?.approvedBy });

  let session: ReviewGateSession;
  try {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId: rawSessionId });
    }
    if (typeof input?.approvedBy !== 'string' || input.approvedBy.length === 0) {
      throw new ContractViolationError('approvedBy is missing or not a string', { sessionId: rawSessionId });
    }

    const existing = sessionStore.get(rawSessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No review session found for id "${rawSessionId}"`, { sessionId: rawSessionId });
    }
    if (existing.status === 'approved') {
      throw new SessionAlreadyApprovedError('This session was already approved', {
        sessionId: rawSessionId,
        approvedBy: existing.approvedBy,
        approvedAt: existing.approvedAt,
      });
    }

    const now = new Date().toISOString();
    session = { ...existing, status: 'approved', approvedBy: input.approvedBy, approvedAt: now, updatedAt: now };
  } catch (error) {
    recordFailure(typeof rawSessionId === 'string' ? rawSessionId : 'unresolved', 'approval_failed', error);
    throw error;
  }

  sessionStore.set(session.id, session);
  logger.info('review_approved', { sessionId: session.id, approvedBy: session.approvedBy, approvedAt: session.approvedAt });
  return session;
}

/**
 * Gate #1 itself. STORY-013 (email drafting) must call this before it is allowed to run, and must
 * treat a thrown error as "do not draft emails" — there is no bypass. Throws
 * `SessionNotFoundError` if minutes were never submitted for review, or `ReviewNotApprovedError`
 * if a session exists but is not yet `approved`. This is the story's "failure to wait for
 * approval" failure path made structurally impossible to skip rather than merely documented: no
 * other function in this module ever returns a session claiming `approved` status without an
 * explicit `approve()` call having happened first. Every check — passed or blocked — is recorded
 * to the audit trail.
 */
export function assertApprovedForEmailDrafting(
  sessionId: string,
  { logger = defaultLogger, sessionStore = defaultSessionStore }: ReviewGateOptions = {}
): ReviewGateSession {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new ContractViolationError('sessionId is missing or not a string', { sessionId });
    }
    const existing = sessionStore.get(sessionId);
    if (!existing) {
      throw new SessionNotFoundError(`No review session found for id "${sessionId}"`, { sessionId });
    }
    if (existing.status !== 'approved') {
      throw new ReviewNotApprovedError(
        'Gate #1 is not satisfied — minutes have not been approved yet, email drafting must not proceed',
        { sessionId, status: existing.status }
      );
    }
    logger.info('gate_check_passed', { sessionId, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt });
    return existing;
  } catch (error) {
    recordFailure(typeof sessionId === 'string' ? sessionId : 'unresolved', 'gate_check_blocked', error);
    throw error;
  }
}

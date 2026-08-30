import { EmailDraftBatch } from '../emailDrafting/types';

/**
 * `pending_review` — awaiting an explicit approve/revise decision; this is the only state Gate #2
 * blocks in (see `assertApprovedForSending` in the service, the seam the future Email Delivery
 * Service must call). `approved` — Gate #2 has passed for the batch currently on the session.
 *
 * As with Gate #1, there is deliberately no separate "revision requested" state: the acceptance
 * criteria describe receiving adjustments and re-presenting the emails as one action, so
 * `requestRevision` applies the revised batch and puts the session straight back into
 * `pending_review`, rather than parking it in an extra state that would need a second explicit
 * call to leave.
 */
export type SendingReviewGateStatus = 'pending_review' | 'approved';

/** One requested-adjustment round: what changed, who asked for it, and what the batch looked like
 * at the moment the adjustment was requested — kept so the full revision history is auditable
 * rather than only ever showing the latest batch. */
export interface RevisionRecord {
  requestedAt: string;
  requestedBy?: string;
  changesRequested: string;
  batchAtRequest: EmailDraftBatch;
}

/** Gate #2's live state for one meeting's drafted emails: current batch, current status, and full
 * revision history back to the first submission. */
export interface SendingReviewGateSession {
  /** Idempotency key — equals `EmailDraftBatch.id` (which itself equals the Gate #1
   * `reviewGateSessionId`). Re-submitting the same batch for review is a no-op against an existing
   * open session, not a fresh one, mirroring the `id` == source-key convention every service in
   * this project already uses. */
  id: string;
  reviewGateSessionId: string;
  status: SendingReviewGateStatus;
  batch: EmailDraftBatch;
  revisions: RevisionRecord[];
  submittedAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface SubmitForReviewInput {
  batch: EmailDraftBatch;
}

export interface RequestRevisionInput {
  sessionId: string;
  changesRequested: string;
  revisedBatch: EmailDraftBatch;
  requestedBy?: string;
}

export interface ApproveInput {
  sessionId: string;
  approvedBy: string;
}

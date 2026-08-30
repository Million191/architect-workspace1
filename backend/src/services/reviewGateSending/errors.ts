/**
 * Base for all Gate #2 (review-before-sending) failures. `errorClass` is the stable tag required
 * by the Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class SendingReviewGateError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely open or update a review session from — a batch missing its
 * `id`/`reviewGateSessionId`, or a revision request with no `changesRequested` text. This is the
 * story's "review gate logic failure" failure path at the input boundary: rather than open a
 * session for a batch that doesn't hold up, the request fails loud instead of silently accepting
 * malformed emails into review.
 */
export class ContractViolationError extends SendingReviewGateError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * `requestRevision` or `approve` referenced a `sessionId` with no open review session. This is the
 * story's "review gate logic failure" failure path: a decision can only be recorded against a
 * session that actually exists, so this fails loud rather than silently creating one or no-oping.
 */
export class SessionNotFoundError extends SendingReviewGateError {
  readonly errorClass = 'SessionNotFoundError';
}

/**
 * An invalid state transition on a session that has already passed Gate #2: re-submitting the
 * same batch for review, requesting a revision, or approving a second time, once
 * `status === 'approved'`. This is the story's "review gate logic failure" failure path for state
 * transitions — an approved decision is final within this service, so any of these fail loud
 * instead of silently reopening or double-recording an approval.
 */
export class SessionAlreadyApprovedError extends SendingReviewGateError {
  readonly errorClass = 'SessionAlreadyApprovedError';
}

/**
 * Thrown by `assertApprovedForSending` — the seam the future Email Delivery Service must call
 * before it is allowed to dispatch any mail — whenever the session is missing or not yet
 * `approved`. This is the literal embodiment of the story's "failure to wait for approval" failure
 * path: any caller that skips or races ahead of an explicit approval fails loud here rather than
 * proceeding to send unreviewed emails.
 */
export class SendingNotApprovedError extends SendingReviewGateError {
  readonly errorClass = 'SendingNotApprovedError';
}

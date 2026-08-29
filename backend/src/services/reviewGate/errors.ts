/**
 * Base for all review-gate failures. `errorClass` is the stable tag required by the Observability
 * Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class ReviewGateError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely open or update a review session from — a missing
 * `transcriptId`, a draft missing its `meetingSummary`, or a revision request with no
 * `changesRequested` text. This is the story's "review gate logic failure" failure path at the
 * input boundary: rather than open a session for a draft that doesn't hold up, the request fails
 * loud instead of silently accepting malformed minutes into review.
 */
export class ContractViolationError extends ReviewGateError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * `requestRevision` or `approve` referenced a `sessionId` with no open review session. This is
 * the story's "review gate logic failure" failure path: a decision can only be recorded against a
 * session that actually exists, so this fails loud rather than silently creating one or no-oping.
 */
export class SessionNotFoundError extends ReviewGateError {
  readonly errorClass = 'SessionNotFoundError';
}

/**
 * An invalid state transition on a session that has already passed Gate #1: re-submitting the
 * same transcript for review, requesting a revision, or approving a second time, once
 * `status === 'approved'`. This is the story's "review gate logic failure" failure path for state
 * transitions — an approved decision is final within this service, so any of these fail loud
 * instead of silently reopening or double-recording an approval.
 */
export class SessionAlreadyApprovedError extends ReviewGateError {
  readonly errorClass = 'SessionAlreadyApprovedError';
}

/**
 * Thrown by `assertApprovedForEmailDrafting` — the seam STORY-013 (email drafting) must call
 * before it is allowed to run — whenever the session is missing or not yet `approved`. This is
 * the literal embodiment of the story's "failure to wait for approval" failure path: any caller
 * that skips or races ahead of an explicit approval fails loud here rather than proceeding on an
 * unreviewed draft.
 */
export class ReviewNotApprovedError extends ReviewGateError {
  readonly errorClass = 'ReviewNotApprovedError';
}

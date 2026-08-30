/**
 * Base for all Action Item Tracker failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class ActionItemTrackerError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely act on — a confirmation missing its
 * `sendingReviewGateSessionId`/`sentAt`, or a non-array `confirmedRecipients`. This is the story's
 * "incorrect action item logging" failure path at the input boundary: rather than log items off a
 * confirmation that doesn't hold up, the request fails loud instead of silently logging against
 * malformed or guessed data.
 */
export class ContractViolationError extends ActionItemTrackerError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The confirmation's `sendingReviewGateSessionId` does not reference a batch that actually passed
 * Gate #2 — either no such session was ever submitted for the sending review, or it exists but was
 * never approved. This is the story's "incorrect action item logging" failure path at the trust
 * boundary: a "send confirmation" for emails that were never approved to send cannot be trusted, so
 * nothing is logged to the tracker. Wraps whatever `assertApprovedForSending` threw
 * (`SessionNotFoundError`/`SendingNotApprovedError` from `reviewGateSending`) rather than
 * duplicating that logic here.
 */
export class SendConfirmationNotVerifiedError extends ActionItemTrackerError {
  readonly errorClass = 'SendConfirmationNotVerifiedError';
}

/**
 * The `ActionItemTrackerClient` failed or timed out after `withTimeoutAndRetry` exhausted its
 * capped retries. This is the story's "logging service failure" / "action item logging retry
 * failure" path: the write to the real tracker system did not succeed, and — unlike a missing
 * field on one action item — there is no safe partial result to return, so the whole log attempt
 * fails loud rather than silently reporting success.
 */
export class ActionItemLoggingFailedError extends ActionItemTrackerError {
  readonly errorClass = 'ActionItemLoggingFailedError';
}

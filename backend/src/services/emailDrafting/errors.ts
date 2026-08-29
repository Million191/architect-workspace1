/**
 * Base for all email-drafting failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class EmailDraftingError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * `draftEmails` was called with a missing or non-string `reviewGateSessionId`. This is the
 * story's "failure to draft emails" failure path at the input boundary: rather than pass a bad
 * id through to the review gate and get back a confusing downstream error, this service rejects
 * it immediately.
 *
 * Note: a missing or unapproved *session* (as opposed to a malformed *id*) is not re-wrapped
 * here — `SessionNotFoundError`/`ReviewNotApprovedError` from `reviewGate/errors.ts` propagate
 * as-is from `assertApprovedForEmailDrafting`, since those are already the correctly-typed
 * "failure to wait for approval" errors and duplicating them under a new type would only make the
 * audit trail harder to follow.
 */
export class ContractViolationError extends EmailDraftingError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The approved draft behind an otherwise-valid, approved review-gate session has nothing this
 * service can draft emails from — e.g. `meetingSummary.attendees` is empty, so there is no
 * participant to address a single email to. This is the story's "email drafting logic failure"
 * failure path: rather than silently return an empty batch that looks like a successful run,
 * drafting fails loud so the gap is visible instead of quietly shipping zero emails.
 */
export class EmailDraftingFailedError extends EmailDraftingError {
  readonly errorClass = 'EmailDraftingFailedError';
}

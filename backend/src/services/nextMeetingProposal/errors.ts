/**
 * Base for all next-meeting-proposal failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class NextMeetingProposalError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely decide a proposal from — a missing `meetingId`, a missing or
 * unparseable `concludedAt`, a non-array `openItems`, or an open item missing its `task` text.
 * (An item's `status` being absent is NOT a violation — STORY-011 already allows that and flags it
 * for review; this service treats an absent status as still open, per `isOpen` in the service file.)
 * This is the only failure path here: unlike STORY-005/006/009/010/011, there is no external
 * provider call to wrap (the proposal logic is deterministic, given the data the caller already
 * has), so the input boundary is the sole place this can legitimately fail loud rather than
 * guessing whether to propose.
 */
export class ContractViolationError extends NextMeetingProposalError {
  readonly errorClass = 'ContractViolationError';
}

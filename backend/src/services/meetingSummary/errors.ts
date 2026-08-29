/**
 * Base for all meeting-summary failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class MeetingSummaryError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely summarize — a missing transcript/audio id, or an
 * `attendees` value that isn't an array. Rather than guess a summary from input that doesn't
 * hold up, generation fails loud for the whole request so a bad summary is never shipped.
 */
export class ContractViolationError extends MeetingSummaryError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * Summary assembly did not finish within its time budget (the story's "summary generation
 * timeout" failure path). Field assembly here is in-memory and O(1) in transcript size today
 * — no external provider call — so this is a defensive guard against runaway computation
 * rather than an upstream dependency; it's still an explicit, capped boundary per CLAUDE.md's
 * Failure-First Design ("every external call gets an explicit timeout"), applied here to the
 * whole generation step so the pattern is already in place once a real dependency (e.g. a
 * future calendar/objective-inference lookup) lands behind `MeetingContext`.
 */
export class SummaryGenerationTimeoutError extends MeetingSummaryError {
  readonly errorClass = 'SummaryGenerationTimeoutError';
}

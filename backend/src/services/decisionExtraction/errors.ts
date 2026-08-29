/**
 * Base for all decision-extraction failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class DecisionExtractionError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely extract decisions from — a missing transcript id, a
 * non-array `segments`, or a segment missing usable text/timing. This is the story's "decision
 * extraction failure" failure path at the input boundary: rather than guess decisions from input
 * that doesn't hold up, extraction fails loud for the whole request so a bad listing is never
 * shipped.
 */
export class ContractViolationError extends DecisionExtractionError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The decision-extraction provider returned a listing that can't structurally be trusted — e.g.
 * a decision's `timestampMs` falls outside the transcript's own segment span, or the response
 * isn't a well-formed array of decisions. This is the story's "incorrect decision listing"
 * failure path: distinct from an individual decision missing a field (which is flagged for
 * review, not rejected), this is the provider's response shape itself being invalid, so this
 * fails the whole operation rather than shipping a listing with fabricated or misaligned
 * timestamps.
 */
export class IncorrectDecisionListingError extends DecisionExtractionError {
  readonly errorClass = 'IncorrectDecisionListingError';
}

/**
 * The decision-extraction provider failed or timed out after exhausting retries. This is the
 * story's "decision extraction failure" failure path at the provider boundary. No safe fallback
 * exists — there is no heuristic in this codebase that extracts decisions from transcript text,
 * per the seam this story deliberately leaves for a real provider (same boundary STORY-005/006/009
 * drew) — so this fails the whole operation rather than shipping a guessed listing.
 */
export class DecisionExtractionFailedError extends DecisionExtractionError {
  readonly errorClass = 'DecisionExtractionFailedError';
}

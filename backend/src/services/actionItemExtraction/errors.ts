/**
 * Base for all action-item-extraction failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class ActionItemExtractionError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely extract action items from — a missing transcript id, a
 * non-array `segments`, or a segment missing usable text/timing. This is the story's "action item
 * extraction failure" failure path at the input boundary: rather than guess action items from
 * input that doesn't hold up, extraction fails loud for the whole request so a bad table is never
 * shipped.
 */
export class ContractViolationError extends ActionItemExtractionError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The action-item-extraction provider returned a table that can't structurally be trusted — e.g.
 * an action item's `sourceTimestampMs` falls outside the transcript's own segment span, or the
 * response isn't a well-formed array of action items. This is the story's "incorrect action item
 * extraction" failure path: distinct from an individual item missing a field (which is flagged for
 * review, not rejected), this is the provider's response shape itself being invalid, so this fails
 * the whole operation rather than shipping a table with fabricated or misaligned timestamps.
 */
export class IncorrectActionItemExtractionError extends ActionItemExtractionError {
  readonly errorClass = 'IncorrectActionItemExtractionError';
}

/**
 * The action-item-extraction provider failed or timed out after exhausting retries. This is the
 * story's "action item extraction failure" failure path at the provider boundary. No safe fallback
 * exists — there is no heuristic in this codebase that extracts action items from transcript text,
 * per the seam this story deliberately leaves for a real provider (same boundary STORY-005/006/009/010
 * drew) — so this fails the whole operation rather than shipping a guessed table.
 */
export class ActionItemExtractionFailedError extends ActionItemExtractionError {
  readonly errorClass = 'ActionItemExtractionFailedError';
}

/**
 * Base for all segment-marking failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class SegmentMarkingError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The marking system itself failed on malformed input it cannot safely judge — a non-array
 * `segments`, a segment with non-string `text`, or a `confidence` outside `[0, 1]` (NaN
 * included). This is the story's "marking system failure" path: rather than guess an
 * audibility for input that doesn't hold up, marking fails loud for the whole transcript so a
 * bad mark is never silently shipped.
 */
export class ContractViolationError extends SegmentMarkingError {
  readonly errorClass = 'ContractViolationError';
}

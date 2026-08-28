/**
 * Base for all diarization failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class DiarizationError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The diarization provider failed or timed out after exhausting retries. No safe fallback
 * exists here — without speaker boundaries there's nothing to degrade to — so this fails
 * the whole operation rather than shipping a guess.
 */
export class DiarizationFailedError extends DiarizationError {
  readonly errorClass = 'DiarizationFailedError';
}

/**
 * The name-mapping provider failed or timed out after exhausting retries. Unlike
 * `DiarizationFailedError`, a deterministic fallback exists (label every speaker
 * `UNIDENTIFIED_SPEAKER_LABEL`), so callers may catch this and degrade instead of failing
 * the whole result.
 */
export class NameMappingServiceError extends DiarizationError {
  readonly errorClass = 'NameMappingServiceError';
}

/** A provider call succeeded but returned a shape this service doesn't understand. */
export class ContractViolationError extends DiarizationError {
  readonly errorClass = 'ContractViolationError';
}

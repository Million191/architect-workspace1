/**
 * Base for all audio-ingestion failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class IngestionError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnsupportedFormatError extends IngestionError {
  readonly errorClass = 'UnsupportedFormatError';
}

export class CorruptedAudioError extends IngestionError {
  readonly errorClass = 'CorruptedAudioError';
}

export class UpstreamTimeoutError extends IngestionError {
  readonly errorClass = 'UpstreamTimeoutError';
}

export class UpstreamUnavailableError extends IngestionError {
  readonly errorClass = 'UpstreamUnavailableError';
}

/** A non-retryable 4xx from the upstream platform (bad auth, meeting not found, etc.). */
export class UpstreamRejectedError extends IngestionError {
  readonly errorClass = 'UpstreamRejectedError';
}

/** Upstream returned 2xx but the payload doesn't match the shape we depend on. */
export class ContractViolationError extends IngestionError {
  readonly errorClass = 'ContractViolationError';
}

/** Required configuration (e.g. platform credentials) is missing or invalid. */
export class ConfigurationError extends IngestionError {
  readonly errorClass = 'ConfigurationError';
}

/** An audio source value doesn't match any known meeting type, so it can't be tagged. */
export class TaggingError extends IngestionError {
  readonly errorClass = 'TaggingError';
}

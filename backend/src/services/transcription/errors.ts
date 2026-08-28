/**
 * Base for all transcription failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class TranscriptionError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/** The provider could not decode the audio at all — corrupt file, truncated upload, unreadable container. */
export class AudioDecodingError extends TranscriptionError {
  readonly errorClass = 'AudioDecodingError';
}

/**
 * A provider returned segments whose timestamps don't hold up — reversed, zero-length, or
 * out of chronological order. Failing loudly here beats silently shipping a transcript that
 * misrepresents the meeting timeline (REQ-005).
 */
export class TimestampMisalignmentError extends TranscriptionError {
  readonly errorClass = 'TimestampMisalignmentError';
}

/** A provider call succeeded but returned a shape this service doesn't understand. */
export class ContractViolationError extends TranscriptionError {
  readonly errorClass = 'ContractViolationError';
}

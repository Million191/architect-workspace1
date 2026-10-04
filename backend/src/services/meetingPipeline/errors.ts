/**
 * Base for all pipeline-orchestration failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class MeetingPipelineError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/** No run exists for the given id — nothing was ever drafted for it in this process. */
export class RunNotFoundError extends MeetingPipelineError {
  readonly errorClass = 'RunNotFoundError';
}

/** A step was requested out of order, e.g. sending emails before they were drafted (i.e. before the minutes were approved). */
export class StageOrderError extends MeetingPipelineError {
  readonly errorClass = 'StageOrderError';
}

/** A provider this phase needs is not configured (e.g. a missing API key). Never answered with sample data. */
export class ProviderNotConfiguredError extends MeetingPipelineError {
  readonly errorClass = 'ProviderNotConfiguredError';

  constructor(readonly problems: string[]) {
    super(`Not configured: ${problems.join(' ')}`, { problems });
  }
}

/** Emails cannot go out as approved: an attendee has no address, or an address is outside the allowed list. Nothing is sent or approved. */
export class RecipientProblemError extends MeetingPipelineError {
  readonly errorClass = 'RecipientProblemError';

  constructor(readonly problems: string[]) {
    super(problems.join(' '), { problems });
  }
}

/**
 * One wrapped stage (transcription, diarization, ...) failed. `stage` says which, `causeErrorClass`
 * carries the wrapped service's own stable tag, so the UI can say exactly where the run stopped.
 */
export class PipelineStageFailedError extends MeetingPipelineError {
  readonly errorClass = 'PipelineStageFailedError';

  constructor(
    readonly stage: string,
    readonly causeErrorClass: string,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(message, { ...context, stage, causeErrorClass });
  }
}

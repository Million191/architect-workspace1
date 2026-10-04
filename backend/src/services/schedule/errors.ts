/** Base for schedule failures; `errorClass` is the stable tag for logs and API responses. */
export abstract class ScheduleError extends Error {
  abstract readonly errorClass: string;
  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/** No scheduled meeting with that id. */
export class MeetingNotFoundError extends ScheduleError {
  readonly errorClass = 'MeetingNotFoundError';
}

/** The change isn't allowed in the meeting's current state (e.g. editing a meeting that has a recording). */
export class InvalidTransitionError extends ScheduleError {
  readonly errorClass = 'InvalidTransitionError';
}

/** Input that doesn't make sense (end before start, bad email). */
export class ScheduleValidationError extends ScheduleError {
  readonly errorClass = 'ScheduleValidationError';
}

/** The page edited an older version than the one on the server (another tab or an Undo got there first). */
export class StaleVersionError extends ScheduleError {
  readonly errorClass = 'StaleVersionError';
}

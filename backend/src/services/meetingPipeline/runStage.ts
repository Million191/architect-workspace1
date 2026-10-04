import { recordAuditEvent } from './auditLog';
import { MeetingPipelineError, PipelineStageFailedError } from './errors';

/** The stable `errorClass` tag every service error in this project carries; 'UnknownError' when absent. */
export function errorClassOf(error: unknown): string {
  if (error && typeof error === 'object' && 'errorClass' in error) {
    return String((error as { errorClass: unknown }).errorClass);
  }
  return 'UnknownError';
}

/**
 * Runs one pipeline stage with timing + an audit line either way. A failure is re-thrown as
 * `PipelineStageFailedError` naming the stage, unless it is listed in `passThrough` (errors the
 * caller maps to a specific HTTP status itself, e.g. a bad upload or a gate refusal) or is
 * already a pipeline error. The wrapped service has already logged its own detailed failure,
 * so this adds only the stage name and duration — it never swallows anything.
 */
export async function runStage<T>(
  runRef: string,
  stage: string,
  operation: () => T | Promise<T>,
  passThrough: string[] = []
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    recordAuditEvent({ event: `stage_completed`, outcome: 'success', resourceId: runRef, durationMs: Date.now() - started, context: { stage } });
    return result;
  } catch (error) {
    const causeErrorClass = errorClassOf(error);
    recordAuditEvent({
      event: 'stage_failed',
      outcome: 'failure',
      resourceId: runRef,
      errorClass: causeErrorClass,
      durationMs: Date.now() - started,
      context: { stage, message: error instanceof Error ? error.message : String(error) },
    });
    if (error instanceof MeetingPipelineError || passThrough.includes(causeErrorClass)) {
      throw error;
    }
    // Cause messages are built by this repo's own services/providers (never a raw upstream body), so they are safe to show.
    const causeMessage = error instanceof Error ? error.message : String(error);
    throw new PipelineStageFailedError(stage, causeErrorClass, `The ${stage} step failed (${causeErrorClass}): ${causeMessage}`, { runRef });
  }
}

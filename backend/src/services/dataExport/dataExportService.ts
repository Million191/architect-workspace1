import { ContractViolationError, DataOutputFailedError, InvalidJsonFormatError } from './errors';
import { recordAuditEvent } from './auditLog';
import { formatMeetingDataAsJson } from './jsonFormatter';
import { DataOutputClient, ExportMeetingDataInput, ExportResult, MeetingDataExportInput } from './types';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface DataExportLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: DataExportLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.meetingId === 'string' ? context.meetingId : 'unresolved',
      context,
    });
  },
};

/**
 * Export results keyed by `MeetingDataExportInput.meetingId`, so re-exporting the same meeting
 * never re-calls the (real) external tracker a second time.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, ExportResult>();

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function recordFailure(meetingId: string, event: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId: meetingId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Rejects meeting data this service cannot safely act on, rather than exporting with no
 * idempotency key to dedupe or trace it by. This is the story's input-boundary failure path.
 */
function validateMeetingData(meetingData: MeetingDataExportInput | undefined): MeetingDataExportInput {
  if (typeof meetingData?.meetingId !== 'string' || meetingData.meetingId.length === 0) {
    throw new ContractViolationError('MeetingDataExportInput is missing its meetingId', { meetingData });
  }
  return meetingData;
}

export interface ExportMeetingDataOptions {
  dataOutputClient: DataOutputClient;
  logger?: DataExportLogger;
  idempotencyStore?: Map<string, ExportResult>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides the default capped-exponential backoff between retries — mainly for tests. */
  backoffMs?: (attempt: number) => number;
  /** Called once retries are exhausted and output has definitively failed — the story's "notify
   * the user" requirement. Defaults to a structured audit event, since no real user-notification
   * channel (email, in-app alert) is wired into this project yet; wiring one is an external-
   * dependency decision outside this story's scope, the same boundary this codebase already draws
   * for every provider seam (STORY-005/006/009/010/011/015). */
  notifyUserOfFailure?: (context: { meetingId: string; error: DataOutputFailedError }) => void;
}

const defaultNotifyUserOfFailure: NonNullable<ExportMeetingDataOptions['notifyUserOfFailure']> = ({ meetingId, error }) => {
  recordAuditEvent({
    event: 'user_notified_of_export_failure',
    outcome: 'success',
    resourceId: meetingId,
    context: { message: error.message },
  });
};

/**
 * Formats meeting data as JSON and sends it to an external tracker (REQ-018), deduping on
 * `meetingData.meetingId` so re-exporting the same meeting never re-calls the (real) tracker
 * system twice. Failure paths: malformed input (`ContractViolationError`); data that cannot be
 * represented as valid JSON (`InvalidJsonFormatError` — the "incorrect JSON formatting" path,
 * never retried, since it is deterministic and a retry would fail identically); the output client
 * failing or timing out after exhausting retries (`DataOutputFailedError` — "data output service
 * failure" / "data output retry failure", after which `notifyUserOfFailure` fires). Every attempt,
 * dedup hit, success, and failure is recorded to the audit trail.
 */
export async function exportMeetingData(
  input: ExportMeetingDataInput,
  {
    dataOutputClient,
    logger = defaultLogger,
    idempotencyStore = defaultIdempotencyStore,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs,
    notifyUserOfFailure = defaultNotifyUserOfFailure,
  }: ExportMeetingDataOptions
): Promise<ExportResult> {
  const rawMeetingId = input?.meetingData?.meetingId;

  const existing = typeof rawMeetingId === 'string' ? idempotencyStore.get(rawMeetingId) : undefined;
  if (existing) {
    logger.info('data_export_deduplicated', { meetingId: rawMeetingId });
    return existing;
  }

  logger.info('data_export_attempted', { meetingId: rawMeetingId });

  let payload: ExportResult['payload'];
  let confirmedMeetingId: string;
  let exportedAt: string;
  try {
    const meetingData = validateMeetingData(input?.meetingData);
    confirmedMeetingId = meetingData.meetingId;

    exportedAt = new Date().toISOString();
    let formatted;
    try {
      formatted = formatMeetingDataAsJson(meetingData, exportedAt);
    } catch (error) {
      throw error instanceof InvalidJsonFormatError
        ? error
        : new InvalidJsonFormatError(error instanceof Error ? error.message : String(error), { meetingId: confirmedMeetingId });
    }

    try {
      // Unlike a formatting error, an output-client failure may be transient (a flaky network
      // call to the external tracker), so it is retried; the story's "data output retry failure"
      // criterion is about any output-call failure being retried, not only a hung call, so the
      // default retry-everything policy applies — same convention `actionItemTrackerService`
      // already established for its own output call.
      await withTimeoutAndRetry(() => dataOutputClient.outputData(formatted), {
        timeoutMs,
        maxAttempts,
        backoffMs,
        operationName: `dataExport.outputData(${confirmedMeetingId})`,
      });
    } catch (error) {
      throw new DataOutputFailedError(error instanceof Error ? error.message : String(error), { meetingId: confirmedMeetingId });
    }

    payload = formatted;
  } catch (error) {
    const resolvedId = typeof rawMeetingId === 'string' ? rawMeetingId : 'unresolved';

    if (error instanceof ContractViolationError || error instanceof InvalidJsonFormatError) {
      recordFailure(resolvedId, 'data_export_failed', error);
      throw error;
    }

    const wrapped =
      error instanceof DataOutputFailedError ? error : new DataOutputFailedError(error instanceof Error ? error.message : String(error), { meetingId: resolvedId });
    recordFailure(resolvedId, 'data_export_failed', wrapped);
    notifyUserOfFailure({ meetingId: resolvedId, error: wrapped });
    throw wrapped;
  }

  const result: ExportResult = {
    id: confirmedMeetingId,
    meetingId: confirmedMeetingId,
    payload,
    exportedAt,
  };

  idempotencyStore.set(confirmedMeetingId, result);
  logger.info('data_export_completed', { meetingId: confirmedMeetingId });

  return result;
}

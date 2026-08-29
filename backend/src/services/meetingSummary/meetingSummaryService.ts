import { ContractViolationError, SummaryGenerationTimeoutError } from './errors';
import { recordAuditEvent } from './auditLog';
import { GenerateSummaryInput, MeetingSummary, SummaryFieldName } from './types';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';

export interface MeetingSummaryLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: MeetingSummaryLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.transcriptId === 'string' ? context.transcriptId : 'unresolved',
      context,
    });
  },
};

/**
 * Summaries keyed by the source transcript's id, so re-summarizing the same transcript is a
 * no-op.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, MeetingSummary>();

const DEFAULT_TIMEOUT_MS = 5_000;

function recordFailure(transcriptId: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event: 'summary_generation_failed',
    outcome: 'failure',
    resourceId: transcriptId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/** Rejects input this logic cannot safely summarize, rather than guessing at missing pieces. */
function validateInput(input: GenerateSummaryInput): void {
  const { transcript, ingestedAudio, attendees } = input;
  if (typeof transcript?.id !== 'string' || transcript.id.length === 0) {
    throw new ContractViolationError('Transcript is missing its id', { transcript });
  }
  if (typeof ingestedAudio?.id !== 'string' || ingestedAudio.id.length === 0) {
    throw new ContractViolationError('IngestedAudio is missing its id', { transcriptId: transcript.id });
  }
  if (!ingestedAudio.outputTag || typeof ingestedAudio.outputTag.meetingType !== 'string') {
    throw new ContractViolationError('IngestedAudio is missing its outputTag', { transcriptId: transcript.id });
  }
  if (!Array.isArray(attendees)) {
    throw new ContractViolationError('attendees must be an array', { transcriptId: transcript.id });
  }
}

/** Date portion (YYYY-MM-DD) of an ISO timestamp, or undefined if it's absent or unparseable. */
function datePartOf(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/** 24-hour HH:MM portion of an ISO timestamp, or undefined if it's absent or unparseable. */
function timePartOf(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(11, 16);
}

/**
 * Builds the summary from data already on hand — no scan of transcript segment content, since
 * none of REQ-008's fields are derived from what was said. `meetingContext.scheduledAt` (a real
 * calendar timestamp, when the caller has one) is preferred over `ingestedAudio.ingestedAt` for
 * date/time, since ingestion time is only ever a proxy for when the meeting happened.
 */
function assembleSummary(input: GenerateSummaryInput): MeetingSummary {
  const { transcript, ingestedAudio, attendees, meetingContext = {} } = input;

  const whenSource = meetingContext.scheduledAt ?? ingestedAudio.ingestedAt;
  const date = datePartOf(whenSource);
  const time = timePartOf(whenSource);
  const platformOrLocation = ingestedAudio.outputTag.locationUnknown ? undefined : ingestedAudio.outputTag.sourceLabel;
  const attendeeNames = attendees.map((attendee) => attendee.name);

  const missingFields: SummaryFieldName[] = [];
  if (!meetingContext.title) missingFields.push('title');
  if (!date) missingFields.push('date');
  if (!time) missingFields.push('time');
  if (!platformOrLocation) missingFields.push('platformOrLocation');
  if (attendeeNames.length === 0) missingFields.push('attendees');
  if (!meetingContext.objective) missingFields.push('objective');

  return {
    id: transcript.id,
    transcriptId: transcript.id,
    audioId: ingestedAudio.id,
    title: meetingContext.title,
    date,
    time,
    format: ingestedAudio.outputTag.meetingType,
    platformOrLocation,
    attendees: attendeeNames,
    objective: meetingContext.objective,
    missingFields,
    generatedAt: new Date().toISOString(),
  };
}

export interface GenerateSummaryOptions {
  logger?: MeetingSummaryLogger;
  idempotencyStore?: Map<string, MeetingSummary>;
  timeoutMs?: number;
}

/**
 * Generates a meeting summary (REQ-008) from data already available by this point in the
 * pipeline — the transcript's own id/audio id, `IngestedAudio.outputTag` (format and
 * platform/location, computed at ingestion by STORY-001–004), the attendee list STORY-006's
 * diarization already accepts, and an optional caller-supplied `MeetingContext` for
 * title/objective/scheduled time, since no calendar-invite ingestion story exists yet. Dedupes
 * on `transcript.id` so re-summarizing the same transcript is a no-op. Never fabricates a field
 * it has no source for: title, date, time, platform/location, attendees, and objective are each
 * independently reported in `missingFields` when unset, per the architecture doc's "grounded
 * only in what the transcript actually contains" rule — `format` is the one field with no
 * failure path, since it's always computed at ingestion. Failure paths: malformed input
 * (`ContractViolationError` — missing transcript/audio id or outputTag, non-array `attendees`);
 * assembly exceeding its time budget (`SummaryGenerationTimeoutError` — see errors.ts for why
 * this guards an in-memory step rather than an external call). Every attempt, dedup hit,
 * success, and failure is recorded to the audit trail.
 */
export async function generateMeetingSummary(
  input: GenerateSummaryInput,
  { logger = defaultLogger, idempotencyStore = defaultIdempotencyStore, timeoutMs = DEFAULT_TIMEOUT_MS }: GenerateSummaryOptions = {}
): Promise<MeetingSummary> {
  const transcriptId = input?.transcript?.id;
  const existing = transcriptId ? idempotencyStore.get(transcriptId) : undefined;
  if (existing) {
    logger.info('summary_generation_deduplicated', { transcriptId });
    return existing;
  }

  logger.info('summary_generation_attempted', {
    transcriptId,
    audioId: input?.ingestedAudio?.id,
    attendeeCount: Array.isArray(input?.attendees) ? input.attendees.length : undefined,
  });

  let summary: MeetingSummary;
  try {
    summary = await withTimeoutAndRetry(
      async () => {
        validateInput(input);
        return assembleSummary(input);
      },
      {
        timeoutMs,
        maxAttempts: 1,
        operationName: `meetingSummary.generate(${transcriptId ?? 'unknown'})`,
      }
    );
  } catch (error) {
    if (error instanceof ContractViolationError) {
      recordFailure(transcriptId ?? 'unresolved', error);
      throw error;
    }
    if (error instanceof UpstreamTimeoutError) {
      const wrapped = new SummaryGenerationTimeoutError(error.message, { transcriptId });
      recordFailure(transcriptId ?? 'unresolved', wrapped);
      throw wrapped;
    }
    recordFailure(transcriptId ?? 'unresolved', error);
    throw error;
  }

  idempotencyStore.set(summary.transcriptId, summary);
  logger.info('summary_generation_completed', {
    transcriptId: summary.transcriptId,
    missingFieldCount: summary.missingFields.length,
    missingFields: summary.missingFields,
  });

  return summary;
}

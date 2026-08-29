import { Attendee } from '../diarization/types';
import { IngestedAudio } from '../audioIngestion/types';
import { Transcript } from '../transcription/types';

/**
 * Caller-supplied context this service has no other way to obtain. No calendar/invite
 * ingestion story exists yet, so `title` and `objective` can only ever come from here — this
 * service never infers them from transcript text, per the architecture doc's "grounded only in
 * what the transcript actually contains, never fabricate" rule. All fields optional: a caller
 * with nothing to supply passes `{}`, and every field that ends up unset is reported in
 * `MeetingSummary.missingFields` rather than guessed.
 */
export interface MeetingContext {
  title?: string;
  objective?: string;
  /** ISO-8601 timestamp for when the meeting actually happened, e.g. from a calendar invite.
   * Preferred over `IngestedAudio.ingestedAt` for date/time when supplied, since ingestion time
   * is only a proxy for meeting time. */
  scheduledAt?: string;
}

/** Names of `MeetingSummary` fields that can end up unset and must be flagged, not guessed. */
export type SummaryFieldName = 'title' | 'date' | 'time' | 'platformOrLocation' | 'attendees' | 'objective';

export interface MeetingSummary {
  /** Idempotency key, derived from the source transcript's id — re-summarizing the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` this summary was generated from. */
  transcriptId: string;
  audioId: string;
  title?: string;
  /** Calendar date, e.g. "2026-08-28". Derived from `MeetingContext.scheduledAt` when supplied, else `IngestedAudio.ingestedAt`. */
  date?: string;
  /** 24-hour clock time, e.g. "14:05". Same source as `date`. */
  time?: string;
  /** "Virtual" or "In-Person" — always available, computed at ingestion (`IngestedAudio.outputTag.meetingType`). */
  format: IngestedAudio['outputTag']['meetingType'];
  /** Platform name (Zoom/Teams/Meet) or physical location. Unset when ingestion couldn't determine one — see `IngestedAudio.outputTag.locationUnknown`. */
  platformOrLocation?: string;
  /** Names from the attendee list the caller supplied, same list STORY-006 diarization takes. Empty when none was supplied. */
  attendees: string[];
  objective?: string;
  /** Every field above that ended up unset, for manual input — never inferred to fill a gap. */
  missingFields: SummaryFieldName[];
  generatedAt: string;
}

export interface GenerateSummaryInput {
  transcript: Transcript;
  ingestedAudio: IngestedAudio;
  attendees: Attendee[];
  meetingContext?: MeetingContext;
}

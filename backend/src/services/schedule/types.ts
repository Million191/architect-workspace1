/**
 * Scheduled meetings: the calendar side of Meeting Assistant. A scheduled meeting exists before any
 * recording; once a recording is uploaded for it (`runId`), its status comes from the existing
 * minutes workflow and the meeting is locked against schedule edits.
 *
 * API/JSON field names are camelCase like the rest of this codebase; they map 1:1 to the requested
 * original_start, original_end, status_reason, status_changed_at, status_changed_by.
 */
export type ScheduleStatus = 'scheduled' | 'postponed' | 'cancelled';

export interface Participant {
  /** Display name when given as "Name <email>"; used to greet people by name. */
  name?: string;
  email: string;
}

export interface TimeRange {
  start: string | null;
  end: string | null;
}

export type HistoryAction = 'created' | 'updated' | 'rescheduled' | 'postponed' | 'cancelled' | 'restored' | 'undone' | 'recording_linked' | 'notified' | 'notify_failed' | 'synced';

/** Where a meeting synced from Google or Outlook came from. Synced meetings change only through the calendar. */
export interface ExternalRef {
  provider: 'google' | 'microsoft';
  calendarId: string;
  eventId: string;
  /** Provider's last-modified time at the last sync. */
  updated?: string;
}

/** One line of a meeting's change history. Structured, so the page can format times in the viewer's zone. */
export interface HistoryEntry {
  at: string;
  by?: string;
  action: HistoryAction;
  from?: TimeRange;
  to?: TimeRange;
  reason?: string;
  /** Free text for notifications ("Notified 3 participants (not sent — draft-only mode)"). */
  note?: string;
}

export interface ScheduledMeeting {
  id: string;
  title: string;
  /** ISO-8601 with offset. Both null only for "postponed, date to be decided". */
  start: string | null;
  end: string | null;
  participants: Participant[];
  link?: string;
  agenda?: string;
  status: ScheduleStatus;
  originalStart?: string;
  originalEnd?: string;
  statusReason?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  /** Processed recording (pipeline run id) attached to this meeting. Locks schedule edits. */
  runId?: string;
  /** Set for meetings imported by calendar sync. */
  external?: ExternalRef;
  createdAt: string;
  updatedAt: string;
  /** Increments on every change; used as the Undo token and to reject stale edits. */
  version: number;
  history: HistoryEntry[];
  /** The meeting as it was before the latest change, for a single-step Undo. */
  previous?: Omit<ScheduledMeeting, 'history' | 'previous'>;
}

export interface MeetingInput {
  title: string;
  start: string;
  end: string;
  participants: Participant[];
  link?: string;
  agenda?: string;
}

/** A change made through the API, with who made it and (for postpone/cancel) why. */
export interface ChangeContext {
  by?: string;
  reason?: string;
}

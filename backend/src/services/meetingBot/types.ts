import { MeetingPlatform } from '../calendarSync/meetingLinks';

/**
 * A meeting notetaker bot (Recall.ai) sent to one calendar meeting. The bot joins as
 * "Meeting Assistant Notetaker", records, and when the call ends its audio goes through the same
 * pipeline as an upload: transcription → draft minutes → review.
 *
 * scheduled → joining → waiting_room → awaiting_permission → recording → processing → ready
 *     any state before processing → cancelled (stopped before anything was recorded)
 *     any state → failed (with a readable error; processing failures can be retried)
 */
export type BotStatus = 'scheduled' | 'joining' | 'waiting_room' | 'awaiting_permission' | 'recording' | 'processing' | 'ready' | 'failed' | 'cancelled';

/** Statuses after which the bot is gone from the call and nothing more will happen on its own. */
export const FINAL_STATUSES: BotStatus[] = ['ready', 'failed', 'cancelled'];

export interface BotAttendee {
  name: string;
  email?: string;
}

export interface BotHistoryEntry {
  at: string;
  status: BotStatus;
  /** Provider status code / sub-code that caused the change, e.g. "in_waiting_room". */
  code?: string;
}

export interface BotSession {
  /** Our id (uuid). Also sent to Recall as metadata so webhooks find the session. */
  id: string;
  /** Recall's bot id; missing only while the create call is in flight or if it failed. */
  providerBotId?: string;
  scheduledMeetingId: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  title: string;
  attendees: BotAttendee[];
  status: BotStatus;
  /** When the bot is asked to join (the meeting start for future meetings; absent = right away). */
  joinAt?: string;
  /** "Everyone in this meeting knows it is being recorded" — required before any bot is sent. */
  consent: { confirmedAt: string; confirmedBy?: string; automatic: boolean };
  history: BotHistoryEntry[];
  /** Set once the bot reached "recording"; a call that ends without it has nothing to process. */
  recordedAt?: string;
  stopRequestedAt?: string;
  error?: { code: string; message: string };
  runId?: string;
  /** Set when the provider's copy of the recording was deleted under the retention setting. */
  mediaDeletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One stretch of the call where one participant was speaking (milliseconds from recording start). */
export interface SpeakerTurn {
  startMs: number;
  endMs: number;
  name: string;
}

/** What the provider reports about a bot right now (from GET /bot/:id). */
export interface ProviderBotState {
  /** Latest status code, e.g. "in_call_recording", "done", "fatal". */
  code: string;
  subCode?: string;
  /** Download links once the recording is finished (short-lived, never logged). */
  audioUrl?: string;
  speakerTimelineUrl?: string;
}

export interface CreateBotRequest {
  meetingUrl: string;
  botName: string;
  joinAt?: string;
  chatMessage: string;
  /** Our session id, echoed back in webhooks. */
  sessionId: string;
}

/** The meeting-bot service seam: Recall.ai in real mode, a simulated bot in demo mode and tests. */
export interface BotProviderClient {
  readonly name: 'recall' | 'demo';
  createBot(input: CreateBotRequest): Promise<{ providerBotId: string }>;
  /** Asks a bot that is in (or joining) a call to leave. */
  leaveCall(providerBotId: string): Promise<void>;
  /** Removes a bot scheduled for later that hasn't joined yet. */
  cancelScheduled(providerBotId: string): Promise<void>;
  getBot(providerBotId: string): Promise<ProviderBotState>;
  /** Downloads a finished recording or a JSON artifact (size-capped). */
  download(url: string, maxBytes: number): Promise<Buffer>;
  /** Deletes the provider's stored copy of the recording (retention). */
  deleteMedia(providerBotId: string): Promise<void>;
}

/** Settings stored on the server for the notetaker. */
export interface BotSettings {
  /** Send the notetaker automatically to synced calendar meetings that have a Zoom/Teams/Meet link. */
  autoSendToSynced: boolean;
  /** Who turned automatic sending on, confirming participants will be told meetings are recorded. */
  autoConsent?: { confirmedAt: string; confirmedBy?: string };
}

export const BOT_NAME = 'Meeting Assistant Notetaker';
export const BOT_CHAT_MESSAGE =
  'Hi, I’m Meeting Assistant Notetaker. This meeting is being recorded to prepare minutes, which a person reviews before anything is shared. Ask the organizer if you’d like me to leave.';

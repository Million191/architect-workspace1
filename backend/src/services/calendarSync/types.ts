import { MeetingPlatform } from './meetingLinks';

export type CalendarProvider = 'google' | 'microsoft';
export const PROVIDER_LABEL: Record<CalendarProvider, string> = { google: 'Google Calendar', microsoft: 'Outlook' };

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  scope?: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
}

export interface SyncOptions {
  /** Skip all-day events (holidays, out-of-office). Default true. */
  skipAllDay: boolean;
  /** Skip events with nobody else invited (focus time, reminders). Default true. */
  skipSolo: boolean;
}

/** One connected account. Tokens are encrypted at rest; everything else is plain. */
export interface CalendarConnection {
  provider: CalendarProvider;
  accountEmail: string;
  accountName?: string;
  calendars: CalendarInfo[];
  selectedCalendarIds: string[];
  options: SyncOptions;
  /** AES-256-GCM sealed JSON of OAuthTokens (see tokenCrypto.ts). Never sent to the page. */
  sealedTokens: string;
  connectedAt: string;
  lastSyncedAt?: string;
  lastSyncSummary?: SyncSummary;
  /** Set when the last sync failed; `needsReconnect` when the sign-in itself is no longer valid. */
  lastError?: { errorClass: string; message: string; at: string; needsReconnect?: boolean };
}

/** What the page may see about a connection (no tokens). */
export type PublicConnection = Omit<CalendarConnection, 'sealedTokens'>;

export interface ExternalAttendee {
  email: string;
  name?: string;
  self?: boolean;
  /** Rooms and equipment are not people. */
  resource?: boolean;
  organizer?: boolean;
}

/** An event as read from a provider, already normalised. */
export interface ExternalEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO with offset (timed) — all-day events carry date-only strings and `allDay`. */
  start: string;
  end: string;
  allDay: boolean;
  cancelled: boolean;
  attendees: ExternalAttendee[];
  link?: string;
  platform: MeetingPlatform;
  description?: string;
  /** Provider's last-modified time, used to skip unchanged events. */
  updated?: string;
}

export interface SyncSummary {
  added: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  skipped: number;
}

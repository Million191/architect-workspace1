/**
 * A live recording made in the app (in-person microphone, or an online meeting captured on this
 * computer). Audio arrives as numbered chunks every few seconds; on "finish" the chunks are joined
 * in order and the file goes through the same pipeline as an upload.
 */
export type RecordingMode = 'in_person' | 'browser_capture';

/**
 * recording → (finish) processing → ready (runId set)
 *                                 → failed (finish may be retried)
 * Any state except processing can be discarded.
 */
export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed';

export interface RecordingMarker {
  /** Milliseconds from the start of the recording (pauses excluded). */
  atMs: number;
  note: string;
}

export interface RecordingAttendee {
  name: string;
  email?: string;
}

export interface RecordingMeta {
  id: string;
  mode: RecordingMode;
  title?: string;
  attendees: RecordingAttendee[];
  /** Calendar meeting this recording belongs to (title and participants came from it). */
  scheduledMeetingId?: string;
  mimeType: string;
  /** File extension the joined audio is saved with (webm, ogg, mp4, wav). */
  extension: string;
  /** "Everyone in this meeting knows it is being recorded" — required before the first chunk. */
  consent: { confirmedAt: string; confirmedBy?: string };
  status: RecordingStatus;
  /** Chunk indices received (sorted). */
  chunks: number[];
  bytes: number;
  durationMs?: number;
  markers: RecordingMarker[];
  runId?: string;
  error?: { errorClass: string; message: string; stage?: string };
  /** Set when the raw audio was deleted under the retention setting; the meeting itself stays. */
  audioDeletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** How long raw audio is kept after a recording becomes a meeting. */
export type RawAudioRetention = 'after_approval' | '30_days' | 'keep';

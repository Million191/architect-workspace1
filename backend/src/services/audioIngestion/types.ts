export type VirtualMeetingPlatform = 'zoom' | 'teams' | 'meet';
export type PhysicalAudioSource = 'room_mic' | 'phone';
export type AudioSource = VirtualMeetingPlatform | PhysicalAudioSource;

export type MeetingType = 'Virtual' | 'In-Person';

/** The `[Meeting Type — Source]` header tag for a processed meeting's output. See REQ-004. */
export interface OutputTag {
  meetingType: MeetingType;
  sourceLabel: string;
  header: string;
  /** True when a physical recording had no location supplied, so `sourceLabel` is a fallback, not a real place. */
  locationUnknown: boolean;
}

// 'mp4' is here because Microsoft Teams cloud recordings are always delivered as an MP4
// container (video + AAC audio track) — there's no separate audio-only export like Zoom's
// M4A recording type. Rejecting mp4 would mean Teams ingestion could never succeed.
export const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'mp4'] as const;
export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export interface IngestedAudio {
  /** Idempotency key: derived from (source, sourceRecordingId) so re-ingesting is a no-op. */
  id: string;
  source: AudioSource;
  sourceRecordingId: string;
  format: SupportedAudioFormat;
  sizeBytes: number;
  /**
   * Where transcription fetches the actual audio bytes from. Only set for virtual-source
   * ingestion (Zoom/Teams/Meet), which fetches from a platform-hosted URL; absent for
   * physical sources, which are ingested from an uploaded buffer with no URL to carry.
   */
  downloadUrl?: string;
  ingestedAt: string;
  status: 'available_for_transcription';
  /**
   * Signal-quality flag. Only set for physical-source ingestion (room mic / phone), which
   * runs an actual quality check on the uploaded bytes; absent (not `false`) for virtual
   * sources, which don't assess quality at ingestion time — absence means "not assessed",
   * not "assessed and fine".
   */
  lowConfidence?: boolean;
  lowConfidenceReason?: string;
  /** [Meeting Type — Source] header tag, computed at ingest time from `source` (see REQ-004). */
  outputTag: OutputTag;
}

/** One media file attached to a platform's recording, in a shape common across platforms. */
export interface PlatformRecordingFile {
  id: string;
  fileExtension: string;
  fileSizeBytes: number;
  downloadUrl: string | null;
}

export interface PlatformRecording {
  files: PlatformRecordingFile[];
}

/** What every virtual-platform client (Zoom, Teams, Meet) must implement. */
export interface PlatformClient {
  fetchRecording(meetingRef: string): Promise<PlatformRecording>;
}

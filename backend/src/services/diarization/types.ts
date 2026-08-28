import { TranscriptSegment } from '../transcription/types';

/** The label every unmapped speaker gets — no attendee list, an unrecognized mapping, or a name-mapping service failure all degrade to this. */
export const UNIDENTIFIED_SPEAKER_LABEL = 'Unidentified Speaker';

/** One person on the meeting's attendee list, as supplied by the caller (e.g. from a calendar invite). */
export interface Attendee {
  name: string;
}

/** One segment exactly as a diarization provider returns it, before this service aligns it to the transcript. */
export interface RawSpeakerSegment {
  startMs: number;
  endMs: number;
  /** Provider-assigned speaker id, e.g. "SPEAKER_00" — not a real name yet. */
  speakerTag: string;
}

/** What the diarization service hands a provider client to work with. */
export interface DiarizationInput {
  audioId: string;
  buffer: Buffer;
}

/**
 * What any speaker-diarization provider integration must implement. No implementation of
 * this exists yet — wiring a real provider (a paid external service) is a deliberate
 * dependency decision outside this story's scope, same boundary STORY-005 drew for
 * `TranscriptionClient`. Tests supply a fake; production wiring is a future story.
 */
export interface DiarizationClient {
  diarize(input: DiarizationInput): Promise<RawSpeakerSegment[]>;
}

/**
 * What any name-mapping provider (or lookup service) must implement. Given the raw speaker
 * tags diarization produced and the meeting's attendee list, it returns a best-effort map of
 * `speakerTag -> attendee name`. A tag it can't confidently resolve should simply be absent
 * from the returned map, not guessed.
 */
export interface NameMappingClient {
  mapSpeakersToNames(speakerTags: string[], attendees: Attendee[]): Promise<Record<string, string>>;
}

/** One transcript segment with a speaker attributed to it. */
export interface DiarizedSegment extends TranscriptSegment {
  /** Provider-assigned speaker id this segment was aligned to, e.g. "SPEAKER_00". */
  rawSpeakerTag: string;
  /** Real attendee name, or `UNIDENTIFIED_SPEAKER_LABEL` when unmapped. */
  speakerLabel: string;
}

export interface SpeakerMapping {
  /** Idempotency key, derived from the source transcript's id — re-diarizing the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` this mapping was generated from. */
  transcriptId: string;
  segments: DiarizedSegment[];
  generatedAt: string;
}

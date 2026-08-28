import { SupportedAudioFormat } from '../audioIngestion/types';

/**
 * One line of a finished transcript. `startMs`/`endMs` are milliseconds from the start of
 * the audio, per REQ-005 ("transcribe audio to text with timestamps") — every segment must
 * carry both so a reader can follow the meeting timeline line by line.
 */
export interface TranscriptSegment {
  startMs: number;
  /** Always > startMs; a zero-length or reversed segment is a timestamp-misalignment failure, not a valid segment. */
  endMs: number;
  text: string;
}

export interface Transcript {
  /** Idempotency key, derived from the source audio's id — re-transcribing the same audio is a no-op. */
  id: string;
  /** The `IngestedAudio.id` this transcript was generated from. */
  audioId: string;
  segments: TranscriptSegment[];
  generatedAt: string;
}

/** What the transcription service hands a provider client to work with. */
export interface TranscriptionInput {
  audioId: string;
  format: SupportedAudioFormat;
  buffer: Buffer;
}

/** One segment exactly as a provider returns it, before this service validates it. */
export interface RawTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * What any speech-to-text provider integration must implement. No implementation of this
 * exists yet — wiring a real provider (a paid external service) is a deliberate dependency
 * decision outside this story's scope (CLAUDE.md's Autonomy Model: "external dependency
 * introduction, paid external services" is an escalation trigger, not an implementation
 * detail). Tests supply a fake; production wiring is a future story.
 */
export interface TranscriptionClient {
  transcribe(input: TranscriptionInput): Promise<RawTranscriptSegment[]>;
}

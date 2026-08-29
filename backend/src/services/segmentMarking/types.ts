import { Transcript, TranscriptSegment } from '../transcription/types';

/** Exact marker text REQ-007 specifies for a segment the system could not transcribe at all. */
export const INAUDIBLE_LABEL = '[inaudible]';
/** Exact marker text REQ-007 specifies for a segment that transcribed but isn't trustworthy. */
export const UNCLEAR_LABEL = '[unclear — verify]';

/**
 * `inaudible` and `unclear` are judged from two independent signals, since no real
 * speech-to-text provider is wired in yet (same seam STORY-005/006 left open):
 *  - empty/whitespace-only `text` — a provider returning nothing for a segment is a direct,
 *    provider-independent signal that it couldn't be heard, always `inaudible` regardless of
 *    `confidence`.
 *  - `confidence` bands, when a provider supplies one — below `INAUDIBLE_CONFIDENCE_THRESHOLD`
 *    is `inaudible`, below `UNCLEAR_CONFIDENCE_THRESHOLD` is `unclear`.
 * A segment with non-empty text and no `confidence` (or a high one) is `clear` — absence of a
 * trouble signal is treated as clear, never guessed into `unclear`.
 */
export type SegmentAudibility = 'clear' | 'inaudible' | 'unclear';

/** Below this confidence (0-1), a scored segment is marked `[inaudible]` outright. */
export const INAUDIBLE_CONFIDENCE_THRESHOLD = 0.3;
/** Below this confidence (0-1) but at/above the inaudible threshold, a segment is `[unclear — verify]`. */
export const UNCLEAR_CONFIDENCE_THRESHOLD = 0.6;

export interface MarkedSegment extends TranscriptSegment {
  audibility: SegmentAudibility;
  /** `INAUDIBLE_LABEL`, `UNCLEAR_LABEL`, or absent when `audibility` is `'clear'`. */
  marker?: string;
}

export interface MarkedTranscript {
  /** Idempotency key, derived from the source transcript's id — re-marking the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` this marking was generated from. */
  transcriptId: string;
  segments: MarkedSegment[];
  generatedAt: string;
}

export interface MarkSegmentsInput {
  transcript: Transcript;
}

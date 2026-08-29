import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';

/** One topic label + timestamp range exactly as a provider returns it, before this service
 * validates and aligns it against the transcript's own segments. */
export interface RawTopicSegment {
  topic: string;
  startMs: number;
  endMs: number;
  /** Provider-generated summary text for what was discussed in this range. */
  summary: string;
}

/** What the discussion-summary service hands a provider client to work with. */
export interface TopicSummarizationInput {
  transcriptId: string;
  /** Segment text + timing, in order — the same shape the transcript already carries. */
  segments: Array<Pick<MarkedSegment, 'startMs' | 'endMs' | 'text'>>;
}

/**
 * What any topic-summarization provider integration must implement. No implementation of this
 * exists yet — wiring a real provider (a paid external service, e.g. an LLM summarization API)
 * is a deliberate dependency decision outside this story's scope, same governance boundary
 * STORY-005 drew for `TranscriptionClient` and STORY-006 drew for `DiarizationClient`. Tests
 * supply a fake; production wiring is a future story.
 *
 * The returned segments must cover the input segments' full time range in order and without
 * gaps — this service validates that shape rather than trusting it blindly, since a provider
 * returning overlapping, out-of-order, or gapped ranges is exactly the "incorrect topic
 * grouping" failure path this story must handle.
 */
export interface TopicSummarizationClient {
  summarizeTopics(input: TopicSummarizationInput): Promise<RawTopicSegment[]>;
}

/** One topic's worth of grouped discussion, with the timestamp range it spans and a one-line summary. */
export interface DiscussionTopic {
  topic: string;
  startMs: number;
  endMs: number;
  /** Provider-supplied summary text for this topic's segments. */
  summary: string;
  /** True if any segment in this topic's range was marked `unclear` or `inaudible` by STORY-007's
   * segment marking — surfaced here rather than re-derived, since that's already the system's one
   * source of truth for audibility. */
  flaggedForReview: boolean;
  /** Marker text (`[unclear — verify]` / `[inaudible]`) for each flagged segment in this topic, for
   * a reviewer to locate what needs checking without re-scanning the whole transcript. */
  flagReasons: string[];
}

export interface DiscussionSummary {
  /** Idempotency key, derived from the source transcript's id — re-summarizing the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` (== `MarkedTranscript.transcriptId`) this summary was generated from. */
  transcriptId: string;
  topics: DiscussionTopic[];
  generatedAt: string;
}

export interface SummarizeDiscussionInput {
  markedTranscript: MarkedTranscript;
}

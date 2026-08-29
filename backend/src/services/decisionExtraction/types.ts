import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';

/** One decision exactly as a provider returns it, before this service validates and aligns it
 * against the transcript's own segments. Fields are optional here on purpose — a provider
 * omitting `rationale`, `approver`, or `timestampMs` is the story's "missing decision fields"
 * failure path, not a shape this type should reject at the boundary. */
export interface RawDecision {
  decision: string;
  rationale?: string;
  approver?: string;
  /** Must fall within the transcript's segment span to be trusted — see `IncorrectDecisionListingError`. */
  timestampMs?: number;
}

/** What the decision-extraction service hands a provider client to work with. */
export interface DecisionExtractionInput {
  transcriptId: string;
  /** Segment text + timing, in order — the same shape the transcript already carries. */
  segments: Array<Pick<MarkedSegment, 'startMs' | 'endMs' | 'text'>>;
}

/**
 * What any decision-extraction provider integration must implement. No implementation of this
 * exists yet — wiring a real provider (a paid external service, e.g. an LLM extraction API) is a
 * deliberate dependency decision outside this story's scope, same governance boundary
 * STORY-005/006 drew for `TranscriptionClient`/`DiarizationClient` and STORY-009 drew for
 * `TopicSummarizationClient`. Tests supply a fake; production wiring is a future story.
 *
 * The returned decisions are not assumed complete or well-formed — this service validates each
 * one (missing fields, out-of-range timestamps) rather than trusting the provider blindly.
 */
export interface DecisionExtractionClient {
  extractDecisions(input: DecisionExtractionInput): Promise<RawDecision[]>;
}

/** One decision as listed in the minutes: what was decided, why, who approved it, and when. */
export interface Decision {
  decision: string;
  rationale?: string;
  approver?: string;
  timestampMs?: number;
  /** Which required fields (`rationale`, `approver`, `timestampMs`) this decision is missing —
   * empty when the decision is complete. This is the story's "missing decision fields" failure
   * path: a decision with gaps is still listed, but flagged rather than silently shipped as if
   * it were complete. */
  missingFields: Array<'rationale' | 'approver' | 'timestampMs'>;
  /** True whenever `missingFields` is non-empty — convenience flag for a reviewer/UI, mirroring
   * `DiscussionTopic.flaggedForReview` from STORY-009. */
  flaggedForReview: boolean;
}

export interface DecisionListing {
  /** Idempotency key, derived from the source transcript's id — re-listing the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` (== `MarkedTranscript.transcriptId`) this listing was generated from. */
  transcriptId: string;
  decisions: Decision[];
  generatedAt: string;
}

export interface ListDecisionsInput {
  markedTranscript: MarkedTranscript;
}

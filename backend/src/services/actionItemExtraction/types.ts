import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';

/** One action item exactly as a provider returns it, before this service validates and aligns it
 * against the transcript's own segments. Fields are optional here on purpose — a provider
 * omitting `owner`, `dueDate`, `priority`, or `status` is the story's "missing action item fields"
 * failure path, not a shape this type should reject at the boundary. */
export interface RawActionItem {
  task: string;
  owner?: string;
  /** ISO-8601 date string, e.g. "2026-09-05". Not validated against the meeting date here — a
   * provider-supplied due date is trusted as given once it's a well-formed ISO date. */
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'open' | 'in_progress' | 'done';
  /** Must fall within the transcript's segment span to be trusted — see `IncorrectActionItemExtractionError`. */
  sourceTimestampMs?: number;
}

/** What the action-item-extraction service hands a provider client to work with. */
export interface ActionItemExtractionInput {
  transcriptId: string;
  /** Segment text + timing, in order — the same shape the transcript already carries. */
  segments: Array<Pick<MarkedSegment, 'startMs' | 'endMs' | 'text'>>;
}

/**
 * What any action-item-extraction provider integration must implement. No implementation of this
 * exists yet — wiring a real provider (a paid external service, e.g. an LLM extraction API) is a
 * deliberate dependency decision outside this story's scope, same governance boundary
 * STORY-005/006 drew for `TranscriptionClient`/`DiarizationClient`, STORY-009 drew for
 * `TopicSummarizationClient`, and STORY-010 drew for `DecisionExtractionClient`. Tests supply a
 * fake; production wiring is a future story.
 *
 * The returned action items are not assumed complete or well-formed — this service validates each
 * one (missing fields, out-of-range timestamps) rather than trusting the provider blindly.
 */
export interface ActionItemExtractionClient {
  extractActionItems(input: ActionItemExtractionInput): Promise<RawActionItem[]>;
}

/** One action item as listed in the minutes table: what to do, who owns it, when it's due, how
 * urgent it is, its current status, and when in the meeting it was raised. */
export interface ActionItem {
  task: string;
  owner?: string;
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'open' | 'in_progress' | 'done';
  sourceTimestampMs?: number;
  /** Which required fields (`owner`, `dueDate`, `priority`, `status`, `sourceTimestampMs`) this
   * action item is missing — empty when the item is complete. This is the story's "missing action
   * item fields" failure path: an item with gaps is still listed, but flagged rather than
   * silently shipped as if it were complete. */
  missingFields: Array<'owner' | 'dueDate' | 'priority' | 'status' | 'sourceTimestampMs'>;
  /** True whenever `missingFields` is non-empty — convenience flag for a reviewer/UI, mirroring
   * `Decision.flaggedForReview` from STORY-010. */
  flaggedForReview: boolean;
}

export interface ActionItemTable {
  /** Idempotency key, derived from the source transcript's id — re-extracting the same transcript is a no-op. */
  id: string;
  /** The `Transcript.id` (== `MarkedTranscript.transcriptId`) this table was generated from. */
  transcriptId: string;
  actionItems: ActionItem[];
  generatedAt: string;
}

export interface ExtractActionItemsInput {
  markedTranscript: MarkedTranscript;
}

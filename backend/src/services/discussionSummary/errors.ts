/**
 * Base for all discussion-summary failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class DiscussionSummaryError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely extract discussion points from — a missing transcript id,
 * a non-array `segments`, or a segment missing usable text/timing. This is the story's
 * "discussion point extraction failure" failure path: rather than guess topics from input that
 * doesn't hold up, extraction fails loud for the whole request so a bad summary is never
 * shipped.
 */
export class ContractViolationError extends DiscussionSummaryError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The topic-summarization provider returned topic ranges that don't validly cover the
 * transcript — out of order, overlapping, or leaving a gap between segments that were actually
 * spoken. This is the story's "incorrect topic grouping" failure path: the provider call
 * succeeded, but its shape can't be trusted to build a summary from, so this fails the whole
 * operation rather than shipping a summary with silently dropped or duplicated segments.
 */
export class IncorrectTopicGroupingError extends DiscussionSummaryError {
  readonly errorClass = 'IncorrectTopicGroupingError';
}

/**
 * The topic-summarization provider failed or timed out after exhausting retries. This is the
 * story's "failure to summarize points" failure path. No safe fallback exists — there is no
 * heuristic in this codebase that groups transcript text into topics, per the seam this story
 * deliberately leaves for a real provider (same boundary STORY-005/006 drew) — so this fails
 * the whole operation rather than shipping a guessed grouping.
 */
export class TopicSummarizationFailedError extends DiscussionSummaryError {
  readonly errorClass = 'TopicSummarizationFailedError';
}

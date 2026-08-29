import { MeetingSummary } from '../meetingSummary/types';
import { DiscussionTopic } from '../discussionSummary/types';
import { Decision } from '../decisionExtraction/types';
import { ActionItem } from '../actionItemExtraction/types';

/**
 * The draft minutes as assembled from every generation stage built so far (STORY-008/009/010/011).
 * This service does not generate any of these fields itself — it only holds them under review.
 * Keyed by `transcriptId`, the same join key every upstream service already uses, so the same
 * transcript's minutes always map to the same review session (see `ReviewGateSession.id`).
 */
export interface DraftMinutes {
  transcriptId: string;
  meetingSummary: MeetingSummary;
  discussionTopics: DiscussionTopic[];
  decisions: Decision[];
  actionItems: ActionItem[];
}

/**
 * `pending_review` — awaiting an explicit approve/revise decision; this is the only state Gate #1
 * blocks in (see `assertApprovedForEmailDrafting` in the service, the seam STORY-013 will call).
 * `approved` — Gate #1 has passed for the draft currently on the session.
 *
 * There is deliberately no separate "revision requested" state: the acceptance criteria describe
 * receiving edits and re-presenting the draft as one action, so `requestRevision` applies the
 * revision and puts the session straight back into `pending_review` with the new draft, rather
 * than parking it in an extra state that would need a second explicit call to leave.
 */
export type ReviewGateStatus = 'pending_review' | 'approved';

/** One requested-edit round: what changed, who asked for it, and what the draft looked like at
 * the moment the edit was requested — kept so the full revision history is auditable rather than
 * only ever showing the latest draft. */
export interface RevisionRecord {
  requestedAt: string;
  requestedBy?: string;
  changesRequested: string;
  draftAtRequest: DraftMinutes;
}

/** Gate #1's live state for one meeting's minutes: current draft, current status, and full
 * revision history back to the first submission. */
export interface ReviewGateSession {
  /** Idempotency key — equals `transcriptId`. Re-submitting the same transcript's minutes for
   * review is a no-op against an existing open session, not a fresh one, mirroring the
   * `id` == source-key convention every upstream service in this project already uses. */
  id: string;
  transcriptId: string;
  status: ReviewGateStatus;
  draft: DraftMinutes;
  revisions: RevisionRecord[];
  submittedAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface SubmitForReviewInput {
  draft: DraftMinutes;
}

export interface RequestRevisionInput {
  sessionId: string;
  changesRequested: string;
  revisedDraft: DraftMinutes;
  requestedBy?: string;
}

export interface ApproveInput {
  sessionId: string;
  approvedBy: string;
}

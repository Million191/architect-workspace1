import { ActionItem } from '../actionItemExtraction/types';

/**
 * One participant's individualized email, built entirely from the approved draft minutes behind
 * Gate #1 (see `reviewGate/reviewGateService.ts`'s `assertApprovedForEmailDrafting`) — this
 * service never accepts a draft directly, only a `reviewGateSessionId`, so it is structurally
 * impossible to draft an email from minutes that were never approved.
 */
export interface DraftedEmail {
  /** Name as it appears in `MeetingSummary.attendees` — the only identifier this system has for a
   * participant. No attendee record in this codebase carries an email address yet (see
   * `Attendee` in diarization/types.ts), so there is no `recipientEmail` field here; delivery
   * (STORY-014/015) is a separate concern this story does not build. */
  participantName: string;
  subject: string;
  /** Shared summary + decisions, plus only this participant's own action items — never anyone
   * else's, per the architecture doc's "Email Drafting Service" description. Says exactly "No
   * action items assigned to you from this meeting." when `actionItems` is empty, per this
   * story's own acceptance criterion — not a paraphrase. */
  body: string;
  /** This participant's action items, kept alongside `body` so a reviewer/test can check the
   * personalization without re-parsing prose out of `body`. Filtered from the approved draft's
   * `actionItems` by `owner` matching `participantName` (case-insensitive), the same matching
   * convention `search_action_items` in the meeting-assistant MCP server already uses. */
  actionItems: ActionItem[];
}

/** One action item whose `owner` didn't match any name in `MeetingSummary.attendees` (typo,
 * someone not on the attendee list, etc.) — surfaced here rather than silently dropped or
 * silently attached to the wrong person's email. */
export interface UnmatchedActionItem {
  actionItem: ActionItem;
  reason: string;
}

export interface EmailDraftBatch {
  /** Idempotency key — equals `reviewGateSessionId`. Re-drafting from the same approved session is
   * a no-op against the existing batch, not a fresh one, mirroring every other service's
   * id-equals-source-key convention. */
  id: string;
  transcriptId: string;
  reviewGateSessionId: string;
  emails: DraftedEmail[];
  /** Action items whose `owner` matched no name in `MeetingSummary.attendees` — not attached to
   * any `DraftedEmail`, since there is no participant to attach them to. */
  unmatchedActionItems: UnmatchedActionItem[];
  /** True whenever `unmatchedActionItems` is non-empty — mirrors the `flaggedForReview`
   * convention every upstream service (STORY-008/009/010/011) already uses, at the batch level
   * rather than per-email since an unmatched item isn't any one participant's problem. */
  flaggedForReview: boolean;
  generatedAt: string;
}

export interface DraftEmailsInput {
  /** The Gate #1 session id to draft from. `assertApprovedForEmailDrafting` is called with this
   * before anything else happens — see reviewGate/reviewGateService.ts. */
  reviewGateSessionId: string;
}

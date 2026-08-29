import { ActionItem } from '../actionItemExtraction/types';

/**
 * What this service needs to decide whether to propose a next meeting: the concluded meeting's id
 * (for idempotency), when it concluded (the anchor the proposed date/time is computed from), and
 * its open items. `openItems` is deliberately generic about source — it covers both this meeting's
 * own unresolved action items and any prior-meeting items the caller is carrying forward for a
 * recurring series; this service doesn't need to know which, it just proposes when the combined
 * list is non-empty and carries all of it over.
 */
export interface ProposeNextMeetingInput {
  meetingId: string;
  /** ISO-8601 timestamp for when the meeting concluded. */
  concludedAt: string;
  openItems: ActionItem[];
}

/** The next meeting date/time this service suggests, and why. */
export interface NextMeetingProposal {
  /** ISO-8601 timestamp. */
  proposedDateTime: string;
  rationale: string;
}

/**
 * Idempotency key is `meetingId` — re-running for the same concluded meeting is a no-op. `proposed`
 * is false (with `proposal` absent) whenever there are no open items, satisfying the "don't propose
 * when not needed" acceptance criterion explicitly rather than via an empty/optional field alone.
 */
export interface NextMeetingProposalResult {
  id: string;
  meetingId: string;
  proposed: boolean;
  proposal?: NextMeetingProposal;
  carriedOverItems: ActionItem[];
  generatedAt: string;
}

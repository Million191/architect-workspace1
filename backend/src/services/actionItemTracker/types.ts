import { ActionItem } from '../actionItemExtraction/types';

/**
 * Proof that a batch of drafted emails was actually sent — the signal the (not-yet-built) Email
 * Delivery Service would emit per project-blueprint/meeting-assistant-architecture.md's "send
 * confirmation" arrow. `sendingReviewGateSessionId` must reference a session that already passed
 * Gate #2 (see `reviewGateSending/reviewGateSendingService.ts`'s `assertApprovedForSending`) — this
 * service will not trust a confirmation for a batch that was never approved to send.
 */
export interface EmailSendConfirmation {
  sendingReviewGateSessionId: string;
  sentAt: string;
  /** Participant names (matching `MeetingSummary.attendees`) the Email Delivery Service confirmed
   * as sent to. Not used to filter which action items get logged — every action item in the
   * approved batch is logged once send is confirmed, per the architecture doc's "Tracker" arrow
   * receiving all action items from Records, not just the emailed ones. Kept on the confirmation
   * for audit completeness and for a future story that may need it. */
  confirmedRecipients: string[];
}

/**
 * One action item as it exists in the tracker: the original `ActionItem` from
 * `actionItemExtraction`, plus tracker-only fields. `status` here is deliberately a
 * tracker-specific vocabulary distinct from `ActionItem.status` (`open`/`in_progress`/`done`) — see
 * the architecture doc's "status: Not Started / Stale / Carried-over" arrow. STORY-015 only ever
 * produced `'Not Started'`; STORY-016 adds `'Stale'`. `'Carried-over'` (the next-meeting-agenda
 * concern) is still out of scope here.
 */
export interface TrackedActionItem {
  actionItem: ActionItem;
  status: 'Not Started' | 'Stale';
  loggedAt: string;
}

/**
 * Input to the stale-item comparison (REQ-017): the same action item tracked across two
 * occurrences of a recurring meeting. `priorOpenItems` is what the tracker already had on record
 * as open before this run; `currentOpenItems` is what's open now. Matching between the two lists
 * is by `(actionItem.task, actionItem.owner)`, case-insensitive — the same convention
 * `emailDraftingService` already uses for owner matching. `now` is injectable so tests don't
 * depend on the real clock.
 */
export interface StaleComparisonInput {
  priorOpenItems: TrackedActionItem[];
  currentOpenItems: TrackedActionItem[];
  now?: Date;
}

/** One item's outcome after comparison: whether it crossed the 2-week-open threshold, and the
 * `loggedAt` the age was computed from (the earliest sighting across the prior/current lists when
 * the item matched one from `priorOpenItems`, otherwise its own `loggedAt`). */
export interface StaleComparisonResultItem {
  actionItem: ActionItem;
  status: 'Not Started' | 'Stale';
  daysOpen: number;
  firstLoggedAt: string;
}

/** Whole-comparison result. `allCurrent` is `staleCount === 0`, kept as its own field so callers
 * (and tests) can assert the "nothing is stale" acceptance criterion directly instead of deriving
 * it from a count. */
export interface StaleComparisonResult {
  items: StaleComparisonResultItem[];
  staleCount: number;
  allCurrent: boolean;
}

/**
 * What any action-item-tracker provider integration must implement. No implementation exists yet —
 * wiring a real tracker (Jira, Asana, an internal DB) is a deliberate external-dependency decision
 * outside this story's scope, the same governance boundary STORY-005/006/009/010/011 drew for their
 * own provider seams. Tests supply a fake; production wiring is a future story.
 */
export interface ActionItemTrackerClient {
  logActionItems(items: TrackedActionItem[]): Promise<void>;
}

export interface LogActionItemsInput {
  confirmation: EmailSendConfirmation;
}

export interface TrackerLogResult {
  /** Idempotency key — equals `EmailSendConfirmation.sendingReviewGateSessionId`. Re-confirming the
   * same send is a no-op against the existing result, not a fresh log, mirroring every other
   * service's id-equals-source-key convention. */
  id: string;
  sendingReviewGateSessionId: string;
  loggedItems: TrackedActionItem[];
  loggedAt: string;
}

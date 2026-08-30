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
 * the architecture doc's "status: Not Started / Stale / Carried-over" arrow. This story only ever
 * produces `'Not Started'`; `'Stale'`/`'Carried-over'` are STORY-016's concern, not built here.
 */
export interface TrackedActionItem {
  actionItem: ActionItem;
  status: 'Not Started';
  loggedAt: string;
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

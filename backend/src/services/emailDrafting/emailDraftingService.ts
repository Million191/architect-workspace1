import { assertApprovedForEmailDrafting, ReviewGateOptions } from '../reviewGate/reviewGateService';
import { DraftMinutes } from '../reviewGate/types';
import { ActionItem } from '../actionItemExtraction/types';
import { ContractViolationError, EmailDraftingFailedError } from './errors';
import { recordAuditEvent } from './auditLog';
import { DraftedEmail, DraftEmailsInput, EmailDraftBatch, UnmatchedActionItem } from './types';

export interface EmailDraftingLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: EmailDraftingLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.reviewGateSessionId === 'string' ? context.reviewGateSessionId : 'unresolved',
      context,
    });
  },
};

/** Exact wording required by this story's acceptance criterion — not a paraphrase. */
const NO_ACTION_ITEMS_LINE = 'No action items assigned to you from this meeting.';

export interface EmailDraftingOptions {
  logger?: EmailDraftingLogger;
  /** Forwarded to `assertApprovedForEmailDrafting` — lets tests point at an isolated review-gate
   * session store instead of the shared module-level one in `reviewGateService.ts`. */
  reviewGateOptions?: ReviewGateOptions;
}

function recordFailure(resourceId: string, event: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

function formatActionItemLine(item: ActionItem): string {
  const due = item.dueDate ? ` (due ${item.dueDate})` : '';
  const priority = item.priority ? ` [${item.priority} priority]` : '';
  return `- ${item.task}${due}${priority}`;
}

/** Shared summary + decisions, plus only this participant's own action items — never anyone
 * else's, per the architecture doc's "Email Drafting Service" description. */
function buildBody(draft: DraftMinutes, participantName: string, ownItems: ActionItem[]): string {
  const topicLines = draft.discussionTopics.map((t) => `- ${t.topic}: ${t.summary}`);
  const decisionLines = draft.decisions.map((d) => `- ${d.decision}`);
  const actionSection = ownItems.length > 0 ? ownItems.map(formatActionItemLine).join('\n') : NO_ACTION_ITEMS_LINE;

  return [
    `Hi ${participantName},`,
    '',
    `Here is a recap of "${draft.meetingSummary.title ?? 'the meeting'}":`,
    '',
    'Discussion topics:',
    topicLines.length > 0 ? topicLines.join('\n') : '(none recorded)',
    '',
    'Decisions:',
    decisionLines.length > 0 ? decisionLines.join('\n') : '(none recorded)',
    '',
    'Your action items:',
    actionSection,
  ].join('\n');
}

/**
 * Drafts one individualized email per meeting attendee (REQ-014), and only after Gate #1 has
 * explicitly approved the minutes it drafts from — `assertApprovedForEmailDrafting` is called
 * before anything else happens, and its `SessionNotFoundError`/`ReviewNotApprovedError` propagate
 * unchanged rather than being re-wrapped, since those already are the correctly-typed "failure to
 * wait for approval" errors (STORY-012).
 *
 * Each participant's email carries the shared discussion topics and decisions plus only their own
 * action items (owner matched case-insensitively against `MeetingSummary.attendees`, same
 * convention the meeting-assistant MCP server's `search_action_items` tool uses), or the exact
 * "No action items assigned to you from this meeting." line when they have none — this story's
 * second acceptance criterion, satisfied literally rather than paraphrased.
 *
 * An action item whose `owner` doesn't match any attendee is not attached to any email — there is
 * no participant to draft it to — and is instead surfaced in `unmatchedActionItems` so a reviewer
 * can catch a typo'd name rather than the item silently vanishing. This is the story's "incorrect
 * email personalization" failure path: flagged, not silently dropped or misattached.
 *
 * Throws `ContractViolationError` for a missing/malformed `reviewGateSessionId` and
 * `EmailDraftingFailedError` when the approved draft has no attendees at all (nobody to draft an
 * email to) — this story's "failure to draft emails" and "email drafting logic failure" paths.
 * Every attempt and outcome is recorded to the audit trail, satisfying the Trust criterion.
 */
export function draftEmails(
  input: DraftEmailsInput,
  { logger = defaultLogger, reviewGateOptions }: EmailDraftingOptions = {}
): EmailDraftBatch {
  const rawSessionId = input?.reviewGateSessionId;
  logger.info('email_drafting_attempted', { reviewGateSessionId: rawSessionId });

  let batch: EmailDraftBatch;
  try {
    if (typeof rawSessionId !== 'string' || rawSessionId.length === 0) {
      throw new ContractViolationError('reviewGateSessionId is missing or not a string', { reviewGateSessionId: rawSessionId });
    }

    const session = assertApprovedForEmailDrafting(rawSessionId, reviewGateOptions);
    const draft = session.draft;
    const attendees = draft.meetingSummary.attendees ?? [];

    if (attendees.length === 0) {
      throw new EmailDraftingFailedError('Approved draft has no attendees to draft emails for', {
        reviewGateSessionId: rawSessionId,
        transcriptId: draft.transcriptId,
      });
    }

    const emails: DraftedEmail[] = attendees.map((participantName) => {
      const needle = participantName.trim().toLowerCase();
      const ownItems = draft.actionItems.filter((item) => (item.owner ?? '').trim().toLowerCase() === needle);
      return {
        participantName,
        subject: `Recap and action items: ${draft.meetingSummary.title ?? 'Meeting'}`,
        body: buildBody(draft, participantName, ownItems),
        actionItems: ownItems,
      };
    });

    const unmatchedActionItems: UnmatchedActionItem[] = draft.actionItems
      .filter((item) => {
        const owner = (item.owner ?? '').trim();
        if (owner.length === 0) {
          return false; // an ownerless item is already flagged upstream by STORY-011's own missingFields; not this story's concern
        }
        return !attendees.some((name) => name.trim().toLowerCase() === owner.toLowerCase());
      })
      .map((item) => ({ actionItem: item, reason: `owner "${item.owner}" does not match any meeting attendee` }));

    batch = {
      id: rawSessionId,
      transcriptId: draft.transcriptId,
      reviewGateSessionId: rawSessionId,
      emails,
      unmatchedActionItems,
      flaggedForReview: unmatchedActionItems.length > 0,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    recordFailure(typeof rawSessionId === 'string' ? rawSessionId : 'unresolved', 'email_drafting_failed', error);
    throw error;
  }

  logger.info('emails_drafted', {
    reviewGateSessionId: batch.reviewGateSessionId,
    emailCount: batch.emails.length,
    unmatchedActionItemCount: batch.unmatchedActionItems.length,
  });
  return batch;
}

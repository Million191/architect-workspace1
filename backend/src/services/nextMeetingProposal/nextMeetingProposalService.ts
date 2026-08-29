import { ContractViolationError } from './errors';
import { recordAuditEvent } from './auditLog';
import { NextMeetingProposalResult, ProposeNextMeetingInput } from './types';
import { ActionItem } from '../actionItemExtraction/types';

export interface NextMeetingProposalLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: NextMeetingProposalLogger = {
  info(event, context) {
    recordAuditEvent({
      event,
      outcome: 'success',
      resourceId: typeof context.meetingId === 'string' ? context.meetingId : 'unresolved',
      context,
    });
  },
};

/**
 * Proposal results keyed by the concluded meeting's id, so re-running for the same meeting never
 * produces a second, possibly-different proposal.
 * TODO(pre-persistence): move to a DB-backed unique constraint once a data layer exists, per
 * CLAUDE.md's Idempotency & Replayability rules — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, NextMeetingProposalResult>();

/** How far past the meeting's conclusion to suggest the next one — a documented placeholder
 * heuristic, not a real scheduling algorithm (checking attendee availability/calendars would need
 * a calendar integration, a new external dependency outside this story's scope). */
const PROPOSED_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function recordFailure(meetingId: string, event: string, error: unknown): void {
  const errorClass = error instanceof Error && 'errorClass' in error ? String((error as { errorClass: unknown }).errorClass) : 'Error';
  recordAuditEvent({
    event,
    outcome: 'failure',
    resourceId: meetingId,
    errorClass,
    context: { message: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Rejects input this logic cannot safely decide a proposal from, rather than guessing whether to
 * propose. This is the story's sole failure path, at the input boundary.
 */
function validateInput(input: ProposeNextMeetingInput): { meetingId: string; concludedAtMs: number; openItems: ActionItem[] } {
  const meetingId = input?.meetingId;
  if (typeof meetingId !== 'string' || meetingId.length === 0) {
    throw new ContractViolationError('meetingId is missing or not a string', { meetingId });
  }

  const concludedAtMs = new Date(input?.concludedAt).getTime();
  if (!Number.isFinite(concludedAtMs)) {
    throw new ContractViolationError('concludedAt is missing or not a valid ISO-8601 timestamp', {
      meetingId,
      concludedAt: input?.concludedAt,
    });
  }

  if (!Array.isArray(input?.openItems)) {
    throw new ContractViolationError('openItems must be an array', { meetingId });
  }
  input.openItems.forEach((item, index) => {
    if (typeof item?.task !== 'string' || item.task.length === 0) {
      throw new ContractViolationError(`openItems[${index}] is missing its task text`, { meetingId, index });
    }
  });

  return { meetingId, concludedAtMs, openItems: input.openItems };
}

/** An item still counts as open if its status is anything other than 'done' — an absent status
 * (STORY-011's own "missing field, flagged for review" case) is treated as still open, not assumed
 * done, so an item never silently drops out of the carry-over list for lack of a status. */
function isOpen(item: ActionItem): boolean {
  return item.status !== 'done';
}

export interface ProposeNextMeetingOptions {
  logger?: NextMeetingProposalLogger;
  idempotencyStore?: Map<string, NextMeetingProposalResult>;
}

/**
 * Proposes a next meeting date/time and carries over open items for a concluded meeting (REQ-012),
 * deduping on `meetingId` so re-running for the same meeting never produces a second proposal.
 * Proposes only when the meeting has open items (status other than 'done', including items with no
 * status at all); proposes nothing when there are none, satisfying both directions of the
 * acceptance criteria as an explicit decision rather than an implicit empty/optional result. The
 * only failure path is malformed input (`ContractViolationError`) — there is no external provider
 * call here to fail or time out, since the decision is deterministic given data the caller already
 * has. Every attempt, dedup hit, and outcome (proposed or not) is recorded to the audit trail,
 * including the proposed date/time and the full carried-over item list when a proposal is made.
 */
export function proposeNextMeetingAndCarryOverItems(
  input: ProposeNextMeetingInput,
  { logger = defaultLogger, idempotencyStore = defaultIdempotencyStore }: ProposeNextMeetingOptions = {}
): NextMeetingProposalResult {
  // Best-effort id for logging/dedup only — real validation happens inside the try block below, so
  // a malformed meetingId still gets audited.
  const meetingId = input?.meetingId;

  const existing = typeof meetingId === 'string' ? idempotencyStore.get(meetingId) : undefined;
  if (existing) {
    logger.info('next_meeting_proposal_deduplicated', { meetingId });
    return existing;
  }

  logger.info('next_meeting_proposal_attempted', {
    meetingId,
    openItemCount: Array.isArray(input?.openItems) ? input.openItems.length : undefined,
  });

  let result: NextMeetingProposalResult;
  try {
    const { meetingId: validatedMeetingId, concludedAtMs, openItems } = validateInput(input);
    const carriedOverItems = openItems.filter(isOpen);

    if (carriedOverItems.length === 0) {
      result = {
        id: validatedMeetingId,
        meetingId: validatedMeetingId,
        proposed: false,
        carriedOverItems: [],
        generatedAt: new Date().toISOString(),
      };
    } else {
      const proposedDateTime = new Date(concludedAtMs + PROPOSED_INTERVAL_MS).toISOString();
      result = {
        id: validatedMeetingId,
        meetingId: validatedMeetingId,
        proposed: true,
        proposal: {
          proposedDateTime,
          rationale: `${carriedOverItems.length} open item(s) remain from this meeting; suggesting a follow-up one week out.`,
        },
        carriedOverItems,
        generatedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    const resolvedId = typeof meetingId === 'string' ? meetingId : 'unresolved';
    recordFailure(resolvedId, 'next_meeting_proposal_failed', error);
    throw error;
  }

  idempotencyStore.set(result.meetingId, result);
  logger.info(result.proposed ? 'next_meeting_proposed' : 'next_meeting_proposal_skipped_no_open_items', {
    meetingId: result.meetingId,
    proposed: result.proposed,
    proposedDateTime: result.proposal?.proposedDateTime,
    carriedOverItemCount: result.carriedOverItems.length,
    carriedOverItems: result.carriedOverItems.map((item) => ({ task: item.task, owner: item.owner, status: item.status })),
  });

  return result;
}

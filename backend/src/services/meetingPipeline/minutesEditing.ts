import { requestRevision } from '../reviewGate/reviewGateService';
import { DraftMinutes } from '../reviewGate/types';
import { ActionItem } from '../actionItemExtraction/types';
import { Decision } from '../decisionExtraction/types';
import { RunNotFoundError, StageOrderError } from './errors';
import { MeetingPipelineStores } from './types';

/**
 * A reviewer's edits to the draft minutes, field by field and position by position. Positions must
 * match the current draft: edits change wording, owners, due dates, and done/open — they never add
 * or remove items, and never touch timestamps (the evidence links back to the transcript stay intact).
 */
export interface MinutesEdits {
  discussionTopics: Array<{ topic: string; summary: string }>;
  decisions: Array<{ decision: string; rationale?: string; approver?: string }>;
  actionItems: Array<{ task: string; owner?: string; dueDate?: string; done: boolean }>;
}

const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

/** Same "missing fields" rule the extraction services apply, so flags update when a reviewer fills a gap. */
function withDecisionFlags(d: Omit<Decision, 'missingFields' | 'flaggedForReview'>): Decision {
  const missingFields = (['rationale', 'approver', 'timestampMs'] as const).filter((f) => d[f] === undefined);
  return { ...d, missingFields, flaggedForReview: missingFields.length > 0 };
}
function withActionItemFlags(a: Omit<ActionItem, 'missingFields' | 'flaggedForReview'>): ActionItem {
  const missingFields = (['owner', 'dueDate', 'priority', 'status', 'sourceTimestampMs'] as const).filter((f) => a[f] === undefined);
  return { ...a, missingFields, flaggedForReview: missingFields.length > 0 };
}

export function applyEdits(draft: DraftMinutes, edits: MinutesEdits): DraftMinutes {
  if (
    edits.discussionTopics.length !== draft.discussionTopics.length ||
    edits.decisions.length !== draft.decisions.length ||
    edits.actionItems.length !== draft.actionItems.length
  ) {
    throw new StageOrderError('These edits were made to an older version of the minutes. Reload the meeting and try again.', {
      transcriptId: draft.transcriptId,
    });
  }
  return {
    ...draft,
    discussionTopics: draft.discussionTopics.map((t, i) => ({ ...t, topic: edits.discussionTopics[i].topic.trim() || t.topic, summary: edits.discussionTopics[i].summary.trim() })),
    decisions: draft.decisions.map((d, i) =>
      withDecisionFlags({
        decision: edits.decisions[i].decision.trim() || d.decision,
        rationale: blank(edits.decisions[i].rationale),
        approver: blank(edits.decisions[i].approver),
        timestampMs: d.timestampMs,
      })
    ),
    actionItems: draft.actionItems.map((a, i) =>
      withActionItemFlags({
        task: edits.actionItems[i].task.trim() || a.task,
        owner: blank(edits.actionItems[i].owner),
        dueDate: blank(edits.actionItems[i].dueDate),
        priority: a.priority,
        status: edits.actionItems[i].done ? 'done' : 'open',
        sourceTimestampMs: a.sourceTimestampMs,
      })
    ),
  };
}

/**
 * Saves a reviewer's edits through Gate #1's existing revise-and-re-present rule (`requestRevision`),
 * so every edit is on the review session's audit history and the draft stays pending approval.
 * Only allowed before approval #1. Identical edits are a no-op (autosave can safely repeat).
 */
export function reviseMinutes(stores: MeetingPipelineStores, runId: string, edits: MinutesEdits, editedBy?: string): void {
  const session = stores.minutesGate.get(runId);
  if (!session) throw new RunNotFoundError(`No meeting draft found for id "${runId}"`, { runId });
  if (session.status !== 'pending_review') {
    throw new StageOrderError('These minutes are already approved, so they can no longer be edited.', { runId });
  }
  const revised = applyEdits(session.draft, edits);
  if (JSON.stringify(revised) === JSON.stringify(session.draft)) return;
  requestRevision(
    { sessionId: runId, changesRequested: 'Reviewer edited the draft minutes', revisedDraft: revised, requestedBy: editedBy },
    { sessionStore: stores.minutesGate }
  );
}

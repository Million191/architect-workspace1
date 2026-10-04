import { MeetingPipelineStores, PipelineRunView, PipelineStage } from './types';

/** Status shown in the meetings list. Derived only from the run's real stage — never guessed. */
export type MeetingStatus = 'needs_review' | 'approved' | 'sent';

export interface MeetingListItem {
  runId: string;
  title?: string;
  /** Meeting date (YYYY-MM-DD) from the meeting summary, when known. */
  date?: string;
  participants: string[];
  /** Participants with their address when one was given at upload — the key into the People list. */
  people: Array<{ name: string; email?: string }>;
  stage: PipelineStage;
  status: MeetingStatus;
  actionItemCount: number;
  approvedAt?: string;
}

export interface ActionItemListItem {
  runId: string;
  meetingTitle?: string;
  task: string;
  owner?: string;
  dueDate?: string;
  status: string;
  loggedAt: string;
}

function statusOf(stage: PipelineStage): MeetingStatus {
  if (stage === 'sent') return 'sent';
  if (stage === 'approved_not_sent') return 'approved';
  return 'needs_review';
}

/**
 * Every meeting this server knows about: drafts held in memory plus approved meetings saved to
 * disk. Read-only; built from `getRun`, so it can never disagree with what a meeting page shows.
 * Runs that cannot be read (e.g. an old approval saved without its draft) are skipped.
 */
export function listMeetings(stores: MeetingPipelineStores, getRun: (runId: string) => PipelineRunView): MeetingListItem[] {
  const ids = new Set<string>([...stores.minutesGate.keys(), ...stores.finalApprovals.keys()]);
  const items: MeetingListItem[] = [];
  for (const runId of ids) {
    let run: PipelineRunView;
    try {
      run = getRun(runId);
    } catch {
      continue; // not displayable (no draft in memory and no complete saved record)
    }
    const summary = run.minutes.meetingSummary;
    items.push({
      runId,
      title: summary.title,
      date: summary.date,
      participants: summary.attendees,
      people: summary.attendees.map((name) => ({ name, email: run.recipients?.[name] })),
      stage: run.stage,
      status: statusOf(run.stage),
      actionItemCount: run.minutes.actionItems.length,
      approvedAt: run.finalApproval?.approvedAt,
    });
  }
  return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''));
}

/** Every action item recorded by the tracker (after a final approval), newest first. Read-only. */
export function listTrackedActionItems(stores: MeetingPipelineStores): ActionItemListItem[] {
  const items: ActionItemListItem[] = [];
  for (const [runId, result] of stores.tracker) {
    const title = stores.finalApprovals.get(runId)?.minutes?.meetingSummary.title;
    for (const tracked of result.loggedItems) {
      items.push({
        runId,
        meetingTitle: title,
        task: tracked.actionItem.task,
        owner: tracked.actionItem.owner,
        dueDate: tracked.actionItem.dueDate,
        status: tracked.actionItem.status === 'done' ? 'Done' : tracked.status,
        loggedAt: tracked.loggedAt,
      });
    }
  }
  return items.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

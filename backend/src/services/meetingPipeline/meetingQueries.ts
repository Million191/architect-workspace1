import { MeetingPipelineStores, PipelineRunView, PipelineStage } from './types';
import { approvalRound } from './reviewActions';
import { dedupeActionItems } from './dedupe';

/**
 * Status shown in the meetings list, derived only from real records — never guessed:
 * - needs_review: AI minutes are ready and nobody has worked on them yet (or edited approved minutes
 *   that must be approved again).
 * - in_progress: a reviewer has started (edited, corrected, renamed, or requested changes), not approved yet.
 * - approved: a person clicked "Approve minutes" and the email isn't drafted yet (momentary: the email
 *   is drafted right after the approval).
 * - emails_drafted: minutes approved and the email written — waiting for "Approve & send", or approved
 *   in draft-only mode where sending is disabled.
 * - sent: the approved minutes were emailed.
 * "processing" and "failed" exist only on the page / for live recordings, not for pipeline runs.
 */
export type MeetingStatus = 'needs_review' | 'in_progress' | 'approved' | 'emails_drafted' | 'sent';

export interface MeetingListItem {
  runId: string;
  title?: string;
  /** Meeting date (YYYY-MM-DD) from the meeting summary, when known. */
  date?: string;
  /** Start time ("14:05", 24-hour) from the meeting summary, when known. */
  time?: string;
  /** Length of the recording, from the end of the transcript. */
  durationMs?: number;
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

export function statusOf(stage: PipelineStage, reviewStarted: boolean, reopened = false): MeetingStatus {
  if (stage === 'sent') return 'sent';
  if (stage === 'approved_not_sent' || stage === 'emails_pending_approval') return 'emails_drafted';
  // Approved minutes that were edited go back to "Needs review": they must be approved again.
  if (reopened) return 'needs_review';
  return reviewStarted ? 'in_progress' : 'needs_review';
}

/** A reviewer has touched the draft: every edit, correction, rename or change request is a Gate #1 revision. */
export function reviewStarted(stores: MeetingPipelineStores, runId: string): boolean {
  return (stores.minutesGate.get(runId)?.revisions.length ?? 0) > 0;
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
      time: summary.time,
      durationMs: run.transcript.length ? Math.max(...run.transcript.map((s) => s.endMs ?? s.startMs)) : undefined,
      participants: summary.attendees,
      people: summary.attendees.map((name) => ({ name, email: run.recipients?.[name] })),
      stage: run.stage,
      status: statusOf(run.stage, reviewStarted(stores, runId), approvalRound(stores, runId) > 0),
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
    // One row per (task, owner) in a meeting, even for meetings logged before duplicates were removed.
    for (const tracked of dedupeActionItems(result.loggedItems.map((t) => ({ ...t, task: t.actionItem.task, owner: t.actionItem.owner })))) {
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

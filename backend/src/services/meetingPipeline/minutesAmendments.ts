import { requestRevision } from '../reviewGate/reviewGateService';
import { DraftMinutes } from '../reviewGate/types';
import { DraftedEmail } from '../emailDrafting/types';
import { DiarizedSegment } from '../diarization/types';
import { RunNotFoundError, StageOrderError } from './errors';
import { MeetingPipelineProviders, MeetingPipelineStores } from './types';

/**
 * Changes to minutes beyond the original field-by-field edits: replacing the whole draft from the
 * section editor (before approval), amending approved minutes (with a reason), correcting the
 * transcript, and emailing "Updated minutes". Each is safe to repeat.
 */

/** Before approval #1: the editor's content becomes the draft (on Gate #1's revision history). No-op when identical. */
export function replaceDraft(stores: MeetingPipelineStores, runId: string, draft: DraftMinutes, editedBy?: string): void {
  const session = stores.minutesGate.get(runId);
  if (!session) throw new RunNotFoundError(`No meeting draft found for id "${runId}"`, { runId });
  if (session.status !== 'pending_review') throw new StageOrderError('These minutes are already approved. Use “Edit approved minutes” to change them.', { runId });
  if (JSON.stringify(draft) === JSON.stringify(session.draft)) return;
  requestRevision({ sessionId: runId, changesRequested: 'Reviewer edited the draft minutes', revisedDraft: draft, requestedBy: editedBy }, { sessionStore: stores.minutesGate });
}

/** After the final approval: the saved meeting record gets the amended minutes. */
export function amendApprovedMinutes(stores: MeetingPipelineStores, runId: string, draft: DraftMinutes): void {
  const record = stores.finalApprovals.get(runId);
  if (!record?.minutes) throw new StageOrderError('Only minutes that have been approved and sent can be amended.', { runId });
  stores.finalApprovals.set(runId, { ...record, minutes: draft });
  const session = stores.minutesGate.get(runId);
  if (session) stores.minutesGate.set(runId, { ...session, draft });
}

/** Replaces the transcript lines shown for a run (draft or approved). */
export function correctTranscript(stores: MeetingPipelineStores, runId: string, segments: DiarizedSegment[]): void {
  const record = stores.finalApprovals.get(runId);
  const mapping = stores.speakers.get(runId);
  if (!record?.transcript && !mapping) throw new RunNotFoundError(`No transcript found for id "${runId}"`, { runId });
  if (mapping) stores.speakers.set(runId, { ...mapping, segments });
  if (record?.transcript) stores.finalApprovals.set(runId, { ...record, transcript: segments });
}

function updatedBody(draft: DraftMinutes, participant: string, reason: string, by: string): string {
  const own = draft.actionItems.filter((a) => (a.owner ?? '').toLowerCase() === participant.toLowerCase());
  return [
    `Hi ${participant},`,
    '',
    `The minutes for "${draft.meetingSummary.title ?? 'the meeting'}" were updated by ${by}.`,
    `What changed: ${reason}`,
    '',
    'Discussion topics:',
    draft.discussionTopics.length ? draft.discussionTopics.map((t) => `- ${t.topic}: ${t.summary}`).join('\n') : '(none recorded)',
    '',
    'Decisions:',
    draft.decisions.length ? draft.decisions.map((d) => `- ${d.decision}`).join('\n') : '(none recorded)',
    '',
    'Your action items:',
    own.length ? own.map((a) => `- ${a.task}${a.dueDate ? ` (due ${a.dueDate})` : ''}${a.priority ? ` [${a.priority} priority]` : ''}`).join('\n') : 'No action items assigned to you from this meeting.',
  ].join('\n');
}

export interface UpdatedMinutesResult {
  emails: DraftedEmail[];
  sentTo: string[];
  emailMode: 'send' | 'draft-only';
}

/**
 * "Updated minutes" to every attendee, once per amended version: the idempotency key is
 * (run, version, participant), so pressing Send twice — or retrying after a failure — never sends
 * the same update twice. In draft-only mode the emails are drafted and nothing is sent.
 */
export async function sendUpdatedMinutes(
  stores: MeetingPipelineStores, providers: MeetingPipelineProviders, runId: string, version: number, reason: string, by: string
): Promise<UpdatedMinutesResult> {
  const record = stores.finalApprovals.get(runId);
  if (!record?.minutes) throw new StageOrderError('Only approved minutes can be sent as an update.', { runId });
  const draft = record.minutes;
  const addresses = record.recipients ?? stores.recipients.get(runId) ?? {};
  const emailMode = providers.emailMode ?? 'send';
  const emails: DraftedEmail[] = draft.meetingSummary.attendees.map((name) => ({
    participantName: name,
    subject: `Updated minutes: ${draft.meetingSummary.title ?? 'Meeting'}`,
    body: updatedBody(draft, name, reason, by),
    actionItems: draft.actionItems.filter((a) => (a.owner ?? '').toLowerCase() === name.toLowerCase()),
  }));
  const sentTo: string[] = [];
  if (emailMode === 'send') {
    for (const email of emails) {
      const key = `${runId}:update:${version}:${email.participantName}`;
      const to = addresses[email.participantName];
      if (!to || stores.sentEmails.has(key)) { if (stores.sentEmails.has(key)) sentTo.push(email.participantName); continue; }
      await providers.emailDeliveryClient.send(email, { idempotencyKey: key, to });
      stores.sentEmails.set(key, new Date().toISOString());
      sentTo.push(email.participantName);
    }
  }
  return { emails, sentTo, emailMode };
}

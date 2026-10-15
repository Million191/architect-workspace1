import { requestRevision as requestMinutesRevision } from '../reviewGate/reviewGateService';
import { requestRevision as requestEmailRevision } from '../reviewGateSending/reviewGateSendingService';
import { draftEmailFor } from '../emailDrafting/emailDraftingService';
import { RunNotFoundError, StageOrderError } from './errors';
import { MeetingPipelineStores } from './types';

/**
 * Reviewer actions around the two approval gates, all built on the gates' own revision history (so
 * every change is audited and nothing is approved implicitly):
 * - requestChanges: "Request changes" on the draft minutes (they stay unapproved, now In Progress).
 * - reviseEmails: edit an email's subject/body before the final approval.
 * - updateParticipants: correct participant names / addresses before the minutes are approved.
 * - deleteMeeting: removes a meeting and everything keyed by it.
 * Each is idempotent: repeating it with the same input changes nothing further.
 */

/** Records a change request on Gate #1. The draft is unchanged and stays unapproved. */
export function requestChanges(stores: MeetingPipelineStores, runId: string, note: string, by?: string): void {
  const session = stores.minutesGate.get(runId);
  if (!session) throw new RunNotFoundError(`No meeting draft found for id "${runId}"`, { runId });
  if (session.status !== 'pending_review') throw new StageOrderError('These minutes are already reviewed.', { runId });
  const text = `Changes requested: ${note}`;
  const last = session.revisions[session.revisions.length - 1];
  if (last && last.changesRequested === text && last.requestedBy === by) return; // a double click records one request
  requestMinutesRevision({ sessionId: runId, changesRequested: text, revisedDraft: session.draft, requestedBy: by }, { sessionStore: stores.minutesGate });
}

/** The latest open change request (cleared by any later edit), for the Approval step. */
export function openChangeRequest(stores: MeetingPipelineStores, runId: string): { note: string; by?: string; at: string } | undefined {
  const session = stores.minutesGate.get(runId);
  const last = session?.status === 'pending_review' ? session.revisions[session.revisions.length - 1] : undefined;
  if (!last || !last.changesRequested.startsWith('Changes requested: ')) return undefined;
  return { note: last.changesRequested.slice('Changes requested: '.length), by: last.requestedBy, at: last.requestedAt };
}

export interface EmailEdit {
  participantName: string;
  subject: string;
  body: string;
}

/** Edits drafted emails before the final approval (Gate #2's revise rule). Unchanged emails are a no-op. */
export function reviseEmails(stores: MeetingPipelineStores, runId: string, edits: EmailEdit[], by?: string): void {
  const session = stores.emailGate.get(runId);
  if (!session) throw new StageOrderError('Approve the minutes first — the email is drafted from the reviewed minutes.', { runId });
  if (session.status !== 'pending_review' || stores.finalApprovals.has(runId)) throw new StageOrderError('This email was already reviewed, so it can’t be edited.', { runId });
  const byName = new Map(edits.map((e) => [e.participantName, e]));
  for (const name of byName.keys()) {
    if (!session.batch.emails.some((e) => e.participantName === name)) throw new StageOrderError(`There’s no email to “${name}” in this draft.`, { runId });
  }
  const emails = session.batch.emails.map((e) => {
    const edit = byName.get(e.participantName);
    return edit ? { ...e, subject: edit.subject, body: edit.body } : e;
  });
  if (JSON.stringify(emails) === JSON.stringify(session.batch.emails)) return;
  const changed = [...byName.keys()].join(', ');
  requestEmailRevision({ sessionId: runId, changesRequested: `Reviewer edited the email to ${changed}`, revisedBatch: { ...session.batch, emails }, requestedBy: by }, { sessionStore: stores.emailGate });
}

export interface ParticipantEdit {
  /** The name as it is now (absent for a participant being added). */
  from?: string;
  name: string;
  email?: string;
}

/**
 * Corrects participant names and addresses before the minutes are approved: the attendee list,
 * the transcript's speaker labels, and the stored addresses all change together, so the correction
 * shows everywhere. (Action-item owners and minutes text are changed by the page as a normal edit.)
 */
export function updateParticipants(stores: MeetingPipelineStores, runId: string, people: ParticipantEdit[], by?: string): void {
  const session = stores.minutesGate.get(runId);
  if (!session) throw new RunNotFoundError(`No meeting draft found for id "${runId}"`, { runId });
  if (session.status !== 'pending_review') throw new StageOrderError('The minutes are reviewed, so participants can’t change any more.', { runId });
  const renames = new Map(people.filter((p) => p.from && p.from !== p.name).map((p) => [p.from as string, p.name]));
  const attendees = Array.from(new Set(people.map((p) => p.name)));
  const recipients: Record<string, string> = {};
  const before = stores.recipients.get(runId) ?? {};
  for (const p of people) {
    const address = p.email?.trim() || (p.from ? before[p.from] : undefined) || before[p.name];
    if (address) recipients[p.name] = address;
  }
  const summary = session.draft.meetingSummary;
  const draft = { ...session.draft, meetingSummary: { ...summary, attendees } };
  const sameAttendees = JSON.stringify(summary.attendees) === JSON.stringify(attendees);
  if (!sameAttendees) requestMinutesRevision({ sessionId: runId, changesRequested: 'Reviewer corrected the participants', revisedDraft: draft, requestedBy: by }, { sessionStore: stores.minutesGate });
  if (JSON.stringify(before) !== JSON.stringify(recipients)) stores.recipients.set(runId, recipients);
  const mapping = stores.speakers.get(runId);
  if (mapping && renames.size && mapping.segments.some((s) => renames.has(s.speakerLabel))) {
    stores.speakers.set(runId, { ...mapping, segments: mapping.segments.map((s) => (renames.has(s.speakerLabel) ? { ...s, speakerLabel: renames.get(s.speakerLabel) as string } : s)) });
  }
}

/**
 * Deletes a meeting: its draft, approvals, emails, transcript, analysis, addresses and tracked action
 * items. Deleting a meeting that's already gone is a no-op (returns false).
 * Kept on purpose: the sent-email log (so a re-upload of the same recording never emails anyone twice)
 * and the append-only audit logs.
 */
export function deleteMeeting(stores: MeetingPipelineStores, runId: string): boolean {
  const known = stores.minutesGate.has(runId) || stores.finalApprovals.has(runId);
  const maps = [stores.minutesGate, stores.emailGate, stores.finalApprovals, stores.recipients, stores.tracker, stores.transcripts, stores.speakers,
    stores.marked, stores.summaries, stores.discussions, stores.decisions, stores.actionItems, stores.audio] as Array<Map<string, unknown>>;
  for (const m of maps) m.delete(runId);
  return known;
}

/** The revision note that marks "approved minutes reopened for editing" (each one starts a new approval round). */
export const REOPENED_NOTE = 'Reopened reviewed minutes for editing';

/** How many times this meeting's approved minutes were reopened (0 = never). */
export function approvalRound(stores: MeetingPipelineStores, runId: string): number {
  return stores.minutesGate.get(runId)?.revisions.filter((r) => r.changesRequested === REOPENED_NOTE).length ?? 0;
}

/**
 * The sent-email log key for one participant in the current approval round. Round 0 keeps the
 * original `${runId}:${name}` form (existing logs stay valid); after a reopen, corrected minutes that
 * are approved again get their own key, so they can be sent once — and only once — per round.
 */
export function sentKey(stores: MeetingPipelineStores, runId: string, name: string): string {
  const round = approvalRound(stores, runId);
  return round ? `${runId}:r${round}:${name}` : `${runId}:${name}`;
}

/**
 * Editing approved minutes: the approval is withdrawn (never silently kept). Gate #1 goes back to
 * pending review with the approved text as the draft, the email draft and the final-approval record
 * are removed, and tracked action items are cleared (they are recorded again at the next final
 * approval). The transcript and addresses saved with the approval are kept for the review.
 * Idempotent: minutes that aren't approved are left alone (returns false).
 */
export function reopenMinutes(stores: MeetingPipelineStores, runId: string, by?: string): boolean {
  const session = stores.minutesGate.get(runId);
  const record = stores.finalApprovals.get(runId);
  if (!session && !record?.minutes) throw new RunNotFoundError(`No meeting found for id "${runId}"`, { runId });
  if (session?.status === 'pending_review') return false;
  const draft = record?.minutes ?? session!.draft;
  const at = new Date().toISOString();
  if (record?.transcript && !stores.speakers.has(runId)) {
    stores.speakers.set(runId, { id: runId, transcriptId: runId, segments: record.transcript, generatedAt: at });
  }
  if (record?.recipients && !stores.recipients.has(runId)) stores.recipients.set(runId, { ...record.recipients });
  const base = session ?? { id: runId, transcriptId: draft.transcriptId, submittedAt: record?.approvedAt ?? at, revisions: [] };
  stores.minutesGate.set(runId, {
    ...base, draft, status: 'pending_review', approvedAt: undefined, approvedBy: undefined, updatedAt: at,
    revisions: [...base.revisions, { requestedAt: at, requestedBy: by, changesRequested: REOPENED_NOTE, draftAtRequest: draft }],
  });
  stores.emailGate.delete(runId);
  stores.finalApprovals.delete(runId);
  stores.tracker.delete(runId);
  return true;
}

/**
 * Email step, before sending: add someone to receive the approved minutes (their own email, drafted
 * from the approved minutes like everyone else's), or give an address to a participant who has none.
 * Works for an email waiting for "Approve & send" (a Gate #2 revision) and for a meeting approved
 * while sending was off (its saved approval gets the extra email). Adding the same person again only
 * updates the address. Refused once the email has been sent.
 */
export function addRecipient(stores: MeetingPipelineStores, runId: string, person: { name: string; email: string }, by?: string): 'added' | 'address_updated' {
  const name = person.name.trim(), email = person.email.trim();
  const session = stores.emailGate.get(runId);
  const record = stores.finalApprovals.get(runId);
  const earlierDraft = record?.emailMode === 'draft-only' && record.emails && record.minutes;
  // Already emailed: people who were missed can still be added and sent the same reviewed minutes.
  const alreadySent = record?.emailMode === 'send' && record.emails && record.minutes;
  const pending = session && session.status === 'pending_review' && !record;
  if (!pending && !earlierDraft && !alreadySent) {
    if (!session && !record) throw new StageOrderError('Approve the minutes first — the email is drafted from the reviewed minutes.', { runId });
    throw new StageOrderError('This meeting’s email can’t be changed.', { runId });
  }
  const batch = pending ? session!.batch : record!.emails!;
  const existing = batch.emails.find((e) => e.participantName.toLowerCase() === name.toLowerCase());
  // One email per address: an address that already received this meeting's email (under any name) isn't sent it again.
  const addresses = { ...(record?.recipients ?? {}), ...(stores.recipients.get(runId) ?? {}) };
  const sentAs = Object.keys(addresses).find((n) => n.toLowerCase() !== name.toLowerCase() && addresses[n].trim().toLowerCase() === email.toLowerCase() && stores.sentEmails.has(sentKey(stores, runId, n)));
  if (sentAs) throw new StageOrderError(`${email} already received the email (as ${sentAs}).`, { runId });
  const setAddress = (key: string) => {
    stores.recipients.set(runId, { ...(stores.recipients.get(runId) ?? record?.recipients ?? {}), [key]: email });
    if (record) stores.finalApprovals.set(runId, { ...stores.finalApprovals.get(runId)!, recipients: { ...(record.recipients ?? {}), [key]: email } });
  };
  if (existing) {
    // Someone who already received the email keeps the address it went to.
    if (stores.sentEmails.has(sentKey(stores, runId, existing.participantName))) throw new StageOrderError(`${existing.participantName} already received the email.`, { runId });
    setAddress(existing.participantName);
    return 'address_updated';
  }
  const minutes = pending ? stores.minutesGate.get(runId)!.draft : record!.minutes!;
  const fresh = draftEmailFor(minutes, name);
  // Same subject line as the others (it may have been edited, or say "Updated minutes").
  const email0 = batch.emails[0];
  const added = { ...fresh, subject: email0 ? email0.subject : fresh.subject };
  const emails = [...batch.emails, added];
  if (pending) {
    requestEmailRevision({ sessionId: runId, changesRequested: `Reviewer added ${name} as a recipient`, revisedBatch: { ...batch, emails }, requestedBy: by }, { sessionStore: stores.emailGate });
  } else {
    stores.finalApprovals.set(runId, { ...stores.finalApprovals.get(runId)!, emails: { ...batch, emails } });
    // The page shows the email gate's batch when there is one: keep it the same as the saved approval.
    if (session) stores.emailGate.set(runId, { ...session, batch: { ...session.batch, emails } });
  }
  setAddress(name);
  return 'added';
}

/** "dana.cruz@acme.com" → "Dana Cruz" (for the greeting); the address itself when nothing readable is left. */
export function nameFromEmail(email: string): string {
  const words = email.split('@')[0].split(/[._\-+]+/).filter((w) => /[a-z]/i.test(w));
  return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : email;
}

/**
 * Several recipients in one go (the Add dialog's rows). A row may give only an email: the greeting
 * name comes from the address. An address that already gets the email is skipped; a derived name that
 * belongs to someone else uses the address itself as the name, so nobody's address is overwritten.
 */
export function addRecipients(stores: MeetingPipelineStores, runId: string, people: Array<{ name?: string; email: string }>, by?: string): void {
  for (const person of people) {
    const email = person.email.trim();
    const addresses = { ...(stores.finalApprovals.get(runId)?.recipients ?? {}), ...(stores.recipients.get(runId) ?? {}) };
    if (Object.values(addresses).some((a) => a.trim().toLowerCase() === email.toLowerCase())) continue; // already a recipient (one per address)
    let name = person.name?.trim() || nameFromEmail(email);
    const taken = addresses[Object.keys(addresses).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''];
    const batch = stores.emailGate.get(runId)?.batch ?? stores.finalApprovals.get(runId)?.emails;
    const listed = batch?.emails.some((e) => e.participantName.toLowerCase() === name.toLowerCase());
    if (!person.name && (listed || taken) && (taken ?? '').toLowerCase() !== email.toLowerCase()) name = email;
    addRecipient(stores, runId, { name, email }, by);
  }
}

/**
 * A person's corrected address (People page): every meeting whose email hasn't gone to them yet uses
 * the new address — drafts, emails awaiting "Approve & send", and approvals made while sending was off.
 * Sent emails keep the address they were sent to. Returns how many meetings changed.
 */
export function renameAddress(stores: MeetingPipelineStores, from: string, to: string): number {
  const same = (a?: string) => !!a && a.trim().toLowerCase() === from.trim().toLowerCase();
  const changed = new Set<string>();
  for (const [runId, map] of [...stores.recipients]) {
    const record = stores.finalApprovals.get(runId);
    if (record && record.emailMode !== 'draft-only') continue; // already sent
    let touched = false;
    const next: Record<string, string> = {};
    for (const [name, address] of Object.entries(map)) {
      if (same(address) && !stores.sentEmails.has(sentKey(stores, runId, name))) { next[name] = to; touched = true; } else next[name] = address;
    }
    if (touched) { stores.recipients.set(runId, next); changed.add(runId); }
  }
  for (const [runId, record] of [...stores.finalApprovals]) {
    if (record.emailMode !== 'draft-only' || !record.recipients) continue;
    const entries = Object.entries(record.recipients);
    if (!entries.some(([, a]) => same(a))) continue;
    stores.finalApprovals.set(runId, { ...record, recipients: Object.fromEntries(entries.map(([n, a]) => [n, same(a) ? to : a])) });
    changed.add(runId);
  }
  return changed.size;
}

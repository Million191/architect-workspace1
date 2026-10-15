import { requestRevision as requestEmailRevision } from '../reviewGateSending/reviewGateSendingService';
import { normalizeEmail } from '../people/identity';
import { sentKey, updateParticipants } from './reviewActions';
import { MeetingPipelineStores } from './types';

/**
 * A name corrected on the People page reaches every meeting that hasn't been emailed to that person
 * yet (matched by email address):
 * - minutes still in review: the participant is renamed everywhere (attendees, addresses, transcript speakers);
 * - email drafted but not sent to them: their email is renamed — recipient name and the "Hi …" greeting.
 * Not changed: emails already sent, and minutes that are already reviewed (their attendee list is part of
 * the reviewed record). Idempotent: renaming to the same name changes nothing. Returns the meetings changed.
 */
export function renamePerson(stores: MeetingPipelineStores, email: string, newName: string, by?: string): string[] {
  const target = normalizeEmail(email), name = newName.trim();
  if (!name) return [];
  const changed: string[] = [];
  const runIds = new Set([...stores.recipients.keys(), ...stores.finalApprovals.keys()]);
  for (const runId of runIds) {
    const record = stores.finalApprovals.get(runId);
    const addresses = { ...(record?.recipients ?? {}), ...(stores.recipients.get(runId) ?? {}) };
    const oldName = Object.keys(addresses).find((n) => normalizeEmail(addresses[n]) === target);
    if (!oldName || oldName === name) continue;
    if (Object.keys(addresses).some((n) => n !== oldName && n.toLowerCase() === name.toLowerCase())) continue; // someone else already has that name here
    if (stores.sentEmails.has(sentKey(stores, runId, oldName))) continue; // they already have the email
    const session = stores.minutesGate.get(runId);
    const emailSession = stores.emailGate.get(runId);

    // Still in review: rename the participant everywhere in the draft.
    if (session && session.status === 'pending_review' && !emailSession && !record) {
      const attendees = session.draft.meetingSummary.attendees;
      if (!attendees.includes(oldName)) continue;
      updateParticipants(stores, runId, attendees.map((n) => ({ from: n, name: n === oldName ? name : n, email: addresses[n] })), by);
      changed.push(runId);
      continue;
    }

    // Email drafted: rename the recipient and the greeting in their (unsent) email.
    const batch = emailSession?.batch ?? record?.emails;
    if (!batch || !batch.emails.some((e) => e.participantName === oldName)) continue;
    const emails = batch.emails.map((e) => e.participantName !== oldName ? e : {
      ...e,
      participantName: name,
      body: e.body.startsWith(`Hi ${oldName},`) ? `Hi ${name},` + e.body.slice(`Hi ${oldName},`.length) : e.body,
    });
    const rekey = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([n, a]) => [n === oldName ? name : n, a]));
    if (emailSession && emailSession.status === 'pending_review' && !record) {
      requestEmailRevision({ sessionId: runId, changesRequested: `Renamed ${oldName} to ${name} (People)`, revisedBatch: { ...batch, emails }, requestedBy: by }, { sessionStore: stores.emailGate });
    } else {
      if (record) {
        stores.finalApprovals.set(runId, {
          ...record,
          emails: record.emails ? { ...record.emails, emails } : record.emails,
          recipients: record.recipients ? rekey(record.recipients) : record.recipients,
          selectedRecipients: record.selectedRecipients?.map((n) => (n === oldName ? name : n)),
        });
      }
      if (emailSession) stores.emailGate.set(runId, { ...emailSession, batch: { ...emailSession.batch, emails } });
    }
    if (stores.recipients.has(runId)) stores.recipients.set(runId, rekey(stores.recipients.get(runId)!));
    changed.push(runId);
  }
  return changed;
}

import { actionItemKey } from '../../meetingPipeline/dedupe';
import { normalizeEmail } from '../../people/identity';
import { PersonRecord } from '../../people/types';
import { DataSet } from './dataSet';
import { PlanItem } from './plan';

const norm = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

type Item = { task?: string; owner?: string; ownerEmail?: string; dueDate?: string; status?: string; dismissed?: boolean };

/**
 * Keeps the first of each (task, owner) and folds what the repeats knew into it, so nothing linked
 * is lost: a due date, the owner's address, and "done" if any copy was done.
 */
export function mergeItems<T>(items: T[], view: (t: T) => Item = (t) => t as unknown as Item): T[] {
  const kept = new Map<string, T>();
  const out: T[] = [];
  for (const item of items) {
    const v = view(item);
    if (!norm(v.task) || v.dismissed) { out.push(item); continue; }
    const key = actionItemKey(v.task, v.owner ?? v.ownerEmail);
    const first = kept.get(key);
    if (!first) { kept.set(key, item); out.push(item); continue; }
    const f = view(first);
    if (!f.dueDate && v.dueDate) f.dueDate = v.dueDate;
    if (!f.ownerEmail && v.ownerEmail) f.ownerEmail = v.ownerEmail;
    if (v.status === 'done') f.status = 'done';
  }
  return out;
}

function mergePeople(records: PersonRecord[], keep: string): PersonRecord {
  const [first, ...rest] = records;
  const merged: PersonRecord = { ...first, id: keep, names: { ...first.names }, photos: { ...first.photos }, origins: [...first.origins] };
  for (const r of rest) {
    for (const [k, v] of Object.entries(r.names)) if (v && !(merged.names as Record<string, string>)[k]) (merged.names as Record<string, string>)[k] = v;
    for (const [k, v] of Object.entries(r.photos)) if (v && !(merged.photos as Record<string, string>)[k]) (merged.photos as Record<string, string>)[k] = v;
    for (const o of r.origins) if (!merged.origins.includes(o)) merged.origins.push(o);
    if (r.createdAt < merged.createdAt) merged.createdAt = r.createdAt;
  }
  return merged;
}

/** Moves every link from `from` to `to`, then removes `from`'s duplicate records. */
function mergeMeeting(d: DataSet, to: string, from: string, changed: Set<keyof DataSet>): void {
  for (const m of Object.values(d.schedule)) if (m.runId === from) { m.runId = to; changed.add('schedule'); }
  for (const r of Object.values(d.recordings)) if (r.runId === from) { r.runId = to; changed.add('recordings'); }
  for (const b of Object.values(d.botSessions)) if (b.runId === from) { b.runId = to; changed.add('botSessions'); }
  // Emails already sent stay recorded (now under the kept meeting), so nobody is emailed again.
  for (const key of Object.keys(d.sentEmails)) {
    if (!key.startsWith(`${from}:`)) continue;
    const moved = `${to}:${key.slice(from.length + 1)}`;
    if (!(moved in d.sentEmails)) d.sentEmails[moved] = d.sentEmails[key];
    delete d.sentEmails[key];
    changed.add('sentEmails');
  }
  const addresses = d.recipients[from];
  if (addresses) {
    d.recipients[to] = { ...addresses, ...(d.recipients[to] ?? {}) }; // the kept meeting's entries win
    changed.add('recipients');
  }
  for (const key of ['minutesGate', 'emailGate', 'finalApprovals', 'recipients', 'tracker', 'transcripts', 'minutesDocs'] as const) {
    const map = d[key] as Record<string, unknown>;
    if (from in map) { delete map[from]; changed.add(key); }
  }
}

/** Applies the `merge` items of a plan to `d` in place. Returns which parts changed (to write back). */
export function applyPlan(d: DataSet, plan: PlanItem[]): Set<keyof DataSet> {
  const changed = new Set<keyof DataSet>();
  for (const item of plan) {
    if (item.certainty !== 'merge') continue;
    switch (item.kind) {
      case 'people_email': {
        const records = [item.keep, ...item.merge].map((id) => d.people[id]).filter(Boolean);
        if (!records.length) break;
        for (const id of item.merge) delete d.people[id];
        d.people[item.keep] = mergePeople(records, item.keep);
        changed.add('people');
        break;
      }
      case 'meeting_same_file':
        for (const from of item.merge) mergeMeeting(d, item.keep, from, changed);
        break;
      case 'action_items': {
        const runId = item.runId;
        if (item.store === 'draft' && d.minutesGate[runId]) { d.minutesGate[runId].draft.actionItems = mergeItems(d.minutesGate[runId].draft.actionItems); changed.add('minutesGate'); }
        if (item.store === 'approved' && d.finalApprovals[runId]?.minutes) { d.finalApprovals[runId].minutes!.actionItems = mergeItems(d.finalApprovals[runId].minutes!.actionItems); changed.add('finalApprovals'); }
        if (item.store === 'document' && d.minutesDocs[runId]) { d.minutesDocs[runId].content.actionItems = mergeItems(d.minutesDocs[runId].content.actionItems); changed.add('minutesDocs'); }
        if (item.store === 'tracker' && d.tracker[runId]) { d.tracker[runId].loggedItems = mergeItems(d.tracker[runId].loggedItems, (t) => t.actionItem as unknown as Item); changed.add('tracker'); }
        break;
      }
      case 'attendees': {
        const unique = (list: string[]) => list.filter((a, i) => list.findIndex((b) => norm(b) === norm(a)) === i);
        const draft = d.minutesGate[item.runId]?.draft;
        if (draft) { draft.meetingSummary.attendees = unique(draft.meetingSummary.attendees); changed.add('minutesGate'); }
        const approved = d.finalApprovals[item.runId]?.minutes;
        if (approved) { approved.meetingSummary.attendees = unique(approved.meetingSummary.attendees); changed.add('finalApprovals'); }
        break;
      }
      case 'recipient_alias': {
        for (const name of item.drop) {
          if (d.recipients[item.runId]?.[name] !== undefined) { delete d.recipients[item.runId][name]; changed.add('recipients'); }
          const record = d.finalApprovals[item.runId];
          if (record?.recipients?.[name] !== undefined) { delete record.recipients[name]; changed.add('finalApprovals'); }
          if (record?.selectedRecipients?.includes(name)) { record.selectedRecipients = record.selectedRecipients.filter((n) => n !== name); changed.add('finalApprovals'); }
        }
        break;
      }
      case 'schedule_title_start': {
        const keep = d.schedule[item.keep];
        if (!keep) break;
        for (const id of item.merge) {
          const other = d.schedule[id];
          if (!other || other.runId) continue; // never drop a meeting that has its own recording
          for (const p of other.participants) if (!keep.participants.some((q) => normalizeEmail(q.email) === normalizeEmail(p.email))) keep.participants.push(p);
          delete d.schedule[id];
          changed.add('schedule');
        }
        break;
      }
    }
  }
  return changed;
}

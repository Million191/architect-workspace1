import { actionItemKey, contentHashOf } from '../../meetingPipeline/dedupe';
import { normalizeEmail } from '../../people/identity';
import { DataSet, rankRun, runTitle } from './dataSet';

/**
 * Finds duplicates already saved and describes how each is merged. Pure: reads a DataSet, returns
 * a list. `merge` items are applied by `applyPlan`; `review` items are only reported — they need a
 * person to decide (e.g. "Minab" and "Minab Sahilu21" may or may not be the same person).
 * Running it again after applying finds nothing (idempotent).
 */
export type PlanItem =
  | { kind: 'people_email'; certainty: 'merge'; keep: string; merge: string[]; description: string }
  | { kind: 'meeting_same_file'; certainty: 'merge'; keep: string; merge: string[]; description: string }
  | { kind: 'meeting_title_start'; certainty: 'review'; runIds: string[]; description: string }
  | { kind: 'action_items'; certainty: 'merge'; runId: string; store: 'draft' | 'approved' | 'document' | 'tracker'; removed: number; description: string }
  | { kind: 'attendees'; certainty: 'merge'; runId: string; removed: string[]; description: string }
  | { kind: 'recipient_alias'; certainty: 'merge'; runId: string; address: string; keep: string; drop: string[]; description: string }
  | { kind: 'recipient_alias'; certainty: 'review'; runId: string; address: string; names: string[]; description: string }
  | { kind: 'schedule_title_start'; certainty: 'merge' | 'review'; keep: string; merge: string[]; description: string }
  | { kind: 'possible_same_person'; certainty: 'review'; runId: string; names: string[]; description: string };

const norm = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function groupBy<T>(items: T[], keyOf: (t: T) => string | undefined): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** How many rows `items` would lose to the (task, owner) rule. Blank and dismissed rows don't count. */
export function repeatedRows(items: Array<{ task?: string; owner?: string; ownerEmail?: string; dismissed?: boolean }>): number {
  const seen = new Set<string>();
  let repeats = 0;
  for (const i of items) {
    if (!norm(i.task) || i.dismissed) continue;
    const key = actionItemKey(i.task, i.owner ?? i.ownerEmail);
    if (seen.has(key)) repeats++; else seen.add(key);
  }
  return repeats;
}

export function planCleanup(d: DataSet): PlanItem[] {
  const plan: PlanItem[] = [];

  // People: one record per normalized email (also catches a record stored under the wrong key).
  for (const group of groupBy(Object.entries(d.people), ([, p]) => normalizeEmail(p.email))) {
    const ids = group.map(([id]) => id);
    const keep = normalizeEmail(group[0][1].email);
    plan.push({ kind: 'people_email', certainty: 'merge', keep, merge: ids.filter((id) => id !== keep), description: `People: ${ids.length} records for ${keep} → one (names, photos and sources combined)` });
  }
  for (const [id, p] of Object.entries(d.people)) {
    if (id !== normalizeEmail(p.email) && !Object.values(d.people).some((o) => o !== p && normalizeEmail(o.email) === normalizeEmail(p.email))) {
      plan.push({ kind: 'people_email', certainty: 'merge', keep: normalizeEmail(p.email), merge: [id], description: `People: “${id}” is stored under the wrong key → re-keyed to ${normalizeEmail(p.email)}` });
    }
  }

  // Meetings made from the same audio file (any source): keep the furthest along.
  const runIds = [...new Set([...Object.keys(d.minutesGate), ...Object.keys(d.finalApprovals)])];
  for (const group of groupBy(runIds, contentHashOf)) {
    const sorted = [...group].sort((a, b) => rankRun(d, b) - rankRun(d, a) || (d.minutesGate[a]?.submittedAt ?? '').localeCompare(d.minutesGate[b]?.submittedAt ?? ''));
    plan.push({ kind: 'meeting_same_file', certainty: 'merge', keep: sorted[0], merge: sorted.slice(1), description: `Meetings: “${runTitle(d, sorted[0])}” exists ${group.length} times from the same file → one (links, recipients and sent-email records moved to the kept one)` });
  }
  // Same title at the same date + time: reported for a person to check (the time may be upload time, not the real start).
  for (const group of groupBy(runIds, (id) => {
    const s = d.finalApprovals[id]?.minutes?.meetingSummary ?? d.minutesGate[id]?.draft.meetingSummary;
    return s?.title && s.date && s.time ? `${norm(s.title)}@${s.date}T${s.time}` : undefined;
  })) {
    if (new Set(group.map(contentHashOf)).size === 1) continue; // already handled as the same file
    plan.push({ kind: 'meeting_title_start', certainty: 'review', runIds: group, description: `Meetings: ${group.length} meetings called “${runTitle(d, group[0])}” at the same date and time — check whether they’re the same meeting` });
  }

  // Action items: one per (task, owner) in every place a meeting keeps them.
  for (const [runId, s] of Object.entries(d.minutesGate)) {
    const n = repeatedRows(s.draft.actionItems);
    if (n) plan.push({ kind: 'action_items', certainty: 'merge', runId, store: 'draft', removed: n, description: `Action items: ${n} repeated in the draft of “${runTitle(d, runId)}”` });
  }
  for (const [runId, r] of Object.entries(d.finalApprovals)) {
    const n = repeatedRows(r.minutes?.actionItems ?? []);
    if (n) plan.push({ kind: 'action_items', certainty: 'merge', runId, store: 'approved', removed: n, description: `Action items: ${n} repeated in the approved minutes of “${runTitle(d, runId)}”` });
  }
  for (const [runId, doc] of Object.entries(d.minutesDocs)) {
    const n = repeatedRows(doc.content.actionItems);
    if (n) plan.push({ kind: 'action_items', certainty: 'merge', runId, store: 'document', removed: n, description: `Action items: ${n} repeated in the edited minutes of “${runTitle(d, runId)}”` });
  }
  for (const [runId, t] of Object.entries(d.tracker)) {
    const n = repeatedRows(t.loggedItems.map((i) => i.actionItem));
    if (n) plan.push({ kind: 'action_items', certainty: 'merge', runId, store: 'tracker', removed: n, description: `Action items: ${n} repeated in the tracked list of “${runTitle(d, runId)}”` });
  }

  // Attendees listed twice (same name, any case) in a meeting summary.
  for (const runId of runIds) {
    // Both copies of the meeting: the draft and the approved record.
    const repeats = (list: string[]) => list.filter((a, i) => list.findIndex((b) => norm(b) === norm(a)) !== i);
    const removed = [...new Set([...repeats(d.minutesGate[runId]?.draft.meetingSummary.attendees ?? []), ...repeats(d.finalApprovals[runId]?.minutes?.meetingSummary.attendees ?? [])])];
    if (removed.length) plan.push({ kind: 'attendees', certainty: 'merge', runId, removed, description: `Participants: ${removed.map((r) => `“${r}”`).join(', ')} listed twice in “${runTitle(d, runId)}”` });
  }

  // Recipients: one address under several names in one meeting.
  for (const [runId, map] of Object.entries(d.recipients)) {
    for (const group of groupBy(Object.entries(map), ([, address]) => normalizeEmail(address))) {
      const names = group.map(([name]) => name);
      const address = normalizeEmail(group[0][1]);
      const used = names.filter((n) => hasEmail(d, runId, n));
      if (used.length === 1) {
        plan.push({ kind: 'recipient_alias', certainty: 'merge', runId, address, keep: used[0], drop: names.filter((n) => n !== used[0]), description: `Recipients: ${address} is listed as ${names.map((n) => `“${n}”`).join(' and ')} in “${runTitle(d, runId)}” → keep “${used[0]}” (the one with the email), drop the unused name` });
      } else {
        plan.push({ kind: 'recipient_alias', certainty: 'review', runId, address, names, description: `Recipients: ${address} is listed as ${names.map((n) => `“${n}”`).join(' and ')} in “${runTitle(d, runId)}”, each with its own email — check which to keep` });
      }
    }
  }

  // Calendar entries created in the app with the same title and start.
  const live = Object.values(d.schedule).filter((m) => !m.external && m.status !== 'cancelled' && m.start);
  for (const group of groupBy(live, (m) => `${norm(m.title)}@${m.start}`)) {
    const linked = group.filter((m) => m.runId);
    const sorted = [...group].sort((a, b) => Number(!!b.runId) - Number(!!a.runId) || a.createdAt.localeCompare(b.createdAt));
    plan.push({ kind: 'schedule_title_start', certainty: linked.length > 1 ? 'review' : 'merge', keep: sorted[0].id, merge: sorted.slice(1).map((m) => m.id), description: `Calendar: “${group[0].title}” scheduled ${group.length} times at the same start${linked.length > 1 ? ' — each has its own recording, check which to keep' : ' → one (participants combined)'}` });
  }

  // Possibly the same person: a name with no email that is the first name of a participant with one.
  for (const runId of runIds) {
    const attendees = (d.finalApprovals[runId]?.minutes ?? d.minutesGate[runId]?.draft)?.meetingSummary.attendees ?? [];
    const addresses = { ...(d.finalApprovals[runId]?.recipients ?? {}), ...(d.recipients[runId] ?? {}) };
    const named = Object.keys(addresses);
    for (const bare of attendees.filter((a) => !addresses[a])) {
      const like = named.filter((n) => n !== bare && norm(n).split(' ')[0] === norm(bare));
      if (like.length) plan.push({ kind: 'possible_same_person', certainty: 'review', runId, names: [bare, ...like], description: `People: in “${runTitle(d, runId)}”, “${bare}” (no email) may be ${like.map((l) => `“${l}” <${addresses[l]}>`).join(' or ')} — not merged; fix it in the meeting’s participants if so` });
    }
  }
  return plan;
}

/** Does this name have an email drafted or sent in the meeting? */
function hasEmail(d: DataSet, runId: string, name: string): boolean {
  const drafted = (d.emailGate[runId]?.batch ?? d.finalApprovals[runId]?.emails)?.emails.some((e) => e.participantName === name);
  const sent = Object.keys(d.sentEmails).some((k) => k.startsWith(`${runId}:`) && k.endsWith(`:${name}`));
  return !!drafted || sent;
}

/**
 * Duplicate rules for the dashboard, in one place so every screen and count agrees:
 * - action items: one per (task, owner) within a meeting — case-insensitive, whitespace-collapsed,
 *   trailing punctuation ignored (same convention as the tracker's stale-item matching);
 * - attendees: one per email address (trimmed, case-insensitive), or per name when no address;
 * - meetings: the same audio file (by content hash, whatever source it was uploaded as), or the
 *   same title + scheduled start time.
 * Pure functions; the first occurrence always wins so nothing the user already saw moves.
 */

const norm = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!;,]+$/, '');

export function actionItemKey(task: string | undefined, owner: string | undefined): string {
  return `${norm(task)}::${norm(owner)}`;
}

/**
 * Keeps the first of each (task, owner). Items with no task text are kept as they are — a blank row
 * the reviewer is still typing into is not a duplicate. `skip` items (e.g. dismissed) are kept and
 * never matched against.
 */
export function dedupeActionItems<T extends { task?: string; owner?: string }>(items: T[], opts: { ownerOf?: (item: T) => string | undefined; skip?: (item: T) => boolean } = {}): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!norm(item.task) || opts.skip?.(item)) return true;
    const key = actionItemKey(item.task, opts.ownerOf ? opts.ownerOf(item) : item.owner);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One entry per person in an attendee list: the same address twice (any case/spacing) is one person,
 * and a bare name that matches someone listed with an address is that person. Keeps the first
 * spelling of the name, and picks up an address from a later entry if the first had none.
 */
export function dedupeAttendees(list: Array<{ name: string; email?: string }>): Array<{ name: string; email?: string }> {
  const out: Array<{ name: string; email?: string }> = [];
  const isAddressName = (a: { name: string; email?: string }) => !!a.email && norm(a.name) === norm(a.email);
  for (const a of list) {
    const email = a.email?.trim();
    const sameEmail = email ? out.find((o) => o.email && norm(o.email) === norm(email)) : undefined;
    if (sameEmail) {
      if (isAddressName(sameEmail) && !isAddressName({ name: a.name, email })) sameEmail.name = a.name.trim(); // a real name beats the bare address
      continue;
    }
    const sameName = out.find((o) => norm(o.name) === norm(a.name) && (!o.email || !email));
    if (sameName) {
      if (!sameName.email && email) sameName.email = email;
      continue;
    }
    out.push(email ? { name: a.name.trim(), email } : { name: a.name.trim() });
  }
  return out;
}

/** The content hash at the end of an audio/run id ("physical:<source>:<sha256>"). */
export function contentHashOf(runId: string): string | undefined {
  const m = /:([a-f0-9]{64})$/.exec(runId);
  return m ? m[1] : undefined;
}

export interface ExistingRun {
  runId: string;
  title?: string;
  date?: string;
  time?: string;
}

/**
 * An existing meeting this upload duplicates: the same file (any source), or — when both a title and
 * a real scheduled start are known — the same title at the same start minute. Ingestion time is not
 * a start time, so it is never used to match (two different recordings uploaded in the same minute
 * must stay two meetings).
 */
export function findDuplicateRun(existing: ExistingRun[], candidate: { runId: string; title?: string; scheduledAt?: string }): string | undefined {
  const hash = contentHashOf(candidate.runId);
  const byFile = hash ? existing.find((r) => r.runId !== candidate.runId && contentHashOf(r.runId) === hash) : undefined;
  if (byFile) return byFile.runId;
  const start = candidate.scheduledAt ? new Date(candidate.scheduledAt) : undefined;
  if (!candidate.title || !start || Number.isNaN(start.getTime())) return undefined;
  const date = start.toISOString().slice(0, 10), time = start.toISOString().slice(11, 16);
  return existing.find((r) => r.runId !== candidate.runId && norm(r.title) === norm(candidate.title) && r.date === date && r.time === time)?.runId;
}

/**
 * A name typed without an address is matched to the People list: when exactly one person has that
 * name, they are that person (their address is used, the typed name kept). Two people with the same
 * name are ambiguous, so the attendee stays name-only rather than guessing.
 */
export function matchKnownPeople(list: Array<{ name: string; email?: string }>, people: Array<{ name: string; email: string }>): Array<{ name: string; email?: string }> {
  const matched = list.map((a) => {
    if (a.email) return a;
    const hits = people.filter((p) => norm(p.name) === norm(a.name));
    return hits.length === 1 ? { name: a.name, email: hits[0].email } : a;
  });
  return dedupeAttendees(matched);
}

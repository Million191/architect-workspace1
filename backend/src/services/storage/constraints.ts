import { actionItemKey, contentHashOf } from '../meetingPipeline/dedupe';
import { normalizeEmail } from '../people/identity';
import { PersonRecord } from '../people/types';
import { ScheduledMeeting } from '../schedule/types';
import { Constraints } from './uniqueIndex';

/**
 * The app's unique indexes and checks, by store. Each one matches a duplicate rule in
 * `meetingPipeline/dedupe.ts`, which removes duplicates before they are saved; these constraints
 * are the last line that refuses a duplicate if some path ever forgets.
 */

const norm = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** "Two rows are the same task for the same owner", or undefined. Blank and dismissed rows are skipped. */
export function repeatedActionItem(items: Array<{ task?: string; owner?: string; ownerEmail?: string; dismissed?: boolean }> | undefined): string | undefined {
  const seen = new Set<string>();
  for (const item of items ?? []) {
    if (!norm(item.task) || item.dismissed) continue;
    const key = actionItemKey(item.task, item.owner ?? item.ownerEmail);
    if (seen.has(key)) return `repeated action item "${item.task}"`;
    seen.add(key);
  }
  return undefined;
}

/** people: UNIQUE(lower(trim(email))), and the record is stored under that key. */
export const peopleConstraints: Constraints<PersonRecord> = {
  unique: [{ name: 'people_email_unique', keyOf: (p) => normalizeEmail(p.email) }],
  checks: [{ name: 'people_id_is_email', problem: (p, id) => (id !== normalizeEmail(p.email) ? `stored as "${id}" but the address is "${p.email}"` : undefined) }],
};

/**
 * schedule: one entry per synced calendar event, UNIQUE(provider, calendarId, eventId); and one
 * app-created entry per (title, start) among meetings that aren't cancelled (partial index).
 */
export const scheduleConstraints: Constraints<ScheduledMeeting> = {
  unique: [
    { name: 'schedule_external_event_unique', keyOf: (m) => (m.external ? `${m.external.provider}:${m.external.calendarId}:${m.external.eventId}` : undefined) },
    { name: 'schedule_title_start_unique', keyOf: (m) => (!m.external && m.status !== 'cancelled' && m.start ? `${norm(m.title)}@${m.start}` : undefined) },
  ],
};

/** meetings (drafts and approvals): UNIQUE(audio content hash); no repeated action items inside a meeting. */
export function meetingConstraints<V>(minutesOf: (v: V) => { actionItems?: Array<{ task?: string; owner?: string }> } | undefined): Constraints<V> {
  return {
    unique: [{ name: 'meeting_audio_hash_unique', keyOf: (_v, id) => contentHashOf(id) }],
    checks: [{ name: 'meeting_action_items_unique', problem: (v) => repeatedActionItem(minutesOf(v)?.actionItems) }],
  };
}

/** minutes documents: no repeated action items in the current content (history versions are kept as they were). */
export const minutesDocConstraints: Constraints<{ content: { actionItems: Array<{ task?: string; owner?: string; ownerEmail?: string; dismissed?: boolean }> } }> = {
  checks: [{ name: 'minutes_doc_action_items_unique', problem: (d) => repeatedActionItem(d.content?.actionItems) }],
};

/**
 * PROPOSED, not applied (needs the cleanup first — "Progress Report" currently lists one address
 * under two names): one address per meeting in the recipients map.
 */
export const recipientConstraints: Constraints<Record<string, string>> = {
  checks: [{
    name: 'meeting_recipient_address_unique',
    problem: (map) => {
      const seen = new Set<string>();
      for (const address of Object.values(map ?? {})) {
        const key = normalizeEmail(address);
        if (seen.has(key)) return `address listed twice`;
        seen.add(key);
      }
      return undefined;
    },
  }],
};

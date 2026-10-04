import { MeetingPipeline } from '../meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../schedule/scheduleService';
import { readableNameFromEmail } from '../people/identity';

export type SearchDocType = 'meeting' | 'transcript' | 'action';

/** One searchable thing. `id` is stable so the index can update only what changed. */
export interface SearchDoc {
  id: string;
  type: SearchDocType;
  /** Shown as the result's heading. */
  title: string;
  /** Searched, shown as the snippet. */
  text: string;
  /** Searched (names and emails). */
  people: string;
  /** Searched ("2026-10-04 October Oct 4 2026 Sunday"). */
  when: string;
  runId?: string;
  scheduleId?: string;
  meetingTitle?: string;
  speaker?: string;
  startMs?: number;
  date?: string;
  status?: string;
  /** Display names, shown as "With …" when a meeting matched on a participant. */
  participantNames?: string;
}

/** Every way someone might type a date: ISO, month name, short month, weekday, year. */
export function dateWords(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `${m[1]}-${m[2]}-${m[3]} ${month} ${month.slice(0, 3)} ${Number(m[3])} ${m[1]} ${weekday}`;
}

export interface SearchSources {
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
  /** Display name for an email (People list), so participants are findable by their edited name. */
  nameFor?: (email: string) => string | undefined;
}

/**
 * Reads the current meetings, transcripts, minutes, action items, and scheduled meetings into
 * documents. Pure read: never changes anything. A meeting that cannot be read is skipped.
 */
export function collectSearchDocs(src: SearchSources): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const nameFor = (email?: string, fallback?: string) => (email ? src.nameFor?.(email) ?? fallback ?? readableNameFromEmail(email) : fallback ?? '');

  for (const item of src.pipeline?.listMeetings() ?? []) {
    let run;
    try { run = src.pipeline!.getRun(item.runId); } catch { continue; }
    const title = item.title || 'Untitled meeting';
    const people = item.people.map((p) => `${nameFor(p.email, p.name)} ${p.name} ${p.email ?? ''}`).join(' ');
    const minutes = [
      ...run.minutes.discussionTopics.map((t) => `${t.topic}. ${t.summary}`),
      ...run.minutes.decisions.map((d) => `${d.decision} ${d.rationale ?? ''}`),
    ].join(' ');
    const participantNames = item.people.map((p) => nameFor(p.email, p.name)).join(', ');
    docs.push({ id: `m:${item.runId}`, type: 'meeting', title, text: minutes, people, when: dateWords(item.date), runId: item.runId, date: item.date, status: item.status, participantNames });
    run.transcript.forEach((seg, i) => {
      if (!seg.text) return;
      // No `title`: every line would otherwise match the meeting's title. The page shows `meetingTitle`.
      docs.push({ id: `t:${item.runId}:${i}`, type: 'transcript', title: '', text: seg.text, people: seg.speakerLabel, when: '', runId: item.runId, meetingTitle: title, speaker: seg.speakerLabel, startMs: seg.startMs, date: item.date });
    });
    run.minutes.actionItems.forEach((a, i) => {
      docs.push({ id: `a:${item.runId}:${i}`, type: 'action', title: a.task, text: a.task, people: a.owner ?? '', when: dateWords(a.dueDate), runId: item.runId, meetingTitle: title, date: a.dueDate, status: a.status });
    });
  }

  for (const m of src.schedule?.listAll() ?? []) {
    if (m.runId) continue; // the recorded meeting above already represents it
    const people = m.participants.map((p) => `${nameFor(p.email, p.name)} ${p.name ?? ''} ${p.email}`).join(' ');
    const participantNames = m.participants.map((p) => nameFor(p.email, p.name)).join(', ');
    docs.push({ id: `s:${m.id}`, type: 'meeting', title: m.title, text: m.agenda ?? '', people, when: dateWords(m.start), scheduleId: m.id, date: m.start ?? undefined, status: m.status, participantNames });
  }
  return docs;
}

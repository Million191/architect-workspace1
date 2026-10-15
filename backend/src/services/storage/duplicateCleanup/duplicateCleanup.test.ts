import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { applyPlan } from './apply';
import { backupDataSet, loadDataSet, saveDataSet } from './dataSet';
import { planCleanup } from './plan';

const A = 'a'.repeat(64);
const RUN = `physical:room_mic:${A}`, DUP = `physical:phone:${A}`, OTHER = `physical:room_mic:${'b'.repeat(64)}`;
const summary = (title: string, attendees: string[]) => ({ title, date: '2026-10-05', time: '14:00', attendees });
const item = (task: string, owner?: string, extra: object = {}) => ({ task, owner, status: 'open', ...extra });

/** A data folder with one of every kind of duplicate the app can have saved. */
function fixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ma-dupes-'));
  const w = (file: string, value: unknown) => writeFileSync(path.join(dir, file), JSON.stringify(value));
  const person = (id: string, email: string, names: object, origins: string[], createdAt: string) => ({ id, email, names, photos: {}, origins, createdAt, updatedAt: createdAt });
  w('people.json', {
    'sara@x.io': person('sara@x.io', 'sara@x.io', { entered: 'Sara' }, ['meeting'], '2026-10-02'),
    'SARA@x.io ': person('SARA@x.io ', 'SARA@x.io ', { calendar: 'Sara Lee' }, ['calendar'], '2026-10-01'),
  });
  w('minutes-drafts.json', {
    [RUN]: { status: 'approved', submittedAt: '2026-10-05T14:00:00Z', revisions: [], draft: { meetingSummary: summary('Kickoff', ['Sara', 'sara', 'Tom']), actionItems: [item('Book venue', 'Sara'), item('book venue.', 'SARA', { dueDate: '2026-10-09', status: 'done' }), item('', 'Sara'), item('', 'Sara')] } },
    [DUP]: { status: 'pending_review', submittedAt: '2026-10-05T15:00:00Z', revisions: [], draft: { meetingSummary: summary('Kickoff', ['Sara']), actionItems: [] } },
    [OTHER]: { status: 'pending_review', submittedAt: '2026-10-05T16:00:00Z', revisions: [], draft: { meetingSummary: summary(' kickoff ', ['Ann', 'Minab']), actionItems: [] } },
  });
  w('final-approvals.json', { [RUN]: { approvedAt: 'x', approvedBy: 'Sara', emailMode: 'send', recipients: { Sara: 'sara@x.io', 'sara@x.io': 'SARA@x.io' }, selectedRecipients: ['Sara', 'sara@x.io'], emails: { emails: [{ participantName: 'Sara' }] }, minutes: { meetingSummary: summary('Kickoff', ['Sara']), actionItems: [item('Book venue', 'Sara'), item('Book venue', 'Sara')] } } });
  w('email-drafts.json', { [RUN]: { status: 'approved', batch: { emails: [{ participantName: 'Sara' }] } } });
  w('recipients.json', { [RUN]: { Sara: 'sara@x.io', 'sara@x.io': 'SARA@x.io' }, [DUP]: { Tom: 'tom@x.io' }, [OTHER]: { 'Minab Sahilu': 'minab@x.io' } });
  w('sent-emails.json', { [`${RUN}:Sara`]: 't1', [`${DUP}:Tom`]: 't2' });
  w('tracker-log.json', { [RUN]: { loggedItems: [{ actionItem: item('Book venue', 'Sara'), status: 'Not Started', loggedAt: 'x' }, { actionItem: item('Book venue', 'sara'), status: 'Not Started', loggedAt: 'x' }] } });
  w('transcripts.json', { [RUN]: { segments: [] }, [DUP]: { segments: [] } });
  w('minutes-docs.json', { [DUP]: { runId: DUP, content: { sections: [], actionItems: [] }, versions: [] } });
  w('schedule.json', {
    s1: { id: 's1', title: 'Kickoff', start: '2026-10-05T14:00:00.000Z', end: '2026-10-05T15:00:00.000Z', status: 'scheduled', participants: [{ email: 'sara@x.io' }], createdAt: '1', runId: DUP },
    s2: { id: 's2', title: 'kickoff ', start: '2026-10-05T14:00:00.000Z', end: '2026-10-05T15:00:00.000Z', status: 'scheduled', participants: [{ email: 'ann@x.io' }], createdAt: '2' },
  });
  mkdirSync(path.join(dir, 'recordings', 'rec-1'), { recursive: true });
  writeFileSync(path.join(dir, 'recordings', 'rec-1', 'meta.json'), JSON.stringify({ id: 'rec-1', runId: DUP }));
  return dir;
}

describe('one-time duplicate cleanup', () => {
  it('lists every duplicate; merges keep all links; decisions are only listed; a second run finds nothing', () => {
    const dir = fixture();
    const plan = planCleanup(loadDataSet(dir));
    const lines = plan.map((p) => `${p.certainty}:${p.kind}`);
    expect(lines).toEqual(expect.arrayContaining([
      'merge:people_email', 'merge:meeting_same_file', 'review:meeting_title_start', 'merge:action_items', 'merge:attendees',
      'merge:recipient_alias', 'merge:schedule_title_start', 'review:possible_same_person',
    ]));
    expect(plan.find((p) => p.kind === 'meeting_same_file')).toMatchObject({ keep: RUN, merge: [DUP] }); // the sent one is kept

    const before = readFileSync(path.join(dir, 'minutes-drafts.json'), 'utf8');
    const backup = backupDataSet(dir, path.join(dir, 'backup'));
    expect(backup).toContain('recordings/rec-1/meta.json');
    const data = loadDataSet(dir);
    saveDataSet(dir, data, applyPlan(data, plan));
    const after = loadDataSet(dir);

    // People: one record under the normalized email, with both names and sources.
    expect(Object.keys(after.people)).toEqual(['sara@x.io']);
    expect(after.people['sara@x.io']).toMatchObject({ names: { entered: 'Sara', calendar: 'Sara Lee' }, origins: ['meeting', 'calendar'], createdAt: '2026-10-01' });
    // Meetings: the duplicate is gone; its calendar link, recording, sent record and recipient moved over.
    expect(Object.keys(after.minutesGate).sort()).toEqual([OTHER, RUN].sort());
    expect(after.transcripts[DUP]).toBeUndefined();
    expect(after.minutesDocs[DUP]).toBeUndefined();
    expect(after.schedule.s1.runId).toBe(RUN);
    expect(after.recordings['rec-1'].runId).toBe(RUN);
    expect(after.sentEmails).toEqual({ [`${RUN}:Sara`]: 't1', [`${RUN}:Tom`]: 't2' });
    expect(after.recipients[RUN]).toEqual({ Sara: 'sara@x.io', Tom: 'tom@x.io' }); // alias "sara@x.io" dropped, Tom kept
    expect(after.finalApprovals[RUN].selectedRecipients).toEqual(['Sara']);
    // Action items: one per task + owner, carrying the due date and "done" from the repeat; blank rows untouched.
    expect(after.minutesGate[RUN].draft.actionItems).toEqual([item('Book venue', 'Sara', { dueDate: '2026-10-09', status: 'done' }), item('', 'Sara'), item('', 'Sara')]);
    expect(after.finalApprovals[RUN].minutes!.actionItems).toHaveLength(1);
    expect(after.tracker[RUN].loggedItems).toHaveLength(1);
    expect(after.minutesGate[RUN].draft.meetingSummary.attendees).toEqual(['Sara', 'Tom']);
    // Calendar: one entry (the one with the recording), participants combined.
    expect(Object.keys(after.schedule)).toEqual(['s1']);
    expect(after.schedule.s1.participants.map((p) => p.email)).toEqual(['sara@x.io', 'ann@x.io']);
    // Idempotent; review items stay listed and untouched.
    expect(planCleanup(after).filter((p) => p.certainty === 'merge')).toEqual([]);
    expect(planCleanup(after).map((p) => p.kind).sort()).toEqual(['meeting_title_start', 'possible_same_person']);
    expect(existsSync(path.join(dir, 'backup', 'minutes-drafts.json'))).toBe(true);
    expect(readFileSync(path.join(dir, 'backup', 'minutes-drafts.json'), 'utf8')).toBe(before);
  });

  it('an empty or clean data folder plans nothing and writes nothing', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'ma-empty-'));
    expect(planCleanup(loadDataSet(empty))).toEqual([]);
    const d = loadDataSet(empty);
    saveDataSet(empty, d, applyPlan(d, []));
    expect(existsSync(path.join(empty, 'people.json'))).toBe(false);
  });
});

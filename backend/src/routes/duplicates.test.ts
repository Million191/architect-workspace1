import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';

/** No duplicates across the dashboard: meetings, attendees/people, action items, recipients, counts. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + 4000, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(4000, 40);
  const samples = Buffer.alloc(4000);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 5) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}
function setup(): { app: express.Express; pipeline: MeetingPipeline } {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  return { pipeline, app: createApp({ meetingPipeline: pipeline, schedule, people: createPeopleService({ store: new Map<string, PersonRecord>() }) }) };
}
const post = (app: express.Express, salt: string, fields: Record<string, string> = {}) => {
  let r = request(app).post('/api/meetings/draft');
  for (const [k, v] of Object.entries({ attendees: 'Sara <sara@x.io>', title: 'Kickoff', ...fields })) r = r.field(k, v);
  return r.attach('audio', wav(salt), 'm.wav');
};
const meetings = async (app: express.Express) => (await request(app).get('/api/meetings')).body.meetings as Array<{ runId: string; participants: string[]; people: Array<{ name: string; email?: string }>; actionItemCount: number }>;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('duplicates', () => {
  it('the same file uploaded twice, under another source, or twice at once is one meeting', async () => {
    const { app } = setup();
    const first = await post(app, 'dup-1');
    expect(first.status).toBe(201);
    expect((await post(app, 'dup-1')).body.runId).toBe(first.body.runId);
    expect((await post(app, 'dup-1', { source: 'phone' })).body.runId).toBe(first.body.runId);
    const [a, b] = await Promise.all([post(app, 'dup-2'), post(app, 'dup-2')]); // double-clicked Upload
    expect(a.body.runId).toBe(b.body.runId);
    expect((await meetings(app)).map((m) => m.runId).sort()).toEqual([first.body.runId, a.body.runId].sort());
  });

  it('same title + same scheduled start is one meeting, even from a different file; a different start is not', async () => {
    const { pipeline } = setup();
    const base = { originalFilename: 'm.wav', source: 'room_mic' as const, attendeeNames: ['Sara'] };
    const one = await pipeline.draftMinutes({ ...base, buffer: wav('ts-1'), meetingContext: { title: 'Weekly Sync', scheduledAt: '2026-10-05T14:00:00Z' } });
    const two = await pipeline.draftMinutes({ ...base, buffer: wav('ts-2'), meetingContext: { title: 'weekly sync', scheduledAt: '2026-10-05T14:00:00Z' } });
    const three = await pipeline.draftMinutes({ ...base, buffer: wav('ts-3'), meetingContext: { title: 'Weekly Sync', scheduledAt: '2026-10-12T14:00:00Z' } });
    const untimed = await pipeline.draftMinutes({ ...base, buffer: wav('ts-4'), meetingContext: { title: 'Weekly Sync' } });
    expect(two.runId).toBe(one.runId);
    expect(new Set([one.runId, three.runId, untimed.runId]).size).toBe(3);
    expect(pipeline.listMeetings()).toHaveLength(3);
  });

  it('attendees: the same person typed twice is one participant; a typed name matches the person in People', async () => {
    const { app } = setup();
    await request(app).post('/api/people').send({ name: 'Dagim', email: 'dagim@x.io' });
    const res = await post(app, 'att-1', { attendees: 'Sara <sara@x.io>, SARA@X.IO, sara, Dagim' });
    expect(res.status).toBe(201);
    const m = (await meetings(app)).find((x) => x.runId === res.body.runId)!;
    expect(m.people).toEqual([{ name: 'Sara', email: 'sara@x.io' }, { name: 'Dagim', email: 'dagim@x.io' }]);
    const people = (await request(app).get('/api/people')).body.people as Array<{ email: string }>;
    expect(people.map((p) => p.email).sort()).toEqual(['dagim@x.io', 'sara@x.io']);
  });

  it('action items: no repeats within a meeting, in the minutes, the count, and after edits', async () => {
    const { app, pipeline } = setup();
    const runId = (await post(app, 'ai-1')).body.runId as string;
    const doc = (await request(app).get(`/api/minutes/${runId}`)).body;
    const item = { id: 'dup-a', task: 'Book the venue', owner: 'Sara' };
    const saved = await request(app).put(`/api/minutes/${runId}`).send({
      baseRevision: doc.revision, editedBy: 'Sara',
      content: { sections: doc.content.sections, actionItems: [...doc.content.actionItems, item, { ...item, id: 'dup-b', task: 'book the venue.', owner: 'sara' }, { id: 'blank-1', task: '' }] },
    });
    expect(saved.status).toBe(200);
    const tasks = saved.body.content.actionItems.map((a: { task: string }) => a.task.toLowerCase());
    expect(tasks.filter((t: string) => t.startsWith('book the venue'))).toHaveLength(1);
    expect(tasks.filter((t: string) => t === '')).toHaveLength(1); // a row still being typed stays
    const run = pipeline.getRun(runId);
    expect(run.minutes.actionItems.filter((a) => /book the venue/i.test(a.task))).toHaveLength(1);
    expect((await meetings(app)).find((m) => m.runId === runId)!.actionItemCount).toBe(run.minutes.actionItems.length);
  });

  it('adding a recipient whose address is already on the meeting does not add them again', async () => {
    const { app, pipeline } = setup();
    const runId = (await post(app, 'rc-1')).body.runId as string;
    await pipeline.approveMinutes(runId, 'Sara');
    const before = Object.keys(pipeline.getRun(runId).recipients ?? {}).length;
    pipeline.addRecipients(runId, [{ name: 'Sara Lee', email: ' SARA@x.io ' }, { email: 'sara@x.io' }]);
    expect(Object.keys(pipeline.getRun(runId).recipients ?? {})).toHaveLength(before);
  });

  it('a double-clicked "Approve & send" sends once and shows one activity line', async () => {
    const { app, pipeline } = setup();
    const runId = (await post(app, 'snd-1')).body.runId as string;
    await pipeline.approveMinutes(runId, 'Sara');
    const [a, b] = await Promise.all([
      request(app).post(`/api/meetings/${runId}/approve-emails`).send({ approvedBy: 'Sara' }),
      request(app).post(`/api/meetings/${runId}/approve-emails`).send({ approvedBy: 'Sara' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(pipeline.getRun(runId).sentTo).toHaveLength(1);
    const items = (await request(app).get('/api/activity?limit=100')).body.items as Array<{ kind: string; runId: string }>;
    expect(items.filter((i) => i.kind === 'emails_sent' && i.runId === runId)).toHaveLength(1);
  });
});

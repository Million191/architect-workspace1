import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';

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
  return Buffer.concat([header, Buffer.alloc(4000, 3), Buffer.from(salt)]);
}

async function setup(): Promise<{ app: Express; runId: string }> {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  schedule.create({ title: 'Vendor kickoff', start: '2026-10-07T15:00:00.000Z', end: '2026-10-07T16:00:00.000Z', participants: [{ name: 'Raj Patel', email: 'raj@vendor.io' }], agenda: 'Contract terms' });
  const app = createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()), schedule, people: createPeopleService({ store: new Map<string, PersonRecord>() }) });
  const res = await request(app).post('/api/meetings/draft').field('title', 'Launch planning').field('attendees', 'Sara Lee <sara.lee@acme.com>, Tom Ward <tom.ward@acme.com>').attach('audio', wav('s'), 's.wav');
  expect(res.status).toBe(201);
  return { app, runId: res.body.runId };
}

describe('/api/search', () => {
  it('finds meetings by title and participant, scheduled meetings, and transcript lines with speaker + time', async () => {
    const { app, runId } = await setup();
    const byTitle = (await request(app).get('/api/search?q=launch')).body;
    expect(byTitle.groups[0]).toMatchObject({ key: 'meetings', label: 'Meetings' });
    expect(byTitle.groups[0].items[0]).toMatchObject({ title: 'Launch planning', runId });
    expect((await request(app).get('/api/search?q=sara.lee%40acme.com')).body.groups[0].items[0].title).toBe('Launch planning');
    expect((await request(app).get('/api/search?q=raj')).body.groups[0].items[0]).toMatchObject({ title: 'Vendor kickoff', scheduleId: expect.any(String) });

    const transcript = (await request(app).get('/api/search?q=onboarding')).body.groups[1];
    expect(transcript.total).toBeGreaterThan(0);
    expect(transcript.items[0]).toMatchObject({ type: 'transcript', title: 'Launch planning', runId, speaker: expect.any(String), startMs: expect.any(Number) });
  });

  it('typo → “Showing results for”, exact=1 → only what was typed', async () => {
    const { app } = await setup();
    const typo = (await request(app).get('/api/search?q=onbaording')).body;
    expect(typo.correction).toEqual({ text: 'onboarding', mode: 'showing' });
    expect(typo.total).toBeGreaterThan(0);
    const exact = (await request(app).get('/api/search?q=onbaording&exact=1')).body;
    expect(exact.total).toBe(0);
    expect(exact.correction).toBeUndefined();
  });

  it('the index follows edits: a word added in the minutes is searchable on the next query', async () => {
    const { app, runId } = await setup();
    expect((await request(app).get('/api/search?q=zeppelin')).body.total).toBe(0);
    const run = (await request(app).get(`/api/meetings/${runId}`)).body;
    const edits = {
      discussionTopics: run.minutes.discussionTopics.map((t: { topic: string; summary: string }, i: number) => ({ topic: t.topic, summary: i === 0 ? 'Project Zeppelin timeline' : t.summary })),
      decisions: run.minutes.decisions.map((d: { decision: string }) => ({ decision: d.decision })),
      actionItems: run.minutes.actionItems.map((a: { task: string }) => ({ task: a.task, done: false })),
    };
    expect((await request(app).post(`/api/meetings/${runId}/minutes`).send(edits)).status).toBe(200);
    expect((await request(app).get('/api/search?q=zeppelin')).body.groups[0].items[0].title).toBe('Launch planning');
  });

  it('“See all” returns one group with a bigger limit; bad parameters are rejected', async () => {
    const { app } = await setup();
    const all = (await request(app).get('/api/search?q=the&group=transcripts&limit=50')).body;
    expect(all.groups.map((g: { key: string }) => g.key)).toEqual(['transcripts']);
    for (const bad of ['limit=0', 'limit=51', 'group=people', 'exact=yes', `q=${'x'.repeat(201)}`]) {
      const r = await request(app).get(`/api/search?${bad}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('ValidationError');
    }
  });

  it('works with no data at all', async () => {
    const r = await request(createApp({})).get('/api/search?q=anything');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });
});

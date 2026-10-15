import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createPeopleService, PersonConflictError } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createScheduleService, ScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';

/**
 * The People directory holds only real people: participants of current meetings and calendar
 * entries, plus people added by hand. Deleting a meeting removes its people (unless added or
 * corrected by you); an empty app has nobody; email changes reach unsent meetings.
 */
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
function setup(): { app: express.Express; pipeline: MeetingPipeline; schedule: ScheduleService; store: Map<string, PersonRecord> } {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const store = new Map<string, PersonRecord>();
  return { pipeline, schedule, store, app: createApp({ meetingPipeline: pipeline, schedule, people: createPeopleService({ store }) }) };
}
async function upload(app: express.Express, attendees: string, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('attendees', attendees).field('title', 'Kickoff').attach('audio', wav(salt), 'm.wav');
  return res.body.runId as string;
}
const emails = async (app: express.Express) => ((await request(app).get('/api/people')).body.people as Array<{ email: string }>).map((p) => p.email);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('People directory', () => {
  it('starts empty: no sample or default people', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/people')).body).toEqual({ people: [] });
  });

  it('participants of a meeting appear once each (by email), across several meetings', async () => {
    const { app } = setup();
    await upload(app, 'Million <million@x.io>, Sara <sara@x.io>', 'pd-1');
    await upload(app, 'Sara <SARA@x.io>', 'pd-2');
    expect(await emails(app)).toEqual(['million@x.io', 'sara@x.io']);
  });

  it('deleting the meeting removes its people — except people added by hand or corrected', async () => {
    const { app } = setup();
    const runId = await upload(app, 'Sara <sara@x.io>, Tom <tom@x.io>, Ann <ann@x.io>', 'pd-3');
    expect(await emails(app)).toHaveLength(3);
    await request(app).put('/api/people/tom%40x.io').send({ name: 'Tom Ward' }); // corrected by you
    await request(app).post('/api/people').send({ name: 'Ann Bo', email: 'ann@x.io' }); // added by you
    await request(app).delete(`/api/meetings/${encodeURIComponent(runId)}`);
    expect(await emails(app)).toEqual(['ann@x.io', 'tom@x.io']);
    expect(await emails(app)).toEqual(['ann@x.io', 'tom@x.io']); // idempotent
  });

  it('+ Add person: validated; the same address again updates that person (no duplicate)', async () => {
    const { app } = setup();
    for (const body of [{ email: 'a@x.io' }, { name: 'A', email: 'nope' }, { name: '<A>', email: 'a@x.io' }, { name: 'A', email: 'a@x.io', avatarUrl: 'http://x' }, { name: 'A', email: 'a@x.io', extra: 1 }]) {
      expect((await request(app).post('/api/people').send(body)).status).toBe(400);
    }
    const res = await request(app).post('/api/people').send({ name: 'Dana Cruz', email: 'Dana@x.io', avatarUrl: 'https://img.example/d.png' });
    expect(res.status).toBe(201);
    expect(res.body.person).toMatchObject({ id: 'dana@x.io', name: 'Dana Cruz', nameSource: 'edited', avatarUrl: 'https://img.example/d.png', origins: ['manual'] });
    await request(app).post('/api/people').send({ name: 'Dana C.', email: 'dana@X.io' });
    const people = (await request(app).get('/api/people')).body.people;
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Dana C.');
  });

  it('correcting an email re-keys the person and updates meetings not yet sent; refuses an address someone else has', async () => {
    const { app, pipeline, schedule } = setup();
    const runId = await upload(app, 'Sara <sara@old.io>, Tom <tom@x.io>', 'pd-4');
    const m = schedule.create({ title: 'Next sync', start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z', participants: [{ name: 'Sara', email: 'sara@old.io' }] }).meeting;
    await request(app).get('/api/people');
    expect((await request(app).put('/api/people/sara%40old.io').send({ email: 'tom@x.io' })).status).toBe(409);
    expect((await request(app).put('/api/people/sara%40old.io').send({ email: 'not-an-email' })).status).toBe(400);
    const res = await request(app).put('/api/people/sara%40old.io').send({ email: 'sara@new.io' });
    expect(res.status).toBe(200);
    expect(res.body.person).toMatchObject({ id: 'sara@new.io', email: 'sara@new.io', name: 'Sara' });
    expect(pipeline.getRun(runId).recipients!.Sara).toBe('sara@new.io');
    expect(schedule.get(m.id).participants[0].email).toBe('sara@new.io');
    expect(await emails(app)).toEqual(['sara@new.io', 'tom@x.io']);
  });

  it('an email already sent keeps the address it was sent to', async () => {
    const { app, pipeline } = setup();
    const runId = await upload(app, 'Sara <sara@old.io>', 'pd-5');
    await pipeline.approveMinutes(runId, 'Million');
    await pipeline.approveEmailsAndSend(runId, 'Million');
    await request(app).get('/api/people');
    await request(app).put('/api/people/sara%40old.io').send({ email: 'sara@new.io' });
    expect(pipeline.getRun(runId).recipients!.Sara).toBe('sara@old.io');
  });

  it('the service refuses to re-key onto an existing person', () => {
    const svc = createPeopleService({ store: new Map<string, PersonRecord>() });
    svc.add({ name: 'A', email: 'a@x.io' });
    svc.add({ name: 'B', email: 'b@x.io' });
    expect(() => svc.update('a@x.io', { email: 'B@x.io' })).toThrow(PersonConflictError);
    expect(svc.list().map((p) => p.email)).toEqual(['a@x.io', 'b@x.io']);
  });

  it('role: added with the person, edited, cleared, validated, searchable; a person with a role is kept', async () => {
    const { app, store } = setup();
    const added = await request(app).post('/api/people').send({ name: 'Dana Cruz', email: 'dana@x.io', role: ' Product Manager ' });
    expect(added.body.person).toMatchObject({ name: 'Dana Cruz', role: 'Product Manager' });
    expect((await request(app).get('/api/people?q=product')).body.people.map((p: { email: string }) => p.email)).toEqual(['dana@x.io']);
    expect((await request(app).put('/api/people/dana@x.io').send({ role: 'Head of Design' })).body.person.role).toBe('Head of Design');
    expect((await request(app).put('/api/people/dana@x.io').send({ role: '<b>' })).status).toBe(400);
    expect((await request(app).put('/api/people/dana@x.io').send({ role: 'x'.repeat(101) })).status).toBe(400);
    expect((await request(app).put('/api/people/dana@x.io').send({ role: null })).body.person.role).toBeUndefined();
    // A meeting participant given a role stays in the list after their meeting is gone.
    const runId = await upload(app, 'Sam <sam@x.io>', 'role-1');
    await emails(app); // the People list picks up the meeting's participants
    expect((await request(app).put('/api/people/sam@x.io').send({ role: 'Engineer' })).status).toBe(200);
    await request(app).delete(`/api/meetings/${encodeURIComponent(runId)}`);
    expect(await emails(app)).toEqual(expect.arrayContaining(['sam@x.io']));
    expect(store.get('sam@x.io')?.role).toBe('Engineer');
  });
});

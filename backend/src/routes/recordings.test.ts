import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createApp } from '../server';
import { createRecordingService } from '../services/recording/recordingService';
import { RecordingStore } from '../services/recording/recordingStore';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
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

function app() {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const settings = new Map<string, string>();
  const a = createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule,
    recordings: createRecordingService({ store: new RecordingStore(mkdtempSync(path.join(os.tmpdir(), 'rec-route-'))) }),
    settings,
  });
  return { app: a, schedule, settings };
}

const ID = '7d1f3c2a-1111-4222-8333-444455556666';
const create = (body: object = {}) => ({ id: ID, mode: 'in_person', title: 'Standup', attendees: 'Sara Lee <sara@x.io>, Tom <tom@x.io>', mimeType: 'audio/wav', consent: true, ...body });
const chunk = (a: ReturnType<typeof app>['app'], i: number, data: Buffer) => request(a).put(`/api/recordings/${ID}/chunks/${i}`).set('Content-Type', 'application/octet-stream').send(data);

describe('/api/recordings', () => {
  it('create → chunks → finish turns a live recording into a meeting ready for review', async () => {
    const { app: a } = app();
    expect((await request(a).post('/api/recordings').send(create())).status).toBe(201);
    const audio = wav('live');
    const parts = [audio.subarray(0, 1000), audio.subarray(1000, 3000), audio.subarray(3000)];
    for (const [i, p] of parts.entries()) expect((await chunk(a, i, p)).body.received).toBe(i);
    const done = await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 3, durationMs: 9000, markers: [{ atMs: 3000, note: 'Decision on budget' }] });
    expect(done.status).toBe(200);
    expect(done.body.recording).toMatchObject({ status: 'ready', markers: [{ atMs: 3000, note: 'Decision on budget' }] });
    expect(done.body.run).toMatchObject({ stage: 'minutes_pending_approval' });
    expect(done.body.run.minutes.meetingSummary.title).toBe('Standup');
    expect(done.body.run.recipients).toEqual({ 'Sara Lee': 'sara@x.io', Tom: 'tom@x.io' });
    expect((await request(a).get(`/api/recordings/by-run/${done.body.run.runId}`)).body.id).toBe(ID);
    // Progress for the processing screen uses the recording id.
    expect((await request(a).get(`/api/meetings/progress/${ID}`)).body.phase).toBe('done');
    // The new meeting is searchable right away (title and transcript).
    const found = (await request(a).get('/api/search?q=standup')).body;
    expect(found.groups[0].items[0]).toMatchObject({ title: 'Standup', runId: done.body.run.runId });
    // Finishing twice is safe.
    const again = await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 3 });
    expect(again.body.run.runId).toBe(done.body.run.runId);
  });

  it('a missing chunk is named so the page can re-send exactly that one', async () => {
    const { app: a } = app();
    await request(a).post('/api/recordings').send(create());
    const audio = wav('gap');
    await chunk(a, 0, audio.subarray(0, 2000));
    const res = await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'MissingChunksError', missing: [1] });
    await chunk(a, 1, audio.subarray(2000));
    expect((await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 2 })).status).toBe(200);
  });

  it('links the recording to its calendar meeting', async () => {
    const { app: a, schedule } = app();
    const m = schedule.create({ title: 'Planning', start: '2026-10-04T10:00:00Z', end: '2026-10-04T11:00:00Z', participants: [{ name: 'Sara Lee', email: 'sara@x.io' }] }).meeting;
    await request(a).post('/api/recordings').send(create({ scheduledMeetingId: m.id }));
    await chunk(a, 0, wav('linked'));
    const done = await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 1 });
    expect(schedule.get(m.id).runId).toBe(done.body.run.runId);
  });

  it('validation: consent, mode, attendees, ids, chunk bodies, and finish input', async () => {
    const { app: a } = app();
    expect((await request(a).post('/api/recordings').send(create({ consent: false }))).body.message).toContain('knows it is being recorded');
    expect((await request(a).post('/api/recordings').send(create({ mode: 'bot' }))).status).toBe(400);
    expect((await request(a).post('/api/recordings').send(create({ attendees: 'Bad <nope>' }))).status).toBe(400);
    expect((await request(a).post('/api/recordings').send(create({ id: 'x' }))).status).toBe(400);
    expect((await request(a).post('/api/recordings').send(create({ mimeType: 'audio/flac' }))).status).toBe(400);
    await request(a).post('/api/recordings').send(create());
    expect((await request(a).put(`/api/recordings/${ID}/chunks/abc`).send(Buffer.from('x'))).status).toBe(400);
    expect((await request(a).put(`/api/recordings/${ID}/chunks/0`).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(9 * 1024 * 1024))).status).toBe(413);
    expect((await request(a).post(`/api/recordings/${ID}/finish`).send({ chunkCount: 0 })).status).toBe(400);
    expect((await request(a).get('/api/recordings/nope-nope-nope')).status).toBe(404);
  });

  it('retention setting: read, change (applies immediately), and reject unknown values', async () => {
    const { app: a, settings } = app();
    expect((await request(a).get('/api/recordings/settings/retention')).body.rawAudioRetention).toBe('30_days');
    const put = await request(a).put('/api/recordings/settings/retention').send({ rawAudioRetention: 'after_approval' });
    expect(put.body).toEqual({ rawAudioRetention: 'after_approval', audioDeleted: 0 });
    expect(settings.get('rawAudioRetention')).toBe('after_approval');
    expect((await request(a).put('/api/recordings/settings/retention').send({ rawAudioRetention: 'forever' })).status).toBe(400);
  });

  it('discard, and 503 when recording is not set up', async () => {
    const { app: a } = app();
    await request(a).post('/api/recordings').send(create());
    expect((await request(a).delete(`/api/recordings/${ID}`)).body).toEqual({ discarded: true });
    expect((await request(a).get(`/api/recordings/${ID}`)).status).toBe(404);
    expect((await request(createApp({})).post('/api/recordings').send(create())).status).toBe(503);
  });
});

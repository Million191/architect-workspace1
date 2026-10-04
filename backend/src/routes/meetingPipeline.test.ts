import request from 'supertest';
import { createApp } from '../server';
import { parseAttendee } from './meetingPipeline';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';

function wavBuffer(salt: string): Buffer {
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
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 7) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function demoApp() {
  const providers = createDemoProviders();
  return { providers, app: createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()) }) };
}

describe('/api/meetings', () => {
  it('walks upload → draft → approve minutes → approve emails → sent', async () => {
    const { app, providers } = demoApp();

    const draft = await request(app)
      .post('/api/meetings/draft')
      .field('attendees', 'Alice, Bob')
      .field('title', 'Launch sync')
      .attach('audio', wavBuffer('route-happy'), 'meeting.wav');
    expect(draft.status).toBe(201);
    expect(draft.body.stage).toBe('minutes_pending_approval');
    const runPath = `/api/meetings/${encodeURIComponent(draft.body.runId)}`;

    const minutes = await request(app).post(`${runPath}/approve-minutes`).send({ approvedBy: 'Reviewer' });
    expect(minutes.status).toBe(200);
    expect(minutes.body.stage).toBe('emails_pending_approval');
    expect(providers.outbox).toHaveLength(0);

    const sent = await request(app).post(`${runPath}/approve-emails`).send({ approvedBy: 'Reviewer' });
    expect(sent.status).toBe(200);
    expect(sent.body.stage).toBe('sent');
    expect(providers.outbox).toHaveLength(2);

    const fetched = await request(app).get(runPath);
    expect(fetched.body.trackedActionItems).toHaveLength(2);
  });

  it('refuses to send before the minutes are approved (409)', async () => {
    const { app, providers } = demoApp();
    const draft = await request(app).post('/api/meetings/draft').field('attendees', 'Alice').attach('audio', wavBuffer('route-order'), 'm.wav');
    const res = await request(app).post(`/api/meetings/${encodeURIComponent(draft.body.runId)}/approve-emails`).send({ approvedBy: 'Reviewer' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('StageOrderError');
    expect(providers.outbox).toHaveLength(0);
  });

  it('validates input', async () => {
    const { app } = demoApp();
    expect((await request(app).post('/api/meetings/draft').field('attendees', 'Alice')).status).toBe(400);
    const noAttendees = await request(app).post('/api/meetings/draft').field('attendees', ' , ').attach('audio', wavBuffer('v'), 'm.wav');
    expect(noAttendees.status).toBe(400);
    const badAudio = await request(app).post('/api/meetings/draft').field('attendees', 'Alice').attach('audio', Buffer.from('not audio'), 'm.wav');
    expect(badAudio.status).toBe(422);
    expect((await request(app).post('/api/meetings/x/approve-minutes').send({})).status).toBe(400);
    expect((await request(app).post('/api/meetings/x/approve-minutes').send({ approvedBy: 'R' })).status).toBe(404);
  });

  it('answers 503 when no providers are configured', async () => {
    const res = await request(createApp()).post('/api/meetings/draft').field('attendees', 'Alice');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ProvidersNotConfigured');
  });

  it('serves the review page', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Meeting Assistant');
  });
});

describe('attendee entries', () => {
  it('parses Name <email>, bare addresses, and bare names', () => {
    expect(parseAttendee('Alice Smith <alice@example.com>')).toEqual({ name: 'Alice Smith', email: 'alice@example.com' });
    expect(parseAttendee('"Bob" <bob@example.com>')).toEqual({ name: 'Bob', email: 'bob@example.com' });
    expect(parseAttendee('carol@example.com')).toEqual({ name: 'carol@example.com', email: 'carol@example.com' });
    expect(parseAttendee('Dan')).toEqual({ name: 'Dan' });
    expect(typeof parseAttendee('Eve <not-an-email>')).toBe('string');
    expect(typeof parseAttendee('Eve <eve@example.com')).toBe('string');
  });

  it('rejects a malformed address with 400 and stores good ones with the run', async () => {
    const { app } = demoApp();
    const bad = await request(app).post('/api/meetings/draft').field('attendees', 'Alice <alice@>').attach('audio', wavBuffer('addr-bad'), 'm.wav');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/valid email address/);

    const good = await request(app)
      .post('/api/meetings/draft')
      .field('attendees', 'Alice Smith <alice@example.com>; Bob')
      .attach('audio', wavBuffer('addr-good'), 'm.wav');
    expect(good.status).toBe(201);
    expect(good.body.recipients).toEqual({ 'Alice Smith': 'alice@example.com' });
    expect(good.body.minutes.meetingSummary.attendees).toEqual(['Alice Smith', 'Bob']);
  });
});

describe('approved meeting after a server restart', () => {
  it('GET /api/meetings/:runId still returns the approved draft email', async () => {
    const { mkdtempSync } = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'route-record-'));
    const draftOnly = () => Object.assign(createDemoProviders(), { emailMode: 'draft-only' as const });

    const before = createApp({ meetingPipeline: createMeetingPipeline(draftOnly(), createPipelineStores({ dataDir })) });
    const draft = await request(before).post('/api/meetings/draft').field('attendees', 'Alice <alice@example.com>').attach('audio', wavBuffer('route-restart'), 'm.wav');
    const runPath = `/api/meetings/${encodeURIComponent(draft.body.runId)}`;
    await request(before).post(`${runPath}/approve-minutes`).send({ approvedBy: 'Reviewer' });
    const approved = await request(before).post(`${runPath}/approve-emails`).send({ approvedBy: 'Reviewer' });
    expect(approved.body.stage).toBe('approved_not_sent');

    const after = createApp({ meetingPipeline: createMeetingPipeline(draftOnly(), createPipelineStores({ dataDir })) });
    const reloaded = await request(after).get(runPath);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.stage).toBe('approved_not_sent');
    expect(reloaded.body.emails.emails[0].body).toBe(approved.body.emails.emails[0].body);
    expect(reloaded.body.recipients).toEqual({ Alice: 'alice@example.com' });
  });
});

describe('upload progress', () => {
  it('reports the finished phase for an upload id, and 404s for unknown or malformed ids', async () => {
    const { app } = demoApp();
    const draft = await request(app)
      .post('/api/meetings/draft')
      .field('attendees', 'Alice')
      .field('uploadId', 'test-upload-0001')
      .attach('audio', wavBuffer('progress'), 'm.wav');
    expect(draft.status).toBe(201);
    const progress = await request(app).get('/api/meetings/progress/test-upload-0001');
    expect(progress.status).toBe(200);
    expect(progress.body).toMatchObject({ phase: 'done', stage: 'minutes review gate' });
    expect((await request(app).get('/api/meetings/progress/unknown-0001')).status).toBe(404);
    expect((await request(app).get('/api/meetings/progress/bad!id')).status).toBe(404);
    const badField = await request(app).post('/api/meetings/draft').field('attendees', 'A').field('uploadId', 'x').attach('audio', wavBuffer('p2'), 'm.wav');
    expect(badField.status).toBe(400);
  });
});

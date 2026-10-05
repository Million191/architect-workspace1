import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipelineRouter } from './meetingPipeline';
import { buildActivity } from './activity';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { RecordingMeta } from '../services/recording/types';

/** Dashboard data: list fields (status lifecycle, time, duration), renaming a meeting, recent activity. */
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

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function demoApp(emailMode: 'live' | 'draft-only' = 'live') {
  const providers = Object.assign(createDemoProviders(), { emailMode });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  return { providers, pipeline, app: createApp({ meetingPipeline: pipeline }) };
}
async function draft(app: express.Express, title: string, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('attendees', 'Alice <alice@x.io>, Bob <bob@x.io>').field('title', title).attach('audio', wav(salt), 'm.wav');
  expect(res.status).toBe(201);
  return res.body.runId as string;
}
const list = async (app: express.Express) => (await request(app).get('/api/meetings')).body.meetings as Array<Record<string, unknown>>;
const path = (runId: string) => `/api/meetings/${encodeURIComponent(runId)}`;

describe('GET /api/meetings — dashboard fields', () => {
  it('walks the status lifecycle: needs_review → emails_drafted → sent, with time, duration and action-item count', async () => {
    const { app } = demoApp('live');
    const runId = await draft(app, 'Launch sync', 'dash-life');
    let m = (await list(app)).find((x) => x.runId === runId)!;
    expect(m.status).toBe('needs_review');
    expect(typeof m.durationMs).toBe('number');
    expect(m.durationMs as number).toBeGreaterThan(0);
    expect(typeof m.actionItemCount).toBe('number');

    await request(app).post(`${path(runId)}/approve-minutes`).send({ approvedBy: 'Reviewer' });
    m = (await list(app)).find((x) => x.runId === runId)!;
    expect(m.status).toBe('emails_drafted');

    await request(app).post(`${path(runId)}/approve-emails`).send({ approvedBy: 'Reviewer' });
    m = (await list(app)).find((x) => x.runId === runId)!;
    expect(m.status).toBe('sent');
  });

  it('draft-only mode ends at "approved", never "sent"', async () => {
    const { app, providers } = demoApp('draft-only');
    const runId = await draft(app, 'Draft only', 'dash-draft');
    await request(app).post(`${path(runId)}/approve-minutes`).send({ approvedBy: 'Reviewer' });
    await request(app).post(`${path(runId)}/approve-emails`).send({ approvedBy: 'Reviewer' });
    expect((await list(app)).find((x) => x.runId === runId)!.status).toBe('approved');
    expect(providers.outbox).toHaveLength(0);
  });

  it('lists live recordings whose processing failed, first, with status "failed" and what went wrong', async () => {
    const { pipeline } = demoApp();
    const failed = { id: 'rec-1', title: 'Board call', createdAt: '2026-10-04T14:30:00.000Z', updatedAt: '2026-10-04T15:00:00.000Z', durationMs: 120000, chunks: [0, 1, 2],
      attendees: [{ name: 'Alice', email: 'alice@x.io' }], status: 'failed', error: { errorClass: 'TranscriptionError', message: 'Speech service unavailable' } } as unknown as RecordingMeta;
    const app = express();
    app.use(express.json());
    app.use('/api/meetings', createMeetingPipelineRouter({ pipeline, failedRecordings: () => [failed] }));
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    expect(res.body.meetings[0]).toMatchObject({ runId: null, recordingId: 'rec-1', status: 'failed', stage: 'failed', title: 'Board call', date: '2026-10-04',
      time: '14:30', durationMs: 120000, chunkCount: 3, error: 'Speech service unavailable', participants: ['Alice'] });
  });
});

describe('PATCH /api/meetings/:runId/title', () => {
  it('renames a meeting under review; the list, the run and the minutes all show the new title', async () => {
    const { app } = demoApp();
    const runId = await draft(app, 'Old name', 'dash-rename');
    const res = await request(app).patch(`${path(runId)}/title`).send({ title: '  Q4 planning  ', editedBy: 'Million' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runId, title: 'Q4 planning' });
    expect((await list(app)).find((x) => x.runId === runId)!.title).toBe('Q4 planning');
    expect((await request(app).get(path(runId))).body.minutes.meetingSummary.title).toBe('Q4 planning');
  });

  it('is idempotent: the same title twice gives the same result', async () => {
    const { app } = demoApp();
    const runId = await draft(app, 'Same', 'dash-idem');
    const a = await request(app).patch(`${path(runId)}/title`).send({ title: 'Renamed' });
    const b = await request(app).patch(`${path(runId)}/title`).send({ title: 'Renamed' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    expect((await list(app)).filter((x) => x.title === 'Renamed')).toHaveLength(1);
  });

  it('renames an approved meeting too', async () => {
    const { app } = demoApp('draft-only');
    const runId = await draft(app, 'Approved one', 'dash-approved');
    await request(app).post(`${path(runId)}/approve-minutes`).send({ approvedBy: 'Reviewer' });
    await request(app).post(`${path(runId)}/approve-emails`).send({ approvedBy: 'Reviewer' });
    const res = await request(app).patch(`${path(runId)}/title`).send({ title: 'Approved, renamed' });
    expect(res.status).toBe(200);
    expect((await list(app)).find((x) => x.runId === runId)!.title).toBe('Approved, renamed');
  });

  it('rejects empty, multi-line, markup-like, over-long and unknown-field titles (400); unknown meeting (404)', async () => {
    const { app } = demoApp();
    const runId = await draft(app, 'Keep me', 'dash-bad');
    for (const body of [{ title: '' }, { title: '   ' }, { title: 'a\nb' }, { title: '<b>x</b>' }, { title: 'x'.repeat(301) }, {}, { title: 'ok', extra: 1 }]) {
      const res = await request(app).patch(`${path(runId)}/title`).send(body);
      expect(res.status).toBe(400);
    }
    expect((await list(app)).find((x) => x.runId === runId)!.title).toBe('Keep me');
    expect((await request(app).patch(`${path('nope')}/title`).send({ title: 'x' })).status).toBe(404);
  });
});

describe('GET /api/activity', () => {
  it('lists real events newest first, phrased for people, and honours limit', async () => {
    const { app } = demoApp('draft-only');
    const runId = await draft(app, 'Weekly sync', 'dash-act');
    await request(app).post(`${path(runId)}/approve-minutes`).send({ approvedBy: 'Priya' });
    await request(app).post(`${path(runId)}/approve-emails`).send({ approvedBy: 'Priya' });
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(200);
    const texts = (res.body.items as Array<{ text: string }>).map((i) => i.text);
    expect(texts).toContain('Minutes approved for Weekly sync');
    expect(texts).toContain('Emails approved for Weekly sync (not sent — draft-only mode)');
    expect(texts.some((t) => /emailed/.test(t))).toBe(false); // draft-only never claims a send
    const ats = (res.body.items as Array<{ at: string }>).map((i) => i.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(res.body.items.every((i: { runId?: string }) => i.runId === runId)).toBe(true);

    const one = await request(app).get('/api/activity?limit=1');
    expect(one.body.items).toHaveLength(1);
    expect(one.body.total).toBe(res.body.total);
  });

  it('is empty with no meetings, and validates limit', async () => {
    const { app } = demoApp();
    expect((await request(app).get('/api/activity')).body).toEqual({ items: [], total: 0 });
    for (const bad of ['0', '101', 'abc']) expect((await request(app).get(`/api/activity?limit=${bad}`)).status).toBe(400);
  });

  it('includes failed recordings, with no meeting link', () => {
    const items = buildActivity({ recordings: { listFailed: () => [{ id: 'r1', title: 'Board call', updatedAt: '2026-10-04T10:00:00.000Z' }] } as never });
    expect(items).toEqual([{ at: '2026-10-04T10:00:00.000Z', kind: 'recording_failed', text: 'Processing failed for Board call', recordingId: 'r1' }]);
  });
});

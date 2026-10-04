import request from 'supertest';
import { createApp } from '../server';
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
  return Buffer.concat([header, Buffer.alloc(4000, 9), Buffer.from(salt)]);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function app() {
  const providers = Object.assign(createDemoProviders(), { emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}
const body = { title: 'Q4 budget review', start: '2026-10-06T15:00:00.000Z', end: '2026-10-06T16:00:00.000Z', participants: [{ name: 'Priya', email: 'priya@example.com' }], by: 'Million' };

describe('/api/schedule', () => {
  it('create → list → update (stale version 409) → cancel → restore → undo → delete', async () => {
    const a = app();
    const created = await request(a).post('/api/schedule').send(body);
    expect(created.status).toBe(201);
    expect(created.body.meeting).toMatchObject({ display: 'upcoming', canUndo: false });
    const id = created.body.meeting.id;
    const week = await request(a).get('/api/schedule').query({ from: '2026-10-05T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z' });
    expect(week.body.meetings.map((m: { id: string }) => m.id)).toEqual([id]);

    expect((await request(a).put(`/api/schedule/${id}`).send({ ...body, start: body.end, end: body.start })).status).toBe(400);
    const moved = await request(a).put(`/api/schedule/${id}`).send({ ...body, start: '2026-10-07T15:00:00.000Z', end: '2026-10-07T16:00:00.000Z', expectedVersion: 1 });
    expect(moved.body.meeting.canUndo).toBe(true);
    expect((await request(a).put(`/api/schedule/${id}`).send({ ...body, expectedVersion: 1 })).status).toBe(409);

    expect((await request(a).post(`/api/schedule/${id}/cancel`).send({ reason: 'Budget frozen' })).body.meeting.display).toBe('cancelled');
    expect((await request(a).post(`/api/schedule/${id}/restore`).send({})).body.meeting.display).toBe('upcoming');
    const restored = await request(a).get(`/api/schedule/${id}`);
    expect((await request(a).post(`/api/schedule/${id}/undo`).send({ version: restored.body.version })).body.meeting.display).toBe('cancelled');
    expect((await request(a).delete(`/api/schedule/${id}`)).status).toBe(204);
    expect((await request(a).get(`/api/schedule/${id}`)).status).toBe(404);
  });

  it('validates input, previews notices, and records draft-only notifications without sending', async () => {
    const a = app();
    expect((await request(a).post('/api/schedule').send({ ...body, participants: [{ email: 'nope' }] })).status).toBe(400);
    expect((await request(a).post('/api/schedule').send({ ...body, link: 'javascript:alert(1)' })).status).toBe(400);
    const id = (await request(a).post('/api/schedule').send(body)).body.meeting.id;
    await request(a).post(`/api/schedule/${id}/postpone`).send({ dateTbd: true, reason: 'Client away' });
    const preview = await request(a).get(`/api/schedule/${id}/notices`).query({ kind: 'postponed', tz: 'UTC' });
    expect(preview.body).toMatchObject({ emailMode: 'draft-only', emails: [{ to: 'priya@example.com', subject: 'Postponed: Q4 budget review' }] });
    const notify = await request(a).post(`/api/schedule/${id}/notify`).send({ kind: 'postponed', tz: 'UTC', by: 'Million' });
    expect(notify.body.outcome).toBe('draft_only');
    expect(notify.body.meeting.history.at(-1).note).toContain('not sent (draft-only mode)');
    expect((await request(a).get(`/api/schedule/${id}/notices`).query({ kind: 'cancelled', tz: 'UTC' })).status).toBe(409);
  });

  it('attaches an uploaded recording to the scheduled meeting; cancelled meetings refuse uploads', async () => {
    const a = app();
    const id = (await request(a).post('/api/schedule').send(body)).body.meeting.id;
    const draft = await request(a).post('/api/meetings/draft').field('attendees', 'Priya <priya@example.com>').field('title', 'Q4 budget review')
      .field('scheduledMeetingId', id).attach('audio', wav('linked'), 'm.wav');
    expect(draft.status).toBe(201);
    expect(draft.body.scheduledMeetingId).toBe(id);
    const linked = await request(a).get(`/api/schedule/${id}`);
    expect(linked.body).toMatchObject({ runId: draft.body.runId, display: 'needs_review' });
    expect((await request(a).put(`/api/schedule/${id}`).send(body)).status).toBe(409);

    const other = (await request(a).post('/api/schedule').send(body)).body.meeting.id;
    await request(a).post(`/api/schedule/${other}/cancel`).send({});
    const refused = await request(a).post('/api/meetings/draft').field('attendees', 'Priya').field('scheduledMeetingId', other).attach('audio', wav('refused'), 'm.wav');
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/cancelled/);
  });
});

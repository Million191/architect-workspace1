import { createHmac } from 'crypto';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMeetingBotService } from '../services/meetingBot/meetingBotService';
import { createDemoBotClient } from '../services/meetingBot/demoBotClient';
import { BotSession } from '../services/meetingBot/types';

const SECRET = 'whsec_' + Buffer.from('route-test-signing-key-0123456789').toString('base64');
function signed(body: string, secret = SECRET) {
  const id = 'msg_' + Math.random().toString(36).slice(2), ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}

function setup(opts: { configured?: boolean; secret?: string } = {}) {
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const pipeline = createMeetingPipeline(createDemoProviders(), createPipelineStores());
  const store = new Map<string, BotSession>();
  const bots = createMeetingBotService({ store, client: opts.configured === false ? undefined : createDemoBotClient(), pipeline, schedule });
  const settings = new Map<string, string>();
  const app = createApp({ meetingPipeline: pipeline, schedule, bots, settings, botWebhookSecret: opts.secret ?? SECRET });
  const meeting = (link = 'https://teams.microsoft.com/l/meetup-join/abc') => schedule.create({
    title: 'Board call', start: new Date(Date.now() - 5 * 60_000).toISOString(), end: new Date(Date.now() + 55 * 60_000).toISOString(), link, participants: [],
  }).meeting;
  return { app, bots, store, schedule, settings, meeting };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('/api/notetaker', () => {
  it('sends a bot (201), lists the newest per meeting without provider ids, and stops it', async () => {
    const { app, meeting } = setup();
    const m = meeting();
    const sent = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: m.id, consent: true, confirmedBy: 'Million' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ scheduledMeetingId: m.id, platform: 'teams', status: 'joining', automatic: false, recorded: false, canRetry: false });
    expect(sent.body.providerBotId).toBeUndefined();
    expect(JSON.stringify(sent.body)).not.toMatch(/demo-bot-/);

    const again = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: m.id, consent: true });
    expect(again.body.id).toBe(sent.body.id); // idempotent

    const list = await request(app).get(`/api/notetaker/sessions?meetingIds=${m.id}`);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.active).toBe(true);

    const stopped = await request(app).post(`/api/notetaker/sessions/${sent.body.id}/stop`).send({});
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('cancelled');
  });

  it('validates input: consent is required, ids are checked, unknown fields are refused', async () => {
    const { app, meeting } = setup();
    const m = meeting();
    for (const body of [{ scheduledMeetingId: m.id }, { scheduledMeetingId: m.id, consent: false }, { scheduledMeetingId: 'nope', consent: true }, { scheduledMeetingId: m.id, consent: true, extra: 1 }, { scheduledMeetingId: m.id, consent: true, confirmedBy: '<script>' }]) {
      expect((await request(app).post('/api/notetaker/sessions').send(body)).status).toBe(400);
    }
    expect((await request(app).post('/api/notetaker/sessions/not-a-uuid/stop').send({})).status).toBe(400);
    expect((await request(app).post('/api/notetaker/sessions/7d8f1c2e-0000-4000-8000-000000000000/stop').send({})).status).toBe(404);
    expect((await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: '7d8f1c2e-0000-4000-8000-000000000000', consent: true })).status).toBe(404);
  });

  it('explains what is wrong: no meeting link (400), retry on a session that did not fail (409), not configured (503)', async () => {
    const { app, meeting } = setup();
    const noLink = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: meeting('https://example.com/x').id, consent: true });
    expect(noLink.status).toBe(400);
    expect(noLink.body.message).toMatch(/Zoom, Microsoft Teams and Google Meet/);
    const sent = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: meeting().id, consent: true });
    expect((await request(app).post(`/api/notetaker/sessions/${sent.body.id}/retry`).send({})).status).toBe(409);

    const off = setup({ configured: false });
    const r = await request(off.app).post('/api/notetaker/sessions').send({ scheduledMeetingId: off.meeting().id, consent: true });
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/RECALL_API_KEY/);
    expect((await request(off.app).get('/api/notetaker/status')).body).toEqual({ configured: false, provider: null, settings: { autoSendToSynced: false } });
  });

  it('automatic sending can only be turned on with consent', async () => {
    const { app } = setup();
    expect((await request(app).put('/api/notetaker/settings').send({ autoSendToSynced: true })).status).toBe(400);
    const on = await request(app).put('/api/notetaker/settings').send({ autoSendToSynced: true, consent: true, confirmedBy: 'Million' });
    expect(on.body).toEqual({ autoSendToSynced: true });
    expect((await request(app).get('/api/notetaker/status')).body).toMatchObject({ configured: true, provider: 'demo', settings: { autoSendToSynced: true } });
    expect((await request(app).put('/api/notetaker/settings').send({ autoSendToSynced: false })).body).toEqual({ autoSendToSynced: false });
  });
});

describe('POST /api/notetaker/webhook', () => {
  const event = (botId: string, sessionId: string, code: string) => JSON.stringify({ event: `bot.${code}`, data: { data: { code, sub_code: null }, bot: { id: botId, metadata: { session_id: sessionId } } } });

  it('applies a correctly signed status event', async () => {
    const { app, meeting, store } = setup();
    const sent = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: meeting().id, consent: true });
    const botId = store.get(sent.body.id)!.providerBotId as string;
    const body = event(botId, sent.body.id, 'in_waiting_room');
    const res = await request(app).post('/api/notetaker/webhook').set(signed(body)).send(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get(sent.body.id)!.status).toBe('waiting_room');
  });

  it('refuses unsigned or badly signed requests (401) and changes nothing', async () => {
    const { app, meeting, store } = setup();
    const sent = await request(app).post('/api/notetaker/sessions').send({ scheduledMeetingId: meeting().id, consent: true });
    const body = event(store.get(sent.body.id)!.providerBotId as string, sent.body.id, 'fatal');
    expect((await request(app).post('/api/notetaker/webhook').set('content-type', 'application/json').send(body)).status).toBe(401);
    expect((await request(app).post('/api/notetaker/webhook').set(signed(body, 'whsec_' + Buffer.from('wrong').toString('base64'))).send(body)).status).toBe(401);
    expect(store.get(sent.body.id)!.status).toBe('joining');
  });

  it('without RECALL_WEBHOOK_SECRET refuses everything (503); unknown events are acknowledged and ignored', async () => {
    const noSecret = setup({ secret: '' });
    expect((await request(noSecret.app).post('/api/notetaker/webhook').set(signed('{}')).send('{}')).status).toBe(503);
    const { app } = setup();
    const other = JSON.stringify({ event: 'recording.done', data: {} });
    expect((await request(app).post('/api/notetaker/webhook').set(signed(other)).send(other)).body).toEqual({ ignored: true });
    expect((await request(app).post('/api/notetaker/webhook').set(signed('not json')).send('not json')).status).toBe(400);
  });
});

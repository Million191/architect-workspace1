import { createMeetingPipeline, createPipelineStores } from '../meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../meetingPipeline/demoProviders';
import { createScheduleService } from '../schedule/scheduleService';
import { ScheduledMeeting } from '../schedule/types';
import { createMeetingBotService, BotError } from './meetingBotService';
import { applyBotRetention, autoSendDue, readBotSettings, writeBotSettings } from './botAutomation';
import { demoWav } from './demoBotClient';
import { BotProviderClient, BotSession, CreateBotRequest, ProviderBotState } from './types';

const NOW = new Date('2026-10-05T15:00:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

/** A provider whose answers the test controls. */
function fakeClient() {
  const created: CreateBotRequest[] = [];
  const calls: string[] = [];
  const state = new Map<string, ProviderBotState>();
  const files = new Map<string, Buffer>();
  let failCreate: Error | undefined, failDownload: Error | undefined;
  const client: BotProviderClient = {
    name: 'demo',
    async createBot(input) { if (failCreate) throw failCreate; created.push(input); const id = `bot-${created.length}`; state.set(id, { code: 'ready' }); return { providerBotId: id }; },
    async leaveCall(id) { calls.push(`leave:${id}`); },
    async cancelScheduled(id) { calls.push(`cancel:${id}`); },
    async getBot(id) { calls.push(`get:${id}`); return state.get(id) ?? { code: 'unknown' }; },
    async download(url) { if (failDownload) throw failDownload; const f = files.get(url); if (!f) throw new Error('missing'); return f; },
    async deleteMedia(id) { calls.push(`delete_media:${id}`); },
  };
  return {
    client, created, calls, state, files,
    failCreate: (e?: Error) => { failCreate = e; },
    failDownload: (e?: Error) => { failDownload = e; },
    /** Makes bot `id` finished with a recording (and optionally a speaker timeline). */
    finish(id: string, timeline?: unknown) {
      files.set(`https://files/${id}.wav`, demoWav(id));
      if (timeline) files.set(`https://files/${id}.json`, Buffer.from(JSON.stringify(timeline)));
      state.set(id, { code: 'done', audioUrl: `https://files/${id}.wav`, speakerTimelineUrl: timeline ? `https://files/${id}.json` : undefined });
    },
  };
}

function setup(opts: { configured?: boolean } = {}) {
  const fake = fakeClient();
  const scheduleStore = new Map<string, ScheduledMeeting>();
  const schedule = createScheduleService({ store: scheduleStore, now: () => NOW });
  const pipeline = createMeetingPipeline(createDemoProviders(), createPipelineStores());
  const store = new Map<string, BotSession>();
  const bots = createMeetingBotService({ store, client: opts.configured === false ? undefined : fake.client, pipeline, schedule, now: () => NOW });
  const meeting = (over: Partial<{ start: string; end: string; link: string; title: string }> = {}) => schedule.create({
    title: over.title ?? 'Launch sync', start: over.start ?? at(-5), end: over.end ?? at(55), link: over.link ?? 'https://zoom.us/j/123',
    participants: [{ name: 'Alice', email: 'alice@x.io' }, { name: 'Bob', email: 'bob@x.io' }],
  }).meeting;
  return { fake, schedule, scheduleStore, pipeline, store, bots, meeting };
}
const evt = (s: BotSession, code: string, subCode?: string) => ({ providerBotId: s.providerBotId as string, sessionId: s.id, code, subCode });

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sending the notetaker', () => {
  it('joins a meeting under way right away, as "Meeting Assistant Notetaker", announcing the recording in chat', async () => {
    const { bots, fake, meeting } = setup();
    const m = meeting();
    const s = await bots.send({ scheduledMeetingId: m.id, consent: true, confirmedBy: 'Million' });
    expect(s).toMatchObject({ status: 'joining', platform: 'zoom', providerBotId: 'bot-1', title: 'Launch sync', consent: { confirmedBy: 'Million', automatic: false } });
    expect(fake.created[0]).toMatchObject({ meetingUrl: 'https://zoom.us/j/123', botName: 'Meeting Assistant Notetaker', sessionId: s.id, joinAt: undefined });
    expect(fake.created[0].chatMessage).toMatch(/being recorded/);
  });

  it('schedules the bot for the start time of a future meeting', async () => {
    const { bots, fake, meeting } = setup();
    const s = await bots.send({ scheduledMeetingId: meeting({ start: at(120), end: at(180) }).id, consent: true });
    expect(s).toMatchObject({ status: 'scheduled', joinAt: at(120) });
    expect(fake.created[0].joinAt).toBe(at(120));
  });

  it('is idempotent: sending again returns the same active bot and creates no second one', async () => {
    const { bots, fake, meeting } = setup();
    const m = meeting();
    const a = await bots.send({ scheduledMeetingId: m.id, consent: true });
    const b = await bots.send({ scheduledMeetingId: m.id, consent: true });
    expect(b.id).toBe(a.id);
    expect(fake.created).toHaveLength(1);
  });

  it('refuses without consent, without a Zoom/Teams/Meet link, for cancelled, ended or recorded meetings, and when not configured', async () => {
    const { bots, schedule, meeting } = setup();
    await expect(bots.send({ scheduledMeetingId: meeting().id, consent: false })).rejects.toThrow(/knows it is being recorded/);
    await expect(bots.send({ scheduledMeetingId: meeting({ link: 'https://example.com/room' }).id, consent: true })).rejects.toThrow(/Zoom, Microsoft Teams and Google Meet/);
    const cancelled = meeting(); schedule.cancel(cancelled.id);
    await expect(bots.send({ scheduledMeetingId: cancelled.id, consent: true })).rejects.toThrow(/cancelled/);
    await expect(bots.send({ scheduledMeetingId: meeting({ start: at(-90), end: at(-30) }).id, consent: true })).rejects.toThrow(/already ended/);
    const recorded = meeting(); schedule.linkRecording(recorded.id, 'run-x');
    await expect(bots.send({ scheduledMeetingId: recorded.id, consent: true })).rejects.toThrow(/already attached/);
    const off = setup({ configured: false });
    await expect(off.bots.send({ scheduledMeetingId: off.meeting().id, consent: true })).rejects.toMatchObject({ errorClass: 'BotNotConfigured' });
  });

  it('keeps a failed session with the reason when Recall refuses, and allows sending again by hand', async () => {
    const { bots, fake, meeting } = setup();
    const m = meeting();
    fake.failCreate(Object.assign(new Error('Recall.ai refused the request: invalid meeting_url'), { errorClass: 'ValidationError' }));
    await expect(bots.send({ scheduledMeetingId: m.id, consent: true })).rejects.toThrow(/refused/);
    expect(bots.latestFor(m.id)).toMatchObject({ status: 'failed', error: { code: 'ValidationError' } });
    fake.failCreate(undefined);
    expect((await bots.send({ scheduledMeetingId: m.id, consent: true })).status).toBe('joining');
  });
});

describe('following the bot and processing the recording', () => {
  it('walks Joining → Waiting to be admitted → Recording → Processing → Ready, with speaker names on the transcript', async () => {
    const { bots, fake, meeting, schedule, pipeline } = setup();
    const m = meeting();
    let s = await bots.send({ scheduledMeetingId: m.id, consent: true });
    s = (await bots.handleEvent(evt(s, 'joining_call')))!;
    s = (await bots.handleEvent(evt(s, 'in_waiting_room')))!;
    expect(s.status).toBe('waiting_room');
    s = (await bots.handleEvent(evt(s, 'in_call_recording')))!;
    expect(s).toMatchObject({ status: 'recording', recordedAt: NOW.toISOString() });
    s = (await bots.handleEvent(evt(s, 'call_ended', 'call_ended_by_host')))!;
    expect(s.status).toBe('processing');
    fake.finish('bot-1', [{ participant: { name: 'Alice' }, start_timestamp: { relative: 0 }, end_timestamp: { relative: 8 } }, { participant: { name: 'Carol (guest)' }, start_timestamp: { relative: 8 }, end_timestamp: { relative: 60 } }]);
    s = (await bots.handleEvent(evt(s, 'done')))!;
    expect(s).toMatchObject({ status: 'ready', error: undefined });
    expect(s.runId).toBeTruthy();
    expect(s.history.map((h) => h.status)).toEqual(['joining', 'waiting_room', 'recording', 'processing', 'ready']);
    expect(schedule.get(m.id).runId).toBe(s.runId);
    const run = pipeline.getRun(s.runId as string);
    expect(run.minutes.meetingSummary.title).toBe('Launch sync');
    expect(run.transcript[0].speakerLabel).toBe('Alice');
    expect(run.transcript[1].speakerLabel).toBe('Carol (guest)'); // a guest not on the invite keeps their name
  });

  it('ignores replays and out-of-order events; never leaves a final state', async () => {
    const { bots, fake, meeting } = setup();
    let s = await bots.send({ scheduledMeetingId: meeting().id, consent: true });
    s = (await bots.handleEvent(evt(s, 'in_call_recording')))!;
    expect((await bots.handleEvent(evt(s, 'in_waiting_room')))!.status).toBe('recording');
    fake.finish('bot-1');
    s = (await bots.handleEvent(evt(s, 'done')))!;
    const runId = s.runId;
    for (const code of ['done', 'in_call_recording', 'fatal', 'call_ended']) expect((await bots.handleEvent(evt(s, code)))!).toMatchObject({ status: 'ready', runId });
    expect(s.history.filter((h) => h.status === 'ready')).toHaveLength(1);
  });

  it('explains failures: not admitted from the waiting room, recording denied, unknown bots', async () => {
    const { bots, meeting } = setup();
    let s = await bots.send({ scheduledMeetingId: meeting().id, consent: true });
    s = (await bots.handleEvent(evt(s, 'in_waiting_room')))!;
    s = (await bots.handleEvent(evt(s, 'call_ended', 'bot_kicked_from_waiting_room')))!;
    expect(s).toMatchObject({ status: 'failed', error: { message: 'The host didn’t admit the notetaker from the waiting room.' } });
    let d = await bots.send({ scheduledMeetingId: meeting({ title: 'Other' }).id, consent: true });
    d = (await bots.handleEvent(evt(d, 'recording_permission_denied')))!;
    expect(d.error?.message).toBe('The host didn’t allow the notetaker to record.');
    expect(await bots.handleEvent({ providerBotId: 'nope', code: 'done' })).toBeUndefined();
  });

  it('Stop recording: a scheduled bot is cancelled; a bot in the waiting room leaves; a recording bot leaves and its recording is processed', async () => {
    const { bots, fake, meeting } = setup();
    const scheduled = await bots.send({ scheduledMeetingId: meeting({ start: at(60), end: at(90) }).id, consent: true });
    expect((await bots.stop(scheduled.id)).status).toBe('cancelled');
    expect(fake.calls).toContain('cancel:bot-1');

    let waiting = await bots.send({ scheduledMeetingId: meeting({ title: 'B' }).id, consent: true });
    waiting = (await bots.handleEvent(evt(waiting, 'in_waiting_room')))!;
    expect((await bots.stop(waiting.id)).status).toBe('cancelled');
    expect(fake.calls).toContain('leave:bot-2');
    expect((await bots.handleEvent(evt(waiting, 'done')))!.status).toBe('cancelled');

    let rec = await bots.send({ scheduledMeetingId: meeting({ title: 'C' }).id, consent: true });
    rec = (await bots.handleEvent(evt(rec, 'in_call_recording')))!;
    rec = await bots.stop(rec.id);
    expect(rec).toMatchObject({ status: 'processing' });
    expect(await bots.stop(rec.id)).toMatchObject({ status: 'processing' }); // idempotent
    fake.finish('bot-3');
    expect((await bots.handleEvent(evt(rec, 'done')))!.status).toBe('ready');
  });

  it('polling finds the same states without webhooks, and recovers a bot left processing by a restart', async () => {
    const { bots, fake, meeting, store } = setup();
    const s = await bots.send({ scheduledMeetingId: meeting().id, consent: true });
    fake.state.set('bot-1', { code: 'in_call_recording' });
    await bots.reconcile();
    expect(bots.get(s.id).status).toBe('recording');
    // Simulate a restart mid-processing: the stored session says processing, nothing is in flight.
    store.set(s.id, { ...bots.get(s.id), status: 'processing' });
    fake.finish('bot-1');
    await bots.reconcile();
    expect(bots.get(s.id).status).toBe('ready');
  });

  it('a processing failure is explained and can be retried', async () => {
    const { bots, fake, meeting } = setup();
    let s = await bots.send({ scheduledMeetingId: meeting().id, consent: true });
    s = (await bots.handleEvent(evt(s, 'in_call_recording')))!;
    fake.finish('bot-1');
    fake.failDownload(Object.assign(new Error('Recall.ai took too long to answer.'), { errorClass: 'TimeoutError' }));
    s = (await bots.handleEvent(evt(s, 'done')))!;
    expect(s).toMatchObject({ status: 'failed', error: { code: 'TimeoutError', message: 'The recording couldn’t be processed: Recall.ai took too long to answer.' } });
    fake.failDownload(undefined);
    expect((await bots.retry(s.id)).status).toBe('ready');
    await expect(bots.retry(s.id)).rejects.toBeInstanceOf(BotError);
  });

  it('a bot that left before recording anything fails with the reason instead of producing empty minutes', async () => {
    const { bots, fake, meeting } = setup();
    let s = await bots.send({ scheduledMeetingId: meeting().id, consent: true });
    fake.state.set('bot-1', { code: 'done', subCode: 'timeout_exceeded_noone_joined' });
    s = (await bots.handleEvent(evt(s, 'done', 'timeout_exceeded_noone_joined')))!;
    expect(s).toMatchObject({ status: 'failed', error: { message: 'Nobody joined the meeting, so the notetaker left.' } });
  });
});

describe('automatic sending and retention', () => {
  const synced = (s: ReturnType<typeof setup>, over: { start: string; end: string; link?: string; eventId: string }) => {
    s.schedule.upsertExternal({ title: 'Synced ' + over.eventId, start: over.start, end: over.end, link: over.link ?? 'https://meet.google.com/abc-defg-hij', participants: [] },
      { provider: 'google', calendarId: 'primary', eventId: over.eventId }, false);
    return s.schedule.listExternal('google').find((m) => m.external?.eventId === over.eventId) as ScheduledMeeting;
  };

  it('sends once to synced meetings starting within 10 minutes; needs the setting with consent; never re-sends after a stop', async () => {
    const s = setup();
    const soon = synced(s, { start: at(8), end: at(38), eventId: 'e1' });
    synced(s, { start: at(30), end: at(60), eventId: 'later' });
    synced(s, { start: at(5), end: at(30), eventId: 'nolink', link: 'https://example.com' });
    s.meeting({ start: at(5), end: at(30) }); // not synced
    const settings = new Map<string, string>();
    expect(await autoSendDue({ bots: s.bots, schedule: s.schedule, settings, now: () => NOW })).toEqual([]);

    writeBotSettings(settings, { autoSendToSynced: true, consent: true, confirmedBy: 'Million' }, NOW);
    expect(readBotSettings(settings)).toMatchObject({ autoSendToSynced: true, autoConsent: { confirmedBy: 'Million' } });
    const sent = await autoSendDue({ bots: s.bots, schedule: s.schedule, settings, now: () => NOW });
    expect(sent.map((b) => b.scheduledMeetingId)).toEqual([soon.id]);
    expect(sent[0]).toMatchObject({ platform: 'meet', status: 'scheduled', consent: { automatic: true, confirmedBy: 'Million' } });

    await s.bots.stop(sent[0].id);
    expect(await autoSendDue({ bots: s.bots, schedule: s.schedule, settings, now: () => NOW })).toEqual([]);
    expect(s.fake.created).toHaveLength(1);
  });

  it('a settings value without consent is treated as off', () => {
    const settings = new Map([['notetaker', JSON.stringify({ autoSendToSynced: true })]]);
    expect(readBotSettings(settings).autoSendToSynced).toBe(false);
    expect(readBotSettings(new Map([['notetaker', '{bad json']])).autoSendToSynced).toBe(false);
  });

  it('deletes Recall’s copy once the minutes are approved (after_approval), once only; keep never deletes', async () => {
    const s = setup();
    let b = await s.bots.send({ scheduledMeetingId: s.meeting().id, consent: true });
    b = (await s.bots.handleEvent(evt(b, 'in_call_recording')))!;
    s.fake.finish('bot-1');
    b = (await s.bots.handleEvent(evt(b, 'done')))!;
    expect(await applyBotRetention(s.bots, 'keep', () => true, NOW)).toEqual([]);
    expect(await applyBotRetention(s.bots, 'after_approval', () => false, NOW)).toEqual([]);
    expect(await applyBotRetention(s.bots, 'after_approval', (runId) => runId === b.runId, NOW)).toEqual([b.id]);
    expect(await applyBotRetention(s.bots, 'after_approval', () => true, NOW)).toEqual([]);
    expect(s.fake.calls.filter((c) => c.startsWith('delete_media'))).toEqual(['delete_media:bot-1']);
  });
});

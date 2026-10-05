import { FetchLike } from '../calendarSync/http';
import { BotApiError, createRecallClient, parseBot, recallConfigFromEnv } from './recallClient';

type Call = { url: string; method?: string; headers?: Record<string, string>; body?: string };
function res(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(text), text: async () => text,
    arrayBuffer: async () => new Uint8Array(Buffer.from(text)).buffer,
  };
}
function fakeFetch(answers: Array<ReturnType<typeof res> | Error>) {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const a = answers.shift();
    if (!a) throw new Error('no more answers');
    if (a instanceof Error) throw a;
    return a;
  };
  return { impl, calls };
}
const config = { apiKey: 'secret-key', region: 'us-east-1' as const };
const noSleep = async () => undefined;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('recall client', () => {
  it('creates a bot named "Meeting Assistant Notetaker" with a chat announcement, the join time and our session id', async () => {
    const f = fakeFetch([res(201, { id: 'bot-1' })]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    expect(await c.createBot({ meetingUrl: 'https://zoom.us/j/1', botName: 'Meeting Assistant Notetaker', joinAt: '2026-10-05T15:00:00.000Z', chatMessage: 'Recording', sessionId: 's-1' })).toEqual({ providerBotId: 'bot-1' });
    expect(f.calls[0].url).toBe('https://us-east-1.recall.ai/api/v1/bot/');
    expect(f.calls[0].headers?.Authorization).toBe('Token secret-key');
    expect(JSON.parse(f.calls[0].body as string)).toEqual({
      meeting_url: 'https://zoom.us/j/1', bot_name: 'Meeting Assistant Notetaker', join_at: '2026-10-05T15:00:00.000Z',
      recording_config: { audio_mixed_mp3: {} }, chat: { on_bot_join: { send_to: 'everyone', message: 'Recording' } }, metadata: { session_id: 's-1' },
    });
  });

  it('retries 503 and 429 with capped attempts, then succeeds', async () => {
    const f = fakeFetch([res(503), res(429), res(200)]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    await c.leaveCall('bot-1');
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0].url).toBe('https://us-east-1.recall.ai/api/v1/bot/bot-1/leave_call/');
  });

  it('gives up after 3 attempts with a readable error', async () => {
    const f = fakeFetch([res(502), res(502), res(502)]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    await expect(c.getBot('b')).rejects.toMatchObject({ errorClass: 'UpstreamUnavailable' });
    expect(f.calls).toHaveLength(3);
  });

  it('does not retry refusals: 400 → ValidationError, 401 → AuthError naming the env vars', async () => {
    const f = fakeFetch([res(400, { meeting_url: ['invalid'] }), res(401)]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    await expect(c.createBot({ meetingUrl: 'x', botName: 'n', chatMessage: 'm', sessionId: 's' })).rejects.toMatchObject({ errorClass: 'ValidationError' });
    await expect(c.getBot('b')).rejects.toThrow(/RECALL_API_KEY/);
    expect(f.calls).toHaveLength(2);
  });

  it('treats a hung request as a timeout and retries it', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const f = fakeFetch([abort, abort, abort]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    await expect(c.getBot('b')).rejects.toMatchObject({ errorClass: 'TimeoutError' });
  });

  it('opens the circuit after 5 failed operations and stops calling Recall; refusals never trip it', async () => {
    let t = 0;
    const f = fakeFetch([...Array(3).fill(res(400)), ...Array(15).fill(res(503))]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep, clock: () => t });
    for (let i = 0; i < 3; i++) await expect(c.getBot('b')).rejects.toMatchObject({ errorClass: 'ValidationError' });
    for (let i = 0; i < 5; i++) await expect(c.getBot('b')).rejects.toMatchObject({ errorClass: 'UpstreamUnavailable' });
    const before = f.calls.length;
    await expect(c.getBot('b')).rejects.toMatchObject({ errorClass: 'CircuitOpenError' });
    expect(f.calls.length).toBe(before);
    t = 61_000; // after the cool-down one probe goes through
    f.calls.length = 0;
    await expect(c.getBot('b')).rejects.toBeInstanceOf(BotApiError);
    expect(f.calls.length).toBeGreaterThan(0);
  });

  it('downloads recordings without the API key, https only, size-capped', async () => {
    const f = fakeFetch([res(200, 'AUDIO'), res(200, 'x'.repeat(50), { 'content-length': '50' })]);
    const c = createRecallClient(config, { fetchImpl: f.impl, sleep: noSleep });
    expect((await c.download('https://storage.example/a.mp3?sig=1', 100)).toString()).toBe('AUDIO');
    expect(f.calls[0].headers?.Authorization).toBeUndefined();
    await expect(c.download('https://storage.example/b.mp3', 10)).rejects.toMatchObject({ errorClass: 'PayloadTooLarge' });
    await expect(c.download('http://insecure.example/c.mp3', 10)).rejects.toMatchObject({ errorClass: 'ContractViolation' });
  });
});

describe('parseBot', () => {
  it('reads the latest status and the audio / speaker-timeline links', () => {
    expect(parseBot({
      id: 'b', status_changes: [{ code: 'in_call_recording' }, { code: 'done', sub_code: null }],
      recordings: [{ media_shortcuts: { audio_mixed: { data: { download_url: 'https://s/a.mp3' } }, participant_events: { data: { speaker_timeline_download_url: 'https://s/t.json' } } } }],
    })).toEqual({ code: 'done', subCode: undefined, audioUrl: 'https://s/a.mp3', speakerTimelineUrl: 'https://s/t.json' });
  });

  it('falls back to the mixed video when there is no audio-only file; tolerates missing parts', () => {
    expect(parseBot({ status_changes: [{ code: 'done' }], recordings: [{ media_shortcuts: { video_mixed: { data: { download_url: 'https://s/v.mp4' } } } }] }).audioUrl).toBe('https://s/v.mp4');
    expect(parseBot({ status_changes: [{ code: 'joining_call' }] })).toEqual({ code: 'joining_call', subCode: undefined, audioUrl: undefined, speakerTimelineUrl: undefined });
    expect(() => parseBot({})).toThrow(BotApiError);
  });
});

describe('recallConfigFromEnv', () => {
  it('is off without a key, defaults the region, and rejects unknown regions', () => {
    expect(recallConfigFromEnv({})).toBeUndefined();
    expect(recallConfigFromEnv({ RECALL_API_KEY: 'k' })).toEqual({ apiKey: 'k', region: 'us-east-1' });
    expect(() => recallConfigFromEnv({ RECALL_API_KEY: 'k', RECALL_REGION: 'mars-1' })).toThrow(/RECALL_REGION/);
  });
});

import { CircuitBreaker } from '../audioIngestion/circuitBreaker';
import { FetchLike } from '../calendarSync/http';
import { BotProviderClient, CreateBotRequest, ProviderBotState } from './types';

/**
 * Recall.ai meeting-bot API (https://docs.recall.ai). The API key comes from RECALL_API_KEY on the
 * server and is never logged or sent to the browser; download links (pre-signed storage URLs) are
 * fetched WITHOUT the key and never logged.
 *
 * Failure handling, per call:
 * - 15 s timeout (downloads: 10 min), at most 3 attempts with 0.5 s / 1 s backoff on 429, 5xx and
 *   network errors; 4xx answers fail at once with a readable message.
 * - A circuit breaker opens after 5 failed operations in a row and rejects calls for 60 s, so a Recall
 *   outage doesn't make every page refresh wait for timeouts.
 * - Not handled here: webhooks that never arrive (the bot service polls as a fallback).
 */
export class BotApiError extends Error {
  constructor(
    readonly errorClass: 'AuthError' | 'RateLimitError' | 'UpstreamUnavailable' | 'TimeoutError' | 'ContractViolation' | 'ValidationError' | 'CircuitOpenError' | 'PayloadTooLarge',
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = errorClass;
  }
}

export const RECALL_REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'] as const;
export type RecallRegion = (typeof RECALL_REGIONS)[number];

export interface RecallConfig {
  apiKey: string;
  region: RecallRegion;
}

/** Reads RECALL_API_KEY / RECALL_REGION. Returns undefined (bot not configured) without a key. */
export function recallConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RecallConfig | undefined {
  const apiKey = env.RECALL_API_KEY?.trim();
  if (!apiKey) return undefined;
  const region = (env.RECALL_REGION?.trim() || 'us-east-1') as RecallRegion;
  if (!RECALL_REGIONS.includes(region)) throw new Error(`RECALL_REGION must be one of ${RECALL_REGIONS.join(', ')}.`);
  return { apiKey, region };
}

const TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

function redact(text: string): string {
  return text.replace(/(token|key|signature|x-amz-[a-z-]+)=?[^\s"&,}]*/gi, '$1=<redacted>').slice(0, 500);
}

interface RawStatusChange { code?: unknown; sub_code?: unknown }
interface RawShortcut { data?: { download_url?: unknown; speaker_timeline_download_url?: unknown } | null }
interface RawBot {
  id?: unknown;
  status_changes?: RawStatusChange[];
  recordings?: Array<{ media_shortcuts?: { audio_mixed?: RawShortcut | null; video_mixed?: RawShortcut | null; participant_events?: RawShortcut | null } | null }>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const httpsUrl = (v: unknown): string | undefined => { const s = str(v); return s && /^https:\/\//i.test(s) ? s : undefined; };

/** Pulls status and download links out of a GET /bot/:id answer; tolerant of missing optional parts. */
export function parseBot(raw: unknown): ProviderBotState {
  const bot = (raw ?? {}) as RawBot;
  if (!Array.isArray(bot.status_changes)) throw new BotApiError('ContractViolation', 'Recall answered without a bot status.');
  const last = bot.status_changes[bot.status_changes.length - 1] ?? {};
  const shortcuts = Array.isArray(bot.recordings) ? bot.recordings[bot.recordings.length - 1]?.media_shortcuts ?? undefined : undefined;
  return {
    code: str(last.code) ?? 'unknown',
    subCode: str(last.sub_code),
    audioUrl: httpsUrl(shortcuts?.audio_mixed?.data?.download_url) ?? httpsUrl(shortcuts?.video_mixed?.data?.download_url),
    speakerTimelineUrl: httpsUrl(shortcuts?.participant_events?.data?.speaker_timeline_download_url),
  };
}

export function createRecallClient(config: RecallConfig, opts: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; clock?: () => number } = {}): BotProviderClient {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `https://${config.region}.recall.ai/api/v1`;
  const breaker = new CircuitBreaker({
    failureThreshold: 5, cooldownMs: 60_000, operationName: 'recall', clock: opts.clock,
    onStateChange: (from, to) => console.log(JSON.stringify({ event: 'recall_circuit_state', from, to, outcome: to === 'open' ? 'failure' : 'success' })),
  });

  /** One operation = up to 3 attempts; the breaker counts the operation once, and only upstream trouble counts. */
  async function request(label: string, url: string, init: { method: string; body?: unknown; auth: boolean; timeoutMs?: number }) {
    try {
      const outcome = await breaker.execute(async () => {
        try {
          return { res: await attempts(label, url, init) };
        } catch (error) {
          // A refused request (bad link, wrong key) is our problem, not an outage: don't trip the breaker.
          if (error instanceof BotApiError && ['ValidationError', 'AuthError', 'ContractViolation'].includes(error.errorClass)) return { error };
          throw error;
        }
      });
      if ('error' in outcome) throw outcome.error;
      return outcome.res;
    } catch (error) {
      if ((error as { errorClass?: string }).errorClass === 'CircuitOpenError') {
        throw new BotApiError('CircuitOpenError', 'Recall.ai isn’t responding right now, so the notetaker is paused. Try again in a minute.');
      }
      throw error;
    }
  }

  async function attempts(label: string, url: string, init: { method: string; body?: unknown; auth: boolean; timeoutMs?: number }) {
    let lastError: BotApiError | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (init.auth) headers.Authorization = `Token ${config.apiKey}`;
        if (init.body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: ctrl.signal });
        const duration_ms = Date.now() - started;
        if (res.ok) {
          console.log(JSON.stringify({ event: 'recall_api_call', target: label, status: res.status, duration_ms, attempt, outcome: 'success' }));
          return res;
        }
        const body = redact(await res.text().catch(() => ''));
        console.error(JSON.stringify({ event: 'recall_api_call', target: label, status: res.status, duration_ms, attempt, outcome: 'failure', body }));
        if (res.status === 401 || res.status === 403) throw new BotApiError('AuthError', 'Recall.ai didn’t accept the API key. Check RECALL_API_KEY and RECALL_REGION on the server.', res.status);
        if (res.status === 429) lastError = new BotApiError('RateLimitError', 'Recall.ai is rate-limiting requests. Try again in a minute.', 429);
        else if (res.status >= 500) lastError = new BotApiError('UpstreamUnavailable', 'Recall.ai isn’t responding right now. Try again soon.', res.status);
        else if (res.status === 400) throw new BotApiError('ValidationError', `Recall.ai refused the request: ${body || 'bad request'}`, 400);
        else throw new BotApiError('ContractViolation', `Recall.ai answered ${res.status} to ${label}.`, res.status);
      } catch (error) {
        if (error instanceof BotApiError && error.errorClass !== 'RateLimitError' && error.errorClass !== 'UpstreamUnavailable') throw error;
        if (!(error instanceof BotApiError)) {
          const timedOut = (error as Error).name === 'AbortError';
          lastError = new BotApiError(timedOut ? 'TimeoutError' : 'UpstreamUnavailable', timedOut ? 'Recall.ai took too long to answer.' : 'Couldn’t reach Recall.ai. Check the server’s internet connection.');
          console.error(JSON.stringify({ event: 'recall_api_call', target: label, duration_ms: Date.now() - started, attempt, outcome: 'failure', error_class: lastError.errorClass }));
        } else {
          lastError = error;
        }
      } finally {
        clearTimeout(timer);
      }
      if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
    }
    throw lastError as BotApiError;
  }

  const botPath = (id: string) => `${base}/bot/${encodeURIComponent(id)}/`;

  return {
    name: 'recall',

    async createBot(input: CreateBotRequest) {
      const res = await request('recall.create_bot', `${base}/bot/`, {
        method: 'POST', auth: true,
        body: {
          meeting_url: input.meetingUrl,
          bot_name: input.botName,
          ...(input.joinAt ? { join_at: input.joinAt } : {}),
          recording_config: { audio_mixed_mp3: {} },
          chat: { on_bot_join: { send_to: 'everyone', message: input.chatMessage } },
          metadata: { session_id: input.sessionId },
        },
      });
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      const id = str(body.id);
      if (!id) throw new BotApiError('ContractViolation', 'Recall.ai created the bot but didn’t return its id.');
      return { providerBotId: id };
    },

    async leaveCall(id) { await request('recall.leave_call', `${botPath(id)}leave_call/`, { method: 'POST', auth: true }); },
    async cancelScheduled(id) { await request('recall.delete_bot', botPath(id), { method: 'DELETE', auth: true }); },
    async deleteMedia(id) { await request('recall.delete_media', `${botPath(id)}delete_media/`, { method: 'POST', auth: true }); },

    async getBot(id) {
      const res = await request('recall.get_bot', botPath(id), { method: 'GET', auth: true });
      return parseBot(await res.json().catch(() => { throw new BotApiError('ContractViolation', 'Recall.ai answered with something that isn’t JSON.'); }));
    },

    async download(url, maxBytes) {
      if (!/^https:\/\//i.test(url)) throw new BotApiError('ContractViolation', 'The recording link isn’t a secure https link.');
      const res = await request('recall.download', url, { method: 'GET', auth: false, timeoutMs: DOWNLOAD_TIMEOUT_MS });
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new BotApiError('PayloadTooLarge', 'The recording is larger than this server accepts.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new BotApiError('PayloadTooLarge', 'The recording is larger than this server accepts.');
      return buf;
    },
  };
}

/**
 * Outbound calls to Google and Microsoft: explicit timeout, at most 3 attempts with backoff on
 * 429/5xx/network errors, and errors classified so the UI can say what to do. Tokens are never
 * logged; error bodies are logged with any token-looking values redacted.
 */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class CalendarApiError extends Error {
  constructor(
    readonly errorClass: 'AuthError' | 'RateLimitError' | 'UpstreamUnavailable' | 'TimeoutError' | 'ContractViolation' | 'ConfigError',
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;

function redact(text: string): string {
  return text.replace(/("?(access_token|refresh_token|id_token|client_secret|code)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1<redacted>').slice(0, 500);
}

export interface CallOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** For logs only, e.g. "google.events". */
  label: string;
  sleep?: (ms: number) => Promise<void>;
}

export async function callJson<T>(fetchImpl: FetchLike, url: string, opts: CallOptions): Promise<T> {
  const res = await call(fetchImpl, url, opts);
  try {
    return (await res.json()) as T;
  } catch {
    throw new CalendarApiError('ContractViolation', `${opts.label} returned something that isn’t JSON.`);
  }
}

export async function call(fetchImpl: FetchLike, url: string, opts: CallOptions) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: CalendarApiError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: ctrl.signal });
      const duration_ms = Date.now() - started;
      if (res.ok) {
        console.log(JSON.stringify({ event: 'calendar_api_call', target: opts.label, status: res.status, duration_ms, attempt, outcome: 'success' }));
        return res;
      }
      const body = redact(await res.text().catch(() => ''));
      console.error(JSON.stringify({ event: 'calendar_api_call', target: opts.label, status: res.status, duration_ms, attempt, outcome: 'failure', body }));
      if (res.status === 401 || (res.status === 400 && /invalid_grant/.test(body))) throw new CalendarApiError('AuthError', 'The calendar sign-in has expired or was revoked. Reconnect the calendar.', res.status);
      if (res.status === 403) throw new CalendarApiError('AuthError', 'The calendar account didn’t allow this. Reconnect and accept the calendar permission.', res.status);
      if (res.status === 429) lastError = new CalendarApiError('RateLimitError', 'The calendar service is rate-limiting requests. Try again in a few minutes.', 429);
      else if (res.status >= 500) lastError = new CalendarApiError('UpstreamUnavailable', 'The calendar service isn’t responding right now. Try again soon.', res.status);
      else throw new CalendarApiError('ContractViolation', `${opts.label} answered ${res.status}.`, res.status);
    } catch (error) {
      if (error instanceof CalendarApiError && error.errorClass !== 'RateLimitError' && error.errorClass !== 'UpstreamUnavailable') throw error;
      if (!(error instanceof CalendarApiError)) {
        const timedOut = (error as Error).name === 'AbortError';
        lastError = new CalendarApiError(timedOut ? 'TimeoutError' : 'UpstreamUnavailable', timedOut ? 'The calendar service took too long to answer.' : 'Couldn’t reach the calendar service. Check the connection.');
        console.error(JSON.stringify({ event: 'calendar_api_call', target: opts.label, duration_ms: Date.now() - started, attempt, outcome: 'failure', error_class: lastError.errorClass }));
      } else {
        lastError = error;
      }
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s
  }
  throw lastError as CalendarApiError;
}

export function form(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

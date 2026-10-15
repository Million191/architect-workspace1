import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { CalendarApiError, FetchLike } from './http';
import { clientFor, OAuthConfig } from './providers';
import { decrypt, encrypt, parseKey, TokenKeyError } from './tokenCrypto';
import { CalendarConnection, CalendarProvider, ExternalEvent, OAuthTokens, PROVIDER_LABEL, PublicConnection, SyncOptions, SyncSummary } from './types';
import { ScheduleService } from '../schedule/scheduleService';
import { PeopleService } from '../people/peopleService';

const WINDOW_BACK_MS = 24 * 3600 * 1000;
const WINDOW_AHEAD_MS = 28 * 24 * 3600 * 1000; // next 4 weeks
const STATE_TTL_MS = 10 * 60 * 1000;
const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
export const DEFAULT_OPTIONS: SyncOptions = { skipAllDay: true, skipSolo: true };

/** What the page says when calendar sync can't run because the server isn't set up (details go to the logs). */
export const NOT_AVAILABLE_MESSAGE = 'Calendar integration isn’t available yet — it needs administrator setup.';

/**
 * A failure as the user should read it: what happened and what to do, never a token, secret, env
 * variable or raw provider error. `action` tells the page which button to offer.
 */
export function friendlyError(provider: CalendarProvider, errorClass: string): { message: string; action: 'reconnect' | 'retry' } {
  const name = PROVIDER_LABEL[provider];
  switch (errorClass) {
    case 'AuthError': return { message: `Your ${name} sign-in has expired or was removed. Reconnect to keep syncing.`, action: 'reconnect' };
    case 'TokenKeyError':
    case 'NotConfigured': return { message: NOT_AVAILABLE_MESSAGE, action: 'retry' };
    case 'RateLimitError': return { message: `${name} is busy right now. Try again in a few minutes.`, action: 'retry' };
    case 'UpstreamUnavailable':
    case 'TimeoutError': return { message: `${name} didn’t respond. Check the connection and try again.`, action: 'retry' };
    default: return { message: `Calendar sync failed. Try again.`, action: 'retry' };
  }
}

/** Server-side: which settings are missing (names only, never values) — for the startup log. */
export function missingSetup(config: OAuthConfig, encryptionKey?: string): string[] {
  const missing: string[] = [];
  try { parseKey(encryptionKey); } catch { missing.push('TOKEN_ENCRYPTION_KEY'); }
  if (!config.google) missing.push('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET');
  if (!config.microsoft) missing.push('MS_CLIENT_ID/MS_CLIENT_SECRET');
  return missing;
}

export class CalendarSyncError extends Error {
  constructor(readonly errorClass: 'NotConfigured' | 'NotConnected' | 'InvalidState' | 'ValidationError', message: string) {
    super(message);
  }
}

export interface CalendarSyncDeps {
  /** Connections by provider (a JsonFileMap in real mode). Tokens inside are encrypted. */
  store: Map<string, CalendarConnection>;
  config: OAuthConfig;
  /** Raw TOKEN_ENCRYPTION_KEY (base64). Missing/invalid → sync is "not set up", never insecure. */
  encryptionKey?: string;
  fetchImpl: FetchLike;
  schedule?: ScheduleService;
  people?: PeopleService;
  /** Folder for attendee photos fetched from Outlook (served by /api/people/photos/:file). */
  photoDir?: string;
  now?: () => Date;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
function stripHtml(text?: string): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return plain ? plain.slice(0, 5000) : undefined;
}

export function createCalendarSyncService(deps: CalendarSyncDeps) {
  const now = deps.now ?? (() => new Date());
  const pending = new Map<string, { provider: CalendarProvider; verifier: string; at: number }>();
  const inFlight = new Map<CalendarProvider, Promise<SyncSummary>>();

  function key(): Buffer {
    return parseKey(deps.encryptionKey);
  }
  function client(provider: CalendarProvider) {
    const c = clientFor(provider, deps.config, deps.fetchImpl);
    if (!c) {
      console.error(JSON.stringify({ event: 'calendar_not_configured', provider, missing: provider === 'google' ? 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' : 'MS_CLIENT_ID/MS_CLIENT_SECRET', outcome: 'failure' }));
      throw new CalendarSyncError('NotConfigured', NOT_AVAILABLE_MESSAGE);
    }
    return c;
  }
  function connection(provider: CalendarProvider): CalendarConnection {
    const c = deps.store.get(provider);
    if (!c) throw new CalendarSyncError('NotConnected', `${PROVIDER_LABEL[provider]} isn’t connected.`);
    return c;
  }
  /** What the page may see: no tokens, and errors in plain words (the raw details stay in the logs). */
  function toPublic(c: CalendarConnection): PublicConnection {
    const { sealedTokens: _t, ...rest } = c;
    if (!rest.lastError) return rest;
    const f = friendlyError(c.provider, rest.lastError.errorClass);
    return { ...rest, lastError: { errorClass: rest.lastError.errorClass, at: rest.lastError.at, message: f.message, needsReconnect: f.action === 'reconnect' } };
  }
  function save(c: CalendarConnection): void {
    deps.store.set(c.provider, c);
  }

  /** Fresh tokens for a call; refreshes (and re-seals) them when they are about to expire. */
  async function tokensFor(c: CalendarConnection): Promise<OAuthTokens> {
    const t = JSON.parse(decrypt(c.sealedTokens, key())) as OAuthTokens;
    if (t.expiresAt > now().getTime()) return t;
    const fresh = await client(c.provider).refresh(t);
    save({ ...connection(c.provider), sealedTokens: encrypt(JSON.stringify(fresh), key()) });
    return fresh;
  }

  async function savePhoto(provider: CalendarProvider, tokens: OAuthTokens, email: string): Promise<string | undefined> {
    const c = client(provider);
    if (!c.photo || !deps.photoDir) return undefined;
    const file = `${createHash('sha1').update(email.toLowerCase()).digest('hex')}.jpg`;
    const full = path.join(deps.photoDir, file);
    const fresh = existsSync(full) && now().getTime() - statSync(full).mtimeMs < 24 * 3600 * 1000;
    if (!fresh) {
      const photo = await c.photo(tokens, email).catch(() => null); // a missing photo never fails a sync
      if (!photo) return existsSync(full) ? `/api/people/photos/${file}` : undefined;
      mkdirSync(deps.photoDir, { recursive: true });
      writeFileSync(full, photo.bytes);
    }
    return `/api/people/photos/${file}`;
  }

  function others(c: CalendarConnection, e: ExternalEvent) {
    const me = c.accountEmail.toLowerCase();
    return e.attendees.filter((a) => !a.self && !a.resource && a.email.toLowerCase() !== me && EMAIL.test(a.email));
  }

  async function syncOne(provider: CalendarProvider): Promise<SyncSummary> {
    const c = connection(provider);
    const summary: SyncSummary = { added: 0, updated: 0, cancelled: 0, unchanged: 0, skipped: 0 };
    try {
      const tokens = await tokensFor(c);
      const api = client(provider);
      const from = new Date(now().getTime() - WINDOW_BACK_MS), to = new Date(now().getTime() + WINDOW_AHEAD_MS);
      const photos = new Map<string, string | undefined>();
      for (const calendarId of c.selectedCalendarIds) {
        const events = await api.events(tokens, calendarId, from, to);
        const returned = new Set(events.map((e) => e.id)), kept = new Set<string>();
        for (const e of events) {
          const people = others(c, e);
          // All-day events (holidays, out of office) have no meeting time, so they are never imported;
          // events with nobody else invited are skipped unless the user turns that filter off.
          if (e.allDay || (c.options.skipSolo && !people.length && !e.cancelled)) { summary.skipped++; continue; }
          kept.add(e.id);
          const participants = e.attendees.filter((a) => !a.resource && EMAIL.test(a.email)).map((a) => ({ email: a.email, name: a.name && a.name !== a.email ? a.name.replace(/[<>\r\n]/g, '') : undefined }));
          // The organizer is a participant too (Google may leave them out of the attendee list).
          const org = e.attendees.find((a) => a.organizer && EMAIL.test(a.email));
          if (org && !participants.some((p) => p.email.toLowerCase() === org.email.toLowerCase())) participants.unshift({ email: org.email, name: org.name && org.name !== org.email ? org.name.replace(/[<>\r\n]/g, '') : undefined });
          const organizer = org ? { email: org.email, ...(org.name && org.name !== org.email ? { name: org.name.replace(/[<>\r\n]/g, '') } : {}) } : undefined;
          const result = deps.schedule?.upsertExternal(
            { title: e.title.slice(0, 200), start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), participants, link: e.link, agenda: stripHtml(e.description), organizer },
            { provider, calendarId, eventId: e.id, updated: e.updated }, e.cancelled) ?? 'unchanged';
          summary[result]++;
          if (deps.people && !e.cancelled) {
            for (const p of people) {
              if (!photos.has(p.email.toLowerCase()) && photos.size < 50) photos.set(p.email.toLowerCase(), await savePhoto(provider, tokens, p.email));
              deps.people.observe([{ email: p.email, name: p.name, avatarUrl: photos.get(p.email.toLowerCase()), origin: 'calendar' }]);
            }
          }
        }
        // Meetings synced earlier that the calendar no longer returns were deleted there: show them as cancelled.
        // Ones it still returns but the filters now skip are simply removed.
        for (const m of deps.schedule?.listExternal(provider, calendarId) ?? []) {
          const ref = m.external!;
          if (kept.has(ref.eventId) || !m.start || Date.parse(m.start) < from.getTime() || Date.parse(m.start) > to.getTime()) continue;
          if (returned.has(ref.eventId)) { deps.schedule!.removeExternal(provider, (x) => x.id !== m.id); continue; }
          const r = deps.schedule!.upsertExternal({ title: m.title, start: m.start, end: m.end as string, participants: m.participants, link: m.link, agenda: m.agenda }, ref, true);
          if (r === 'cancelled') summary.cancelled++;
        }
      }
      save({ ...connection(provider), lastSyncedAt: now().toISOString(), lastSyncSummary: summary, lastError: undefined });
      return summary;
    } catch (error) {
      const e = error as Error & { errorClass?: string };
      const errorClass = e instanceof TokenKeyError ? 'TokenKeyError' : e.errorClass ?? 'Error';
      console.error(JSON.stringify({ event: 'calendar_sync_failed', provider, error_class: errorClass, outcome: 'failure' }));
      save({ ...connection(provider), lastError: { errorClass, message: e.message, at: now().toISOString(), needsReconnect: errorClass === 'AuthError' } });
      throw error;
    }
  }

  return {
    /** For the page: which calendars can be connected, and the connections (no tokens, no setup details). */
    status() {
      let encryption = true;
      try { key(); } catch { encryption = false; }
      const providers = (['google', 'microsoft'] as CalendarProvider[]).map((p) => ({
        provider: p, label: PROVIDER_LABEL[p], configured: !!clientFor(p, deps.config, deps.fetchImpl) && encryption,
        connection: deps.store.get(p) ? toPublic(deps.store.get(p) as CalendarConnection) : undefined,
      }));
      return { providers, available: providers.some((p) => p.configured) };
    },

    /** Start of the OAuth flow: a one-time state + PKCE verifier kept server-side for 10 minutes. */
    beginAuth(provider: CalendarProvider): string {
      key(); // refuse to start if tokens couldn't be stored safely
      const api = client(provider);
      const t = now().getTime();
      for (const [s, v] of pending) if (t - v.at > STATE_TTL_MS) pending.delete(s);
      const state = randomBytes(24).toString('base64url');
      const { verifier, challenge } = pkce();
      pending.set(state, { provider, verifier, at: t });
      return api.authUrl(state, challenge);
    },

    /** OAuth callback: checks the state, exchanges the code, stores encrypted tokens, runs a first sync. */
    async completeAuth(provider: CalendarProvider, code: string, state: string): Promise<PublicConnection> {
      const p = pending.get(state);
      pending.delete(state); // one use only
      if (!p || p.provider !== provider || now().getTime() - p.at > STATE_TTL_MS) throw new CalendarSyncError('InvalidState', 'That sign-in link expired or was already used. Start “Connect” again.');
      const api = client(provider);
      const tokens = await api.exchangeCode(code, p.verifier);
      const account = await api.account(tokens);
      const calendars = await api.calendars(tokens);
      const previous = deps.store.get(provider);
      const primary = calendars.find((c) => c.primary) ?? calendars[0];
      const keepSelection = previous && previous.accountEmail.toLowerCase() === account.email.toLowerCase() ? previous.selectedCalendarIds.filter((id) => calendars.some((c) => c.id === id)) : [];
      const conn: CalendarConnection = {
        provider, accountEmail: account.email, accountName: account.name, calendars,
        selectedCalendarIds: keepSelection.length ? keepSelection : primary ? [primary.id] : [],
        options: previous?.options ?? DEFAULT_OPTIONS, sealedTokens: encrypt(JSON.stringify(tokens), key()), connectedAt: now().toISOString(),
        lastSyncedAt: previous?.lastSyncedAt,
      };
      save(conn);
      await syncOne(provider).catch(() => undefined); // the error is recorded on the connection and shown in Settings
      return toPublic(connection(provider));
    },

    /** Which calendars to sync and the filters. Deselected calendars' meetings are removed (recorded ones stay). */
    async updateSettings(provider: CalendarProvider, patch: { selectedCalendarIds?: string[]; options?: Partial<SyncOptions> }): Promise<PublicConnection> {
      const c = connection(provider);
      const ids = patch.selectedCalendarIds ?? c.selectedCalendarIds;
      const unknown = ids.filter((id) => !c.calendars.some((cal) => cal.id === id));
      if (unknown.length) throw new CalendarSyncError('ValidationError', 'Choose calendars from the list.');
      const dropped = c.selectedCalendarIds.filter((id) => !ids.includes(id));
      for (const id of dropped) deps.schedule?.removeExternal(provider, (m) => m.external?.calendarId !== id);
      save({ ...c, selectedCalendarIds: [...new Set(ids)], options: { ...c.options, ...patch.options } });
      await syncOne(provider).catch(() => undefined);
      return toPublic(connection(provider));
    },

    /** Syncs one or all connected providers. Concurrent calls for the same provider share one run. */
    async sync(provider?: CalendarProvider): Promise<Record<string, SyncSummary | { error: string; errorClass: string; needsReconnect?: boolean }>> {
      const targets = provider ? [provider] : ([...deps.store.keys()] as CalendarProvider[]);
      const out: Record<string, SyncSummary | { error: string; errorClass: string; needsReconnect?: boolean }> = {};
      for (const p of targets) {
        connection(p);
        let run = inFlight.get(p);
        if (!run) { run = syncOne(p).finally(() => inFlight.delete(p)); inFlight.set(p, run); }
        try { out[p] = await run; } catch (e) {
          const err = deps.store.get(p)?.lastError;
          const f = friendlyError(p, err?.errorClass ?? (e as { errorClass?: string }).errorClass ?? 'Error');
          out[p] = { error: f.message, errorClass: err?.errorClass ?? 'Error', needsReconnect: f.action === 'reconnect' };
        }
      }
      return out;
    },

    /** Disconnect: revoke (best effort), forget the tokens, remove synced meetings without recordings. */
    async disconnect(provider: CalendarProvider): Promise<{ removedMeetings: number }> {
      const c = connection(provider);
      try {
        const api = client(provider);
        if (api.revoke) await api.revoke(JSON.parse(decrypt(c.sealedTokens, key())) as OAuthTokens);
      } catch (error) {
        console.error(JSON.stringify({ event: 'calendar_revoke_failed', provider, error_class: (error as CalendarApiError).errorClass ?? 'Error', outcome: 'failure' }));
      }
      deps.store.delete(provider);
      return { removedMeetings: deps.schedule?.removeExternal(provider) ?? 0 };
    },
  };
}

export type CalendarSyncService = ReturnType<typeof createCalendarSyncService>;

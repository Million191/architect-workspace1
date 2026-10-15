import { randomBytes } from 'crypto';
import request from 'supertest';
import { createApp } from '../server';
import { createCalendarSyncService, friendlyError, missingSetup } from '../services/calendarSync/calendarSyncService';
import { CalendarConnection } from '../services/calendarSync/types';
import { fakeCalendarApis, gEvent } from '../services/calendarSync/__testutils__/fakeCalendarApis';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';

/**
 * Calendar integration end to end against fake Google / Microsoft servers: the real OAuth code path
 * (start → consent URL → callback → token exchange → encrypted storage → first sync), what the page
 * may see (no secrets, no setup details), friendly failures, the organizer, and People without duplicates.
 */
const KEY = randomBytes(32).toString('base64');
const SECRETS = ['g-secret-value', 'm-secret-value'];
const config = { google: { clientId: 'g-id', clientSecret: SECRETS[0] }, microsoft: { clientId: 'm-id', clientSecret: SECRETS[1], tenant: 'common' }, baseUrl: 'http://localhost:3000' };

function setup(opts: { configured?: boolean; key?: string | undefined } = {}) {
  const apis = fakeCalendarApis();
  const store = new Map<string, CalendarConnection>();
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const people = createPeopleService({ store: new Map<string, PersonRecord>() });
  const calendar = createCalendarSyncService({ store, config: opts.configured === false ? { baseUrl: 'http://localhost:3000' } : config, encryptionKey: 'key' in opts ? opts.key : KEY, fetchImpl: apis.fetch, schedule, people });
  const pipeline = createMeetingPipeline(Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const }), createPipelineStores());
  const app = createApp({ calendar, schedule, people, meetingPipeline: pipeline });
  return { apis, store, schedule, people, calendar, app };
}
/** Follows the real route flow: /start → provider consent URL (state) → /callback?code&state. */
async function connectViaRoutes(s: ReturnType<typeof setup>, provider: 'google' | 'microsoft' = 'google') {
  const start = await request(s.app).get(`/api/calendar/oauth/${provider}/start`);
  expect(start.status).toBe(302);
  const consent = new URL(start.headers.location);
  expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
  expect(consent.searchParams.get('redirect_uri')).toBe(`http://localhost:3000/api/calendar/oauth/${provider}/callback`);
  const state = consent.searchParams.get('state') as string;
  return request(s.app).get(`/api/calendar/oauth/${provider}/callback?code=auth-code&state=${encodeURIComponent(state)}`);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('calendar integration', () => {
  it('Google: Connect → consent (read-only scope) → callback → tokens stored encrypted → meetings and people imported', async () => {
    const s = setup();
    const start = new Date(Date.now() + 26 * 3600000);
    s.apis.google.events['primary-cal'] = [gEvent('e1', 26, {
      summary: 'Project Status Meeting',
      organizer: { email: 'million@example.com', displayName: 'Million' },
      attendees: [{ email: 'sara.lee@acme.com', self: true }, { email: 'sara@example.com', displayName: 'Sara' }],
    })];
    const consent = new URL((await request(s.app).get('/api/calendar/oauth/google/start')).headers.location);
    expect(consent.searchParams.get('scope')).toContain('calendar.readonly');
    expect(consent.searchParams.get('scope')).not.toMatch(/calendar(\.events)?($|\s)/); // never write access
    const back = await connectViaRoutes(s);
    expect(back.headers.location).toBe('/?page=settings&calendarProvider=google&calendarConnected=google');

    // Tokens are stored sealed, never in plain text.
    const raw = JSON.stringify(s.store.get('google'));
    expect(raw).not.toMatch(/access-\d|refresh-1/);
    // Imported as an upcoming meeting with organizer, time, duration and participants.
    const m = s.schedule.listAll().find((x) => x.title === 'Project Status Meeting')!;
    expect(m).toMatchObject({ status: 'scheduled', external: { provider: 'google' }, organizer: { email: 'million@example.com', name: 'Million' } });
    expect(Math.abs(Date.parse(m.start as string) - start.getTime())).toBeLessThan(5000);
    expect(Date.parse(m.end as string) - Date.parse(m.start as string)).toBe(3600000);
    expect(m.runId).toBeUndefined(); // not a completed meeting
    expect(m.participants.map((p) => p.email)).toEqual(['million@example.com', 'sara.lee@acme.com', 'sara@example.com']);
    // People: the real attendees, no samples; same address from an uploaded meeting → still one person.
    await request(s.app).post('/api/meetings/draft').field('attendees', 'Sara <SARA@example.com>').field('title', 'Recorded').attach('audio', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40), Buffer.from('dup')]), 'm.wav');
    const people = (await request(s.app).get('/api/people')).body.people.map((p: { email: string; name: string }) => `${p.name} <${p.email}>`);
    expect(people.filter((p: string) => /sara@example\.com/i.test(p))).toHaveLength(1);
    expect(people.some((p: string) => p.startsWith('Million <million@example.com>'))).toBe(true);
    expect(people.join(' ')).not.toMatch(/Priya|Tom Ward/);
  });

  it('Outlook: the same flow with Microsoft', async () => {
    const s = setup();
    const start = new Date(Date.now() + 5 * 3600000);
    s.apis.microsoft.events['ms-cal'] = [{ id: 'o1', subject: 'Vendor call', start: { dateTime: start.toISOString().replace('Z', '') }, end: { dateTime: new Date(start.getTime() + 1800000).toISOString().replace('Z', '') },
      organizer: { emailAddress: { address: 'ann@acme.com', name: 'Ann Bo' } }, attendees: [{ type: 'required', emailAddress: { address: 'tom@acme.com', name: 'Tom' } }] }];
    const back = await connectViaRoutes(s, 'microsoft');
    expect(back.headers.location).toContain('calendarConnected=microsoft');
    const m = s.schedule.listAll().find((x) => x.title === 'Vendor call')!;
    expect(m.organizer).toEqual({ email: 'ann@acme.com', name: 'Ann Bo' });
    expect((await request(s.app).get('/api/calendar/connections')).body.providers[1].connection.accountEmail).toBe('sara.lee@acme.com');
  });

  it('what the page sees has no secrets, tokens, or setup details', async () => {
    const s = setup();
    await connectViaRoutes(s);
    const body = JSON.stringify((await request(s.app).get('/api/calendar/connections')).body);
    for (const secret of [...SECRETS, KEY, 'access-', 'refresh-1', 'sealedTokens', 'TOKEN_ENCRYPTION_KEY', 'CLIENT_SECRET', 'CALENDAR_SYNC_SETUP']) expect(body).not.toContain(secret);
    const bare = setup({ configured: false, key: undefined });
    const status = (await request(bare.app).get('/api/calendar/connections')).body;
    expect(status.available).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/TOKEN_ENCRYPTION_KEY|client|secret|docs\//i);
    expect(missingSetup({ baseUrl: 'x' }, undefined)).toEqual(['TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET', 'MS_CLIENT_ID/MS_CLIENT_SECRET']); // for the server log
  });

  it('not set up: Connect sends the user back with plain words (no env names)', async () => {
    for (const s of [setup({ configured: false }), setup({ key: undefined })]) {
      const res = await request(s.app).get('/api/calendar/oauth/google/start');
      expect(res.status).toBe(302);
      const msg = new URL(res.headers.location, 'http://x').searchParams.get('calendarError');
      expect(msg).toBe('Calendar integration isn’t available yet — it needs administrator setup.');
    }
  });

  it('failures in plain words: declined consent, expired link, expired authorization (Reconnect), API down (Try again)', async () => {
    const s = setup();
    const declined = await request(s.app).get('/api/calendar/oauth/google/callback?error=access_denied');
    expect(new URL(declined.headers.location, 'http://x').searchParams.get('calendarError')).toBe('Calendar access wasn’t granted, so nothing was connected.');
    const stale = await request(s.app).get('/api/calendar/oauth/google/callback?code=x&state=not-a-real-state');
    expect(new URL(stale.headers.location, 'http://x').searchParams.get('calendarError')).toBe('That sign-in link expired or was already used. Start “Connect” again.');

    await connectViaRoutes(s);
    // Authorization expired: the stored refresh token was revoked.
    const sealed = s.store.get('google')!;
    s.store.set('google', { ...sealed, sealedTokens: (await import('../services/calendarSync/tokenCrypto')).encrypt(JSON.stringify({ accessToken: 'old', refreshToken: 'revoked', expiresAt: 0 }), Buffer.from(KEY, 'base64')) });
    const expired = (await request(s.app).post('/api/calendar/sync').send({ provider: 'google' })).body;
    expect(expired.results.google).toMatchObject({ needsReconnect: true, error: 'Your Google Calendar sign-in has expired or was removed. Reconnect to keep syncing.' });
    expect(expired.status.providers[0].connection.lastError).toMatchObject({ needsReconnect: true });
    expect(JSON.stringify(expired)).not.toMatch(/invalid_grant/);

    // Reconnect fixes it; then the calendar API goes down → Try again.
    await connectViaRoutes(s);
    s.apis.google.failNext = 10;
    const down = (await request(s.app).post('/api/calendar/sync').send({ provider: 'google' })).body;
    expect(down.results.google).toMatchObject({ needsReconnect: false, error: 'Google Calendar didn’t respond. Check the connection and try again.' });
    s.apis.google.failNext = 0;
    expect((await request(s.app).post('/api/calendar/sync').send({ provider: 'google' })).body.status.providers[0].connection.lastError).toBeUndefined();
  });

  it('disconnect then reconnect; the calendar itself is never written to', async () => {
    const s = setup();
    s.apis.google.events['primary-cal'] = [gEvent('e1', 30, { summary: 'Weekly' })];
    await connectViaRoutes(s);
    expect((await request(s.app).delete('/api/calendar/connections/google')).body).toEqual({ removedMeetings: 1 });
    expect(s.store.has('google')).toBe(false);
    await connectViaRoutes(s);
    expect(s.schedule.listAll().filter((m) => m.title === 'Weekly')).toHaveLength(1);
    const writes = s.apis.calls.filter((c) => /^(POST|PUT|PATCH|DELETE) https:\/\/www\.googleapis\.com\/calendar/.test(c));
    expect(writes).toEqual([]);
  });

  it('friendlyError never returns technical wording', () => {
    for (const cls of ['AuthError', 'TokenKeyError', 'NotConfigured', 'RateLimitError', 'UpstreamUnavailable', 'TimeoutError', 'ContractViolation', 'Weird']) {
      expect(friendlyError('microsoft', cls).message).not.toMatch(/TOKEN|client|secret|grant|stack|http/i);
    }
  });
});

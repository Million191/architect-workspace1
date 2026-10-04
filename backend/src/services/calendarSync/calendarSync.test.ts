import { mkdtempSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { createCalendarSyncService } from './calendarSyncService';
import { decrypt, encrypt, parseKey } from './tokenCrypto';
import { pickMeetingLink, platformOf } from './meetingLinks';
import { mapGoogleEvent, mapGraphEvent } from './providers';
import { CalendarConnection, OAuthTokens } from './types';
import { fakeCalendarApis, gEvent } from './__testutils__/fakeCalendarApis';
import { createScheduleService } from '../schedule/scheduleService';
import { ScheduledMeeting } from '../schedule/types';
import { createPeopleService } from '../people/peopleService';
import { PersonRecord } from '../people/types';

const KEY = randomBytes(32).toString('base64');
const config = { google: { clientId: 'g-id', clientSecret: 'g-secret' }, microsoft: { clientId: 'm-id', clientSecret: 'm-secret', tenant: 'common' }, baseUrl: 'http://localhost:3000' };

function setup(opts: { key?: string } = {}) {
  const apis = fakeCalendarApis();
  const store = new Map<string, CalendarConnection>();
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const people = createPeopleService({ store: new Map<string, PersonRecord>() });
  const photoDir = mkdtempSync(path.join(os.tmpdir(), 'photos-'));
  const svc = createCalendarSyncService({ store, config, encryptionKey: 'key' in opts ? opts.key : KEY, fetchImpl: apis.fetch, schedule, people, photoDir });
  return { apis, store, schedule, people, svc, photoDir };
}
async function connect(s: ReturnType<typeof setup>, provider: 'google' | 'microsoft' = 'google') {
  const url = new URL(s.svc.beginAuth(provider));
  return s.svc.completeAuth(provider, 'auth-code', url.searchParams.get('state') as string);
}
const byTitle = (s: ReturnType<typeof setup>, title: string) => s.schedule.listAll().find((m) => m.title === title);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('token encryption', () => {
  it('round-trips, detects tampering, and requires a 32-byte key', () => {
    const key = parseKey(KEY);
    const sealed = encrypt('{"accessToken":"secret"}', key);
    expect(sealed).not.toContain('secret');
    expect(decrypt(sealed, key)).toBe('{"accessToken":"secret"}');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(parts.join('.'), key)).toThrow();
    expect(() => decrypt(sealed, parseKey(randomBytes(32).toString('base64')))).toThrow();
    expect(() => parseKey(undefined)).toThrow('TOKEN_ENCRYPTION_KEY is not set');
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow('32 random bytes');
  });
});

describe('meeting links and event mapping', () => {
  it('detects Zoom, Teams, and Meet, preferring the conference link, else one in the text', () => {
    expect(platformOf('https://acme.zoom.us/j/1')).toBe('zoom');
    expect(platformOf('https://teams.microsoft.com/l/meetup-join/x')).toBe('teams');
    expect(platformOf('https://meet.google.com/abc-defg-hij')).toBe('meet');
    expect(platformOf('https://example.com')).toBe('none');
    expect(pickMeetingLink([undefined, 'https://meet.google.com/a'], ['https://zoom.us/j/2'])).toBe('https://meet.google.com/a');
    expect(pickMeetingLink([], ['Agenda doc https://docs.example.com/x, join: https://acme.zoom.us/j/99.'])).toBe('https://acme.zoom.us/j/99');
    expect(pickMeetingLink([], ['no links here'])).toBeUndefined();
  });

  it('maps Google and Graph events: times, all-day, cancelled, attendees, rooms, organizer', () => {
    const g = mapGoogleEvent(gEvent('g1', 2, { hangoutLink: 'https://meet.google.com/x' }), 'primary-cal')!;
    expect(g).toMatchObject({ id: 'g1', allDay: false, cancelled: false, platform: 'meet' });
    expect(g.attendees.find((a) => a.resource)!.email).toContain('resource');
    expect(mapGoogleEvent({ id: 'h', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }, 'c')!.allDay).toBe(true);
    expect(mapGoogleEvent({ id: 'x', status: 'cancelled', start: { dateTime: '2026-10-10T10:00:00Z' }, end: { dateTime: '2026-10-10T11:00:00Z' } }, 'c')!.cancelled).toBe(true);

    const m = mapGraphEvent({ id: 'm1', subject: 'Sync', start: { dateTime: '2026-10-10T14:00:00.0000000' }, end: { dateTime: '2026-10-10T15:00:00.0000000' },
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/x' }, organizer: { emailAddress: { address: 'boss@acme.com', name: 'Boss' } },
      attendees: [{ type: 'required', emailAddress: { address: 'sara.lee@acme.com', name: 'Sara' } }, { type: 'resource', emailAddress: { address: 'room@acme.com' } }] }, 'ms-cal', 'sara.lee@acme.com')!;
    expect(m.start).toBe('2026-10-10T14:00:00Z');
    expect(m.platform).toBe('teams');
    expect(m.attendees.map((a) => [a.email, !!a.self, !!a.resource, !!a.organizer])).toEqual([['boss@acme.com', false, false, true], ['sara.lee@acme.com', true, false, false], ['room@acme.com', false, true, false]]);
  });
});

describe('calendar sync (Google)', () => {
  it('OAuth: one-time state + PKCE; tokens are stored encrypted; the primary calendar is selected', async () => {
    const s = setup();
    const url = new URL(s.svc.beginAuth('google'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/calendar/oauth/google/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(s.svc.completeAuth('google', 'code', 'forged-state')).rejects.toThrow('expired or was already used');
    const conn = await s.svc.completeAuth('google', 'auth-code', url.searchParams.get('state') as string);
    expect(conn).toMatchObject({ accountEmail: 'sara.lee@acme.com', selectedCalendarIds: ['primary-cal'], options: { skipSolo: true } });
    expect(JSON.stringify(conn)).not.toContain('access-');
    expect(s.apis.google.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', code_verifier: expect.any(String) });
    const stored = s.store.get('google')!;
    expect(stored.sealedTokens).not.toContain('access-1');
    expect((JSON.parse(decrypt(stored.sealedTokens, parseKey(KEY))) as OAuthTokens).refreshToken).toBe('refresh-1');
    // The same state can't be used twice.
    await expect(s.svc.completeAuth('google', 'auth-code', url.searchParams.get('state') as string)).rejects.toThrow('already used');
  });

  it('imports the next 4 weeks: skips all-day and solo events, detects links, learns names; re-sync is a no-op', async () => {
    const s = setup();
    s.apis.google.events['primary-cal'] = [
      gEvent('a', 3, { summary: 'Budget review', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://acme.zoom.us/j/42' }] } }),
      { id: 'holiday', summary: 'Holiday', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
      gEvent('solo', 5, { summary: 'Focus time', attendees: [{ email: 'sara.lee@acme.com', self: true }] }),
    ];
    await connect(s);
    const budget = byTitle(s, 'Budget review')!;
    expect(budget).toMatchObject({ link: 'https://acme.zoom.us/j/42', external: { provider: 'google', calendarId: 'primary-cal', eventId: 'a' }, status: 'scheduled' });
    expect(budget.participants.map((p) => p.email)).toEqual(['sara.lee@acme.com', 'tom.ward@acme.com']); // the room is not a participant
    expect(byTitle(s, 'Holiday')).toBeUndefined();
    expect(byTitle(s, 'Focus time')).toBeUndefined();
    expect(s.people.get('tom.ward@acme.com')).toMatchObject({ name: 'Tom Ward', nameSource: 'calendar' });
    expect(s.store.get('google')!.lastSyncSummary).toMatchObject({ added: 1, skipped: 2 });

    const again = await s.svc.sync('google');
    expect(again.google).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(byTitle(s, 'Budget review')!.version).toBe(1);
  });

  it('time changes, cancellations, and deletions in the calendar show up on the next sync', async () => {
    const s = setup();
    s.apis.google.events['primary-cal'] = [gEvent('move', 3, { summary: 'Moves' }), gEvent('cancel', 4, { summary: 'Gets cancelled' }), gEvent('delete', 6, { summary: 'Gets deleted' })];
    await connect(s);
    s.apis.google.events['primary-cal'] = [gEvent('move', 8, { summary: 'Moves' }), { ...gEvent('cancel', 4, { summary: 'Gets cancelled' }), status: 'cancelled' }];
    const r = await s.svc.sync('google');
    expect(r.google).toMatchObject({ updated: 1, cancelled: 2 });
    const moved = byTitle(s, 'Moves')!;
    expect(Date.parse(moved.start as string)).toBeGreaterThan(Date.now() + 7 * 3600000);
    expect(moved.history.at(-1)!.action).toBe('rescheduled');
    expect(byTitle(s, 'Gets cancelled')).toMatchObject({ status: 'cancelled', statusReason: 'Cancelled in Google Calendar' });
    expect(byTitle(s, 'Gets deleted')!.status).toBe('cancelled');
    // Synced meetings are changed in the calendar, not here.
    expect(() => s.schedule.cancel(moved.id)).toThrow('comes from Google Calendar');
  });

  it('refreshes expired tokens; a revoked sign-in is reported as needing reconnect; 5xx is retried', async () => {
    const s = setup();
    await connect(s);
    const c = s.store.get('google')!;
    const expired = { ...(JSON.parse(decrypt(c.sealedTokens, parseKey(KEY))) as OAuthTokens), expiresAt: 0 };
    s.store.set('google', { ...c, sealedTokens: encrypt(JSON.stringify(expired), parseKey(KEY)) });
    await s.svc.sync('google');
    expect(s.apis.google.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect((JSON.parse(decrypt(s.store.get('google')!.sealedTokens, parseKey(KEY))) as OAuthTokens).refreshToken).toBe('refresh-1'); // kept

    s.apis.google.failNext = 2; // two 503s, then success
    expect((await s.svc.sync('google')).google).toMatchObject({ unchanged: 0 });
    expect(s.store.get('google')!.lastError).toBeUndefined();

    const revoked = { ...expired, refreshToken: 'revoked' };
    s.store.set('google', { ...s.store.get('google')!, sealedTokens: encrypt(JSON.stringify(revoked), parseKey(KEY)) });
    const r = await s.svc.sync('google');
    expect(r.google).toMatchObject({ errorClass: 'AuthError', needsReconnect: true });
    expect(s.store.get('google')!.lastError!.message).toContain('Reconnect');
  });

  it('choosing calendars and filters: deselected calendars’ meetings go; solo events can be included', async () => {
    const s = setup();
    s.apis.google.events['primary-cal'] = [gEvent('p1', 3, { summary: 'Primary meeting' }), gEvent('solo', 5, { summary: 'Focus time', attendees: [{ email: 'sara.lee@acme.com', self: true }] })];
    s.apis.google.events['team-cal'] = [gEvent('t1', 4, { summary: 'Team meeting' })];
    await connect(s);
    await s.svc.updateSettings('google', { selectedCalendarIds: ['primary-cal', 'team-cal'] });
    expect(byTitle(s, 'Team meeting')).toBeDefined();
    await s.svc.updateSettings('google', { options: { skipSolo: false } });
    expect(byTitle(s, 'Focus time')).toBeDefined();
    await s.svc.updateSettings('google', { selectedCalendarIds: ['primary-cal'] });
    expect(byTitle(s, 'Team meeting')).toBeUndefined();
    await expect(s.svc.updateSettings('google', { selectedCalendarIds: ['not-mine'] })).rejects.toThrow('Choose calendars from the list');
  });

  it('disconnect revokes, forgets tokens, and removes synced meetings (a recorded one stays as a normal meeting)', async () => {
    const s = setup();
    s.apis.google.events['primary-cal'] = [gEvent('a', 3, { summary: 'Plain' }), gEvent('b', 0.05, { summary: 'Recorded' })];
    await connect(s);
    s.schedule.linkRecording(byTitle(s, 'Recorded')!.id, 'run-1');
    const r = await s.svc.disconnect('google');
    expect(r.removedMeetings).toBe(1);
    expect(s.apis.calls).toContain('POST https://oauth2.googleapis.com/revoke');
    expect(s.store.has('google')).toBe(false);
    expect(byTitle(s, 'Plain')).toBeUndefined();
    expect(byTitle(s, 'Recorded')!.external).toBeUndefined();
  });

  it('refuses to connect without an encryption key or client id, saying what to set up', () => {
    expect(() => setup({ key: undefined }).svc.beginAuth('google')).toThrow('TOKEN_ENCRYPTION_KEY is not set');
    const s = setup();
    expect(s.svc.status().providers.every((p) => p.configured)).toBe(true);
    const bare = createCalendarSyncService({ store: new Map(), config: { baseUrl: 'http://x' }, encryptionKey: KEY, fetchImpl: s.apis.fetch });
    expect(() => bare.beginAuth('microsoft')).toThrow('Outlook isn’t set up on this server yet');
    expect(bare.status().providers.map((p) => p.configured)).toEqual([false, false]);
  });
});

describe('calendar sync (Outlook)', () => {
  it('imports Outlook events and stores attendee photos served by the app', async () => {
    const s = setup();
    s.apis.microsoft.photos['tom.ward@acme.com'] = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    const start = new Date(Date.now() + 3 * 3600000);
    s.apis.microsoft.events['ms-cal'] = [{
      id: 'o1', subject: 'Outlook planning', start: { dateTime: start.toISOString().replace('Z', '') }, end: { dateTime: new Date(start.getTime() + 3600000).toISOString().replace('Z', '') },
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/1' },
      attendees: [{ type: 'required', emailAddress: { address: 'tom.ward@acme.com', name: 'Tom Ward' } }, { type: 'required', emailAddress: { address: 'ann@acme.com', name: 'Ann Bo' } }],
    }];
    await connect(s, 'microsoft');
    const m = byTitle(s, 'Outlook planning')!;
    expect(m).toMatchObject({ external: { provider: 'microsoft' }, link: 'https://teams.microsoft.com/l/meetup-join/1' });
    expect(Math.abs(Date.parse(m.start as string) - start.getTime())).toBeLessThan(1000); // Graph's UTC wall time, read as UTC
    const tom = s.people.get('tom.ward@acme.com');
    expect(tom.avatarUrl).toMatch(/^\/api\/people\/photos\/[a-f0-9]{40}\.jpg$/);
    expect(s.people.get('ann@acme.com').avatarUrl).toBeUndefined(); // no photo → initials
    expect(readdirSync(s.photoDir)).toHaveLength(1);
  });
});

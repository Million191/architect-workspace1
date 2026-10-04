import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { createApp } from '../server';
import { createCalendarSyncService } from '../services/calendarSync/calendarSyncService';
import { CalendarConnection } from '../services/calendarSync/types';
import { fakeCalendarApis, gEvent } from '../services/calendarSync/__testutils__/fakeCalendarApis';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';

const KEY = randomBytes(32).toString('base64');
function app(opts: { configured?: boolean } = {}) {
  const apis = fakeCalendarApis();
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const people = createPeopleService({ store: new Map<string, PersonRecord>() });
  const photoDir = mkdtempSync(path.join(os.tmpdir(), 'photos-route-'));
  const config = opts.configured === false ? { baseUrl: 'http://localhost:3000' } : { google: { clientId: 'g', clientSecret: 's' }, microsoft: { clientId: 'm', clientSecret: 's', tenant: 'common' }, baseUrl: 'http://localhost:3000' };
  const calendar = createCalendarSyncService({ store: new Map<string, CalendarConnection>(), config, encryptionKey: KEY, fetchImpl: apis.fetch, schedule, people, photoDir });
  return { app: createApp({ schedule, people, calendar, photoDir }), apis, schedule, photoDir };
}
async function connectViaBrowser(a: ReturnType<typeof app>['app']) {
  const start = await request(a).get('/api/calendar/oauth/google/start');
  expect(start.status).toBe(302);
  const state = new URL(start.headers.location).searchParams.get('state') as string;
  return request(a).get(`/api/calendar/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('/api/calendar', () => {
  it('connect: start redirects to Google; the callback stores the connection and returns to Settings', async () => {
    const t = app();
    t.apis.google.events['primary-cal'] = [gEvent('e1', 2, { summary: 'Synced sync', hangoutLink: 'https://meet.google.com/x' })];
    const back = await connectViaBrowser(t.app);
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe('/?page=settings&calendarConnected=google');
    const status = (await request(t.app).get('/api/calendar/connections')).body;
    expect(status.providers[0]).toMatchObject({ provider: 'google', configured: true, connection: { accountEmail: 'sara.lee@acme.com', lastSyncedAt: expect.any(String) } });
    expect(JSON.stringify(status)).not.toMatch(/access-|refresh-1|sealedTokens/); // tokens never reach the page

    // The synced meeting appears in the week with its platform and source, and can't be edited here.
    const week = (await request(t.app).get(`/api/schedule?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 7 * 86400000).toISOString()}`)).body;
    const m = week.meetings.find((x: { title: string }) => x.title === 'Synced sync');
    expect(m).toMatchObject({ platform: 'meet', external: { provider: 'google' }, display: 'upcoming' });
    const edit = await request(t.app).put(`/api/schedule/${m.id}`).send({ title: 'Renamed', start: m.start, end: m.end, participants: [] });
    expect(edit.status).toBe(409);
    expect(edit.body.message).toContain('comes from Google Calendar');
  });

  it('declined consent, forged state, and unconfigured providers come back to Settings with a clear message', async () => {
    const t = app();
    const declined = await request(t.app).get('/api/calendar/oauth/google/callback?error=access_denied');
    expect(decodeURIComponent(declined.headers.location)).toContain('Calendar access wasn’t granted');
    const forged = await request(t.app).get('/api/calendar/oauth/google/callback?code=x&state=forged');
    expect(decodeURIComponent(forged.headers.location)).toContain('expired or was already used');
    const bare = app({ configured: false });
    const start = await request(bare.app).get('/api/calendar/oauth/microsoft/start');
    expect(decodeURIComponent(start.headers.location)).toContain('Outlook isn’t set up on this server yet');
    expect((await request(t.app).get('/api/calendar/oauth/yahoo/start')).status).toBe(404);
  });

  it('settings, sync now, and disconnect', async () => {
    const t = app();
    await connectViaBrowser(t.app);
    expect((await request(t.app).put('/api/calendar/connections/google').send({ selectedCalendarIds: ['primary-cal', 'team-cal'], options: { skipSolo: false } })).body.connection)
      .toMatchObject({ selectedCalendarIds: ['primary-cal', 'team-cal'], options: { skipSolo: false } });
    expect((await request(t.app).put('/api/calendar/connections/google').send({ options: { skipAllDay: false } })).status).toBe(400);
    expect((await request(t.app).put('/api/calendar/connections/google').send({ selectedCalendarIds: ['nope'] })).status).toBe(400);
    const sync = await request(t.app).post('/api/calendar/sync').send({});
    expect(sync.body.results.google).toMatchObject({ added: 0 });
    expect((await request(t.app).post('/api/calendar/sync').send({ provider: 'yahoo' })).status).toBe(400);
    expect((await request(t.app).delete('/api/calendar/connections/google')).body).toEqual({ removedMeetings: 0 });
    expect((await request(t.app).put('/api/calendar/connections/google').send({ options: { skipSolo: true } })).status).toBe(404);
  });

  it('serves stored attendee photos by hash name only', async () => {
    const t = app();
    const name = 'a'.repeat(40) + '.jpg';
    writeFileSync(path.join(t.photoDir, name), Buffer.from([0xff, 0xd8, 0xff]));
    expect((await request(t.app).get(`/api/people/photos/${name}`)).status).toBe(200);
    expect((await request(t.app).get('/api/people/photos/..%2F..%2Fsecret.txt')).status).toBe(404);
    expect((await request(t.app).get('/api/people/photos/' + 'b'.repeat(40) + '.jpg')).status).toBe(404);
  });

  it('answers 503 when calendar sync is not wired', async () => {
    expect((await request(createApp({})).get('/api/calendar/connections')).status).toBe(503);
  });
});

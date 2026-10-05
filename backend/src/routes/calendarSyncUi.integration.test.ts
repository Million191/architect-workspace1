import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { createApp } from '../server';
import { createCalendarSyncService, CalendarSyncService } from '../services/calendarSync/calendarSyncService';
import { CalendarConnection } from '../services/calendarSync/types';
import { fakeCalendarApis, FakeApis, gEvent } from '../services/calendarSync/__testutils__/fakeCalendarApis';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Calendar sync in the page: Settings → Integrations, Sync now, synced labels, cancellations, disconnect. */
function setup(): { app: ReturnType<typeof createApp>; apis: FakeApis; calendar: CalendarSyncService } {
  const apis = fakeCalendarApis();
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const people = createPeopleService({ store: new Map<string, PersonRecord>() });
  const calendar = createCalendarSyncService({
    store: new Map<string, CalendarConnection>(),
    config: { google: { clientId: 'g', clientSecret: 's' }, microsoft: { clientId: 'm', clientSecret: 's', tenant: 'common' }, baseUrl: 'http://localhost:3000' },
    encryptionKey: randomBytes(32).toString('base64'), fetchImpl: apis.fetch, schedule, people, photoDir: mkdtempSync(path.join(os.tmpdir(), 'ph-')),
  });
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const app = createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()), schedule, people, calendar, email: { mode: 'draft-only', deliver: providers.emailDeliveryClient } });
  return { app, apis, calendar };
}
/** What the OAuth redirect does, without a browser leaving the page. */
async function connectGoogle(calendar: CalendarSyncService) {
  const state = new URL(calendar.beginAuth('google')).searchParams.get('state') as string;
  await calendar.completeAuth('google', 'code', state);
}
/** Monday-based offset into the current week, so the event shows in "This week". */
function thisWeekAt(day: number, hh: number): number {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return (new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, hh).getTime() - Date.now()) / 3600000;
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const block = (page: Page, title: string) => Array.from(page.doc.querySelectorAll('.cal-block, .cal-list-row')).find((b) => b.querySelector('.cal-block-title, strong')?.textContent === title) as HTMLElement | undefined;
const nav = (page: Page, label: string) => (Array.from(page.doc.querySelectorAll('.nav-link')).find((a) => a.querySelector('.label-text')?.textContent === label) as HTMLAnchorElement).click();

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Calendar sync in the app', () => {
  it('Settings shows each provider; Sync calendar in the panel leads there when nothing is connected', async () => {
    const { app } = setup();
    const page = track(openPage(app, '/'));
    await waitFor(() => !!page.doc.getElementById('viewCalendar'), 'dashboard');
    (page.doc.getElementById('viewCalendar') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('calSync'), 'sync button in the calendar header');
    expect(text(page, '#calSync')).toBe('Sync calendar');
    (page.doc.getElementById('calSync') as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Settings', 'settings');
    await waitFor(() => text(page, '.integrations').includes('Google Calendar'), 'integrations');
    expect(text(page, '.integrations')).toContain('Read-only access to events. Imports the next 4 weeks.');
    expect((page.doc.getElementById('connect-google') as HTMLButtonElement).disabled).toBe(false);
    expect(page.doc.getElementById('connect-microsoft')).not.toBeNull();
  });

  it('connected: synced meetings carry a “Google” label; Sync now picks up a cancellation; disconnect removes them', async () => {
    const { app, apis, calendar } = setup();
    apis.google.events['primary-cal'] = [gEvent('e1', thisWeekAt(2, 10), { summary: 'Partner review', hangoutLink: 'https://meet.google.com/abc' })];
    apis.google.events['team-cal'] = [];
    await connectGoogle(calendar);
    const page = track(openPage(app, '/?calendarConnected=google'));
    await waitFor(() => text(page, '#toasts').includes('Google Calendar connected and synced'), 'connected toast');

    (page.doc.getElementById('viewCalendar') as HTMLButtonElement).click();
    await waitFor(() => !!block(page, 'Partner review'), 'synced meeting in the week');
    const tag = block(page, 'Partner review')!.querySelector('.synced-tag')!;
    expect(tag.textContent).toBe('Google (synced from Google Calendar)');
    expect(text(page, '.cal-sync-status')).toBe('Last synced just now');
    block(page, 'Partner review')!.dispatchEvent(new page.dom.window.Event('mouseenter'));
    expect(text(page, '#calTip')).toContain('Synced from Google Calendar');

    // Cancelled in Google → Sync now → shown as Cancelled.
    apis.google.events['primary-cal'] = [{ ...gEvent('e1', thisWeekAt(2, 10), { summary: 'Partner review' }), status: 'cancelled' }];
    (page.doc.getElementById('calSync') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#toasts').includes('Calendar synced — 1 change'), 'sync toast');
    await waitFor(() => (block(page, 'Partner review')?.className ?? '').includes('is-cancelled'), 'cancelled block');

    // Settings: connection details, calendar choice, disconnect.
    nav(page, 'Settings');
    await waitFor(() => text(page, '.integrations').includes('Connected as sara.lee@acme.com'), 'connection card');
    expect(text(page, '.integration-cals')).toContain('Sara Lee (main)');
    const team = Array.from(page.doc.querySelectorAll('.integration-cals input')).find((i) => i.getAttribute('data-id') === 'team-cal') as HTMLInputElement;
    team.checked = true;
    team.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    await waitFor(() => page.calls.includes('PUT /api/calendar/connections/google'), 'calendar choice saved');
    await waitFor(() => text(page, '#toasts').includes('Calendar settings saved'), 'saved toast');

    (page.doc.getElementById('disconnect-google') as HTMLButtonElement).click(); // confirm() → true in the harness
    await waitFor(() => text(page, '#toasts').includes('Google Calendar disconnected — removed 1 synced meeting'), 'disconnected');
    await waitFor(() => !!page.doc.getElementById('connect-google'), 'Connect is back');
  });

  it('a failed sign-in comes back with the reason', async () => {
    const { app } = setup();
    const page = track(openPage(app, '/?page=settings&calendarError=' + encodeURIComponent('Calendar access wasn’t granted, so nothing was connected.')));
    await waitFor(() => text(page, '#toasts').includes('Calendar access wasn’t granted'), 'error toast');
  });
});

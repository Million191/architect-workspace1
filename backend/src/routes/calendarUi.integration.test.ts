import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Calendar steps a + b: click-to-open panel, week and list views with real data. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + 4000, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 3), Buffer.from(salt)]);
}

/** Local time on this week's Monday + `dayOffset`, at hh:mm. */
function at(dayOffset: number, hh: number, mm = 0): string {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset, hh, mm).toISOString();
}
const WEEKDAY = (dayOffset: number) => new Date(at(dayOffset, 12)).toLocaleDateString(undefined, { weekday: 'long' });

function server() {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}
async function schedule(app: Express, title: string, day: number, h: number, mins = 60) {
  const res = await request(app).post('/api/schedule').send({ title, start: at(day, h), end: new Date(Date.parse(at(day, h)) + mins * 60000).toISOString(), participants: [{ name: 'Priya', email: 'priya@example.com' }] });
  return res.body.meeting.id as string;
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const card = (page: Page) => page.doc.getElementById('viewCalendar') as HTMLButtonElement;
const block = (page: Page, title: string) => Array.from(page.doc.querySelectorAll('.cal-block')).find((b) => b.querySelector('.cal-block-title')?.textContent === title) as HTMLButtonElement | undefined;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('This week calendar — open and view', () => {
  it('opens from “View calendar”, shows real meetings, switches views, and closes with X or Esc', async () => {
    const app = server();
    await schedule(app, 'Q4 budget review', 1, 10);
    await schedule(app, 'Design review', 1, 10, 30); // overlaps → side by side
    const gone = await schedule(app, 'Vendor call', 2, 14);
    await request(app).post(`/api/schedule/${gone}/cancel`).send({ reason: 'Vendor away' });

    const page = track(openPage(app));
    await waitFor(() => !!card(page), 'the dashboard');
    expect(page.doc.getElementById('weekCalendar')).toBeNull();
    expect(card(page).getAttribute('aria-expanded')).toBe('false');
    expect(card(page).getAttribute('aria-controls')).toBe('weekCalendar');
    await waitFor(() => text(page, '#meetingsCard-value') === '2', 'count excludes the cancelled meeting');

    card(page).click();
    await waitFor(() => !!block(page, 'Q4 budget review'), 'meeting blocks');
    expect(card(page).getAttribute('aria-expanded')).toBe('true');
    expect(text(page, '#calHeading')).toBe('This week');
    const q4 = block(page, 'Q4 budget review')!;
    expect(q4.getAttribute('aria-label')).toMatch(new RegExp(`^Q4 budget review, ${WEEKDAY(1)} 10:00\\sAM, upcoming$`));
    expect(q4.style.width).toContain('50%');
    expect(block(page, 'Vendor call')!.className).toContain('is-cancelled');
    expect(text(page, '.cal-foot')).toBe('UpcomingNeeds reviewApprovedSentPostponedCancelled');

    // Show cancelled toggle
    const showCancelled = page.doc.getElementById('calShowCancelled') as HTMLInputElement;
    showCancelled.checked = false;
    showCancelled.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    await waitFor(() => !block(page, 'Vendor call'), 'cancelled hidden');

    // Details popover, Esc closes it and returns focus to the block
    block(page, 'Q4 budget review')!.focus();
    block(page, 'Q4 budget review')!.click();
    await waitFor(() => !!page.doc.querySelector('[role="dialog"]'), 'details');
    expect(text(page, '[role="dialog"] h2')).toBe('Q4 budget review');
    page.doc.querySelector('[role="dialog"]')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !page.doc.querySelector('[role="dialog"]'), 'details closed');
    expect(card(page).getAttribute('aria-expanded')).toBe('true'); // Esc closed only the popover

    // List view
    (page.doc.getElementById('calView-list') as HTMLInputElement).click();
    await waitFor(() => !!page.doc.querySelector('.cal-list-row'), 'list view');
    expect(text(page, '.cal-list')).toContain('Q4 budget review');
    expect(text(page, '.cal-list')).toContain('Upcoming');

    // Week navigation shows skeletons while the other week loads
    (page.doc.querySelector('[aria-label="Next week"]') as HTMLButtonElement).click();
    expect(page.doc.querySelector('.cal-skeleton')).not.toBeNull();
    await waitFor(() => text(page, '#calHeading') === 'Next week' && !page.doc.querySelector('.cal-skeleton'), 'next week');
    expect(text(page, '.empty h2')).toBe('No meetings this week');
    (Array.from(page.doc.querySelectorAll('.cal-head button')).find((b) => b.textContent === 'Today') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#calHeading') === 'This week' && !!page.doc.querySelector('.cal-list-row'), 'back to this week');

    // Esc closes the panel and returns focus to “View calendar”; X does too
    page.doc.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !page.doc.getElementById('weekCalendar'), 'panel closed by Esc');
    expect(page.doc.activeElement).toBe(card(page));
    card(page).click();
    await waitFor(() => !!page.doc.getElementById('weekCalendar'), 'reopened');
    (page.doc.querySelector('[aria-label="Close calendar"]') as HTMLButtonElement).click();
    await waitFor(() => !page.doc.getElementById('weekCalendar'), 'panel closed by X');
  });

  it('remembers the open state for the session and sends needs-review meetings straight to review', async () => {
    const app = server();
    const id = await schedule(app, 'Retro', 0, 9);
    const draft = await request(app).post('/api/meetings/draft').field('attendees', 'Priya <priya@example.com>').field('title', 'Retro')
      .field('scheduledMeetingId', id).attach('audio', wav('cal-retro'), 'retro.wav');
    expect(draft.status).toBe(201);

    const page = track(openPage(app, '/', (win) => win.sessionStorage.setItem('ma.calendarOpen', '1')));
    await waitFor(() => !!block(page, 'Retro'), 'panel open from the session');
    const retro = block(page, 'Retro')!;
    expect(retro.className).toContain('is-needs_review');
    expect(retro.getAttribute('aria-label')).toMatch(/needs review$/);
    retro.click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'the review screen');
  });
});

describe('This week calendar — add meetings', () => {
  const dateValue = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const input = (page: Page, id: string) => page.doc.getElementById(id) as HTMLInputElement;
  const typeInto = (page: Page, id: string, value: string) => { const i = input(page, id); i.value = value; i.dispatchEvent(new page.dom.window.Event('input', { bubbles: true })); i.dispatchEvent(new page.dom.window.Event('change', { bubbles: true })); };
  const key = (page: Page, id: string, k: string) => input(page, id).dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const submit = (page: Page) => (page.doc.getElementById('calSave') as HTMLButtonElement).click();
  const column = (page: Page, day: number) => page.doc.querySelector(`.cal-col[data-day="${dateValue(at(day, 12))}"]`) as HTMLElement;
  const pointer = (page: Page, target: Element, type: string, clientY: number) => target.dispatchEvent(new page.dom.window.MouseEvent(type, { bubbles: true, clientY, button: 0 }));
  const HOUR = 56; // px per hour in the week grid; the grid starts at 9 AM here

  async function openCalendar(app: Express) {
    const page = track(openPage(app));
    await waitFor(() => !!card(page), 'dashboard');
    card(page).click();
    await waitFor(() => !!page.doc.querySelector('.cal-grid'), 'week grid');
    return page;
  }

  it('“New meeting” (keyboard path): validates inline, adds participants as chips, saves, toasts, and updates the count', async () => {
    const app = server();
    const page = await openCalendar(app);
    await waitFor(() => text(page, '#meetingsCard-value') === '0', 'count 0');
    (page.doc.getElementById('calNew') as HTMLButtonElement).click();
    await waitFor(() => text(page, '[role="dialog"] h2') === 'New meeting', 'the form');
    expect(page.doc.activeElement).toBe(input(page, 'calTitle'));
    expect(input(page, 'calTitle').placeholder).toBe('Weekly team sync');
    expect(input(page, 'calDate').value).toBe(dateValue(new Date().toISOString()));

    // Inline validation: nothing is created.
    submit(page);
    await waitFor(() => text(page, '#calTitle-error') === 'Add a title.', 'title error');
    typeInto(page, 'calTitle', 'Weekly team sync');
    typeInto(page, 'calEnd', '00:00'); // before (or equal to) any start time
    submit(page);
    await waitFor(() => text(page, '#calEnd-error') === 'The end time must be after the start time.', 'end error');
    expect(page.calls.filter((c) => c === 'POST /api/schedule')).toHaveLength(0);

    // Chips: valid ones added on Enter/comma, invalid ones explained.
    typeInto(page, 'calParticipants', 'Priya <priya@example.com>');
    key(page, 'calParticipants', 'Enter');
    typeInto(page, 'calParticipants', 'nope');
    key(page, 'calParticipants', ',');
    // Chips show the name with an avatar; the address is on hover (title) and in the remove label.
    expect(text(page, '.chip-list')).toBe('Priya');
    expect(page.doc.querySelector('.chip')!.getAttribute('title')).toBe('Priya <priya@example.com>');
    expect(page.doc.querySelector('.chip [aria-label="Remove Priya <priya@example.com>"]')).not.toBeNull();
    expect(text(page, '.cal-form')).toContain('“nope” isn’t a valid email address.');
    typeInto(page, 'calParticipants', '');

    // Fix the end time and save.
    typeInto(page, 'calStart', '10:00');
    typeInto(page, 'calEnd', '10:30');
    submit(page);
    await waitFor(() => text(page, '#toasts').includes('Meeting added'), 'toast');
    await waitFor(() => !page.doc.querySelector('[role="dialog"]') && !!block(page, 'Weekly team sync'), 'new block');
    expect(block(page, 'Weekly team sync')!.className).toContain('is-upcoming');
    await waitFor(() => text(page, '#meetingsCard-value') === '1', 'count updated');
  });

  it('clicking an empty slot pre-fills that day and time; dragging pre-fills start and end with a live preview', async () => {
    const app = server();
    await schedule(app, 'Q4 budget review', 1, 10);
    const page = await openCalendar(app);
    await waitFor(() => !!block(page, 'Q4 budget review'), 'existing block');

    // Click Tuesday 10:00 → overlap warning, still saveable
    const tue = column(page, 1);
    pointer(page, tue, 'pointerdown', 1 * HOUR);
    pointer(page, tue, 'pointerup', 1 * HOUR);
    await waitFor(() => text(page, '[role="dialog"] h2') === 'New meeting', 'form from slot');
    expect(input(page, 'calDate').value).toBe(dateValue(at(1, 12)));
    expect([input(page, 'calStart').value, input(page, 'calEnd').value]).toEqual(['10:00', '10:30']);
    expect(text(page, '#calOverlap')).toBe('Overlaps with Q4 budget review — you can still save.');
    typeInto(page, 'calTitle', 'Design review');
    submit(page);
    await waitFor(() => text(page, '#toasts').includes('Meeting added — overlaps with q4 budget review'), 'overlap toast');
    await waitFor(() => !!block(page, 'Design review'), 'overlapping block');

    // Drag Wednesday 1:00 PM → 3:00 PM
    const wed = column(page, 2);
    pointer(page, wed, 'pointerdown', 4 * HOUR);
    pointer(page, wed, 'pointermove', 5.6 * HOUR);
    expect(wed.querySelector('.cal-drag-preview')?.textContent).toMatch(/1:00\sPM – 3:00\sPM/);
    pointer(page, wed, 'pointerup', 5.6 * HOUR);
    await waitFor(() => text(page, '[role="dialog"] h2') === 'New meeting', 'form from drag');
    expect([input(page, 'calStart').value, input(page, 'calEnd').value]).toEqual(['13:00', '15:00']);
    expect(text(page, '#calOverlap')).toBe('');
    (Array.from(page.doc.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click();
    await waitFor(() => !page.doc.querySelector('[role="dialog"]'), 'form cancelled');
    expect(page.calls.filter((c) => c === 'POST /api/schedule')).toHaveLength(1);
  });
});

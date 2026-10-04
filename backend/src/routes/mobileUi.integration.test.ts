import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/**
 * Phone layout structure (jsdom has no CSS layout, so visibility per breakpoint is checked with real
 * screenshots; this checks what each layout renders and how it behaves).
 */
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

function server(): Express {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    people: createPeopleService({ store: new Map<string, PersonRecord>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}
async function upload(app: Express, title: string, salt: string) {
  const res = await request(app).post('/api/meetings/draft').field('title', title).field('attendees', 'Sara Lee <sara.lee@acme.com>, Tom <tom.ward@acme.com>').attach('audio', wav(salt), `${salt}.wav`);
  expect(res.status).toBe(201);
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const key = (page: Page, target: Element, k: string, shiftKey = false) => target.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
const bottom = (page: Page) => Array.from(page.doc.querySelectorAll('#bottomNav .bottom-link'));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Phone layout', () => {
  it('meetings render as cards: title, date, status, avatar stack; tap opens, ⋯ holds secondary actions', async () => {
    const app = server();
    await upload(app, 'Budget review', 'a');
    await upload(app, 'Design sync', 'b');
    const page = track(openPage(app));
    await waitFor(() => page.doc.querySelectorAll('.meeting-card').length === 2, 'two cards');
    const card = Array.from(page.doc.querySelectorAll('.meeting-card')).find((c) => c.querySelector('.meeting-card-title')!.textContent === 'Budget review')!;
    expect(card.querySelector('.badge')!.textContent).toBe('Needs review');
    expect(card.querySelector('.avatar-stack')!.getAttribute('aria-label')).toBe('Sara Lee and Tom. Show participants');
    expect(card.querySelector('.meeting-card-meta .muted')!.textContent).not.toBe('');
    // The table is still rendered for wider screens (CSS picks one).
    expect(page.doc.querySelectorAll('.meetings-table tbody tr')).toHaveLength(2);
    expect(page.doc.querySelector('.meetings-table th.col-participants')).not.toBeNull();

    const menu = card.querySelector('.meeting-card-menu') as HTMLButtonElement;
    expect(menu.getAttribute('aria-label')).toBe('More actions for Budget review');
    menu.click();
    expect(Array.from(page.doc.querySelectorAll('[role="menu"] .menu-label')).map((n) => n.textContent)).toEqual(['Review minutes', 'Copy link']);
    key(page, page.doc.querySelector('[role="menuitem"]')!, 'Escape');
    expect(text(page, 'h1.page-title')).toBe('Meetings'); // opening the menu did not open the meeting

    (card.querySelector('.meeting-card-foot') as HTMLElement).click(); // anywhere on the card
    await waitFor(() => text(page, 'h1.page-title') === 'Budget review', 'meeting opened from the card');
  });

  it('bottom navigation: Meetings, Action items, Record, Settings; current page marked; Record opens the recording menu', async () => {
    const app = server();
    await upload(app, 'Budget review', 'c');
    const page = track(openPage(app));
    await waitFor(() => bottom(page).length === 4, 'bottom nav');
    expect(bottom(page).map((n) => n.querySelector('.bottom-label')!.textContent)).toEqual(['Meetings', 'Action items', 'Record', 'Settings']);
    await waitFor(() => !!page.doc.querySelector('#bottomNav .bottom-count'), 'pending badge');
    expect(page.doc.querySelector('#bottomNav .bottom-count')!.getAttribute('aria-label')).toBe('1 need review');
    expect(bottom(page)[0].getAttribute('aria-current')).toBe('page');

    (bottom(page)[3] as HTMLAnchorElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Settings', 'settings');
    expect(bottom(page)[3].getAttribute('aria-current')).toBe('page');
    // People is reachable from Settings on phones (it is not in the bottom bar).
    (page.doc.getElementById('settingsPeople') as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'People', 'people');
    expect(bottom(page)[3].getAttribute('aria-current')).toBe('page');

    const record = page.doc.getElementById('bottomRecord') as HTMLButtonElement;
    expect(record.getAttribute('aria-haspopup')).toBe('menu');
    expect(record.textContent).toBe('Record');
    record.click();
    expect(Array.from(page.doc.querySelectorAll('[role="menu"] .menu-label')).map((n) => n.textContent)).toEqual(['In-person meeting', 'Online meeting on this computer']);
  });

  it('search opens full screen, traps focus, shows results as you type, and Esc returns focus to the search button', async () => {
    const app = server();
    await upload(app, 'Budget review', 'd');
    await upload(app, 'Design sync', 'e');
    const page = track(openPage(app));
    await waitFor(() => page.doc.querySelectorAll('.meeting-card').length === 2, 'cards');
    const open = page.doc.getElementById('searchOpen') as HTMLButtonElement;
    expect(open.getAttribute('aria-label')).toBe('Search meetings, transcripts, or action items');
    open.focus();
    open.click();
    const overlay = page.doc.getElementById('searchOverlay')!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    const input = page.doc.getElementById('searchMobile') as HTMLInputElement;
    expect(page.doc.activeElement).toBe(input);

    input.value = 'design';
    input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    await waitFor(() => text(page, '#searchOverlayResults .search-group').includes('Design sync'), 'results in the overlay');
    // Meetings group: only the matching title (a transcript line elsewhere may still say "design").
    expect(Array.from(page.doc.querySelectorAll('#searchOverlayResults .search-group:first-child .search-hit-title')).map((n) => n.textContent)).toEqual(['Design sync']);
    expect(page.doc.activeElement).toBe(input); // typing never loses focus

    // Tab from the last control wraps to the first.
    const cancel = page.doc.getElementById('searchCancel') as HTMLButtonElement;
    cancel.focus();
    key(page, cancel, 'Tab');
    expect(page.doc.activeElement).toBe(input);
    key(page, input, 'Tab', true);
    expect(page.doc.activeElement).toBe(cancel);

    key(page, input, 'Escape');
    expect(overlay.hidden).toBe(true);
    expect(overlay.getAttribute('role')).toBeNull();
    expect(page.doc.activeElement).toBe(open);
  });
});

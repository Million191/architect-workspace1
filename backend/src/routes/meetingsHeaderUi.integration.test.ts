import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Meetings header: "View calendar", the "New meeting" split button, mobile "More" menu, help and account menus, search placeholder. */
function server() {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const byId = <T extends HTMLElement>(page: Page, id: string) => page.doc.getElementById(id) as T;
const key = (page: Page, target: Element, k: string) => target.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const menuLabels = (page: Page) => Array.from(page.doc.querySelectorAll('[role="menu"] .menu-label')).map((n) => n.textContent);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Meetings header actions', () => {
  it('“View calendar” is a ghost button that opens and closes the week panel and swaps its label', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'viewCalendar'), 'the header');
    const viewCalendar = () => byId<HTMLButtonElement>(page, 'viewCalendar');
    expect(text(page, '#viewCalendar')).toBe('View calendar');
    expect(viewCalendar().className).toContain('btn-ghost');
    expect(viewCalendar().getAttribute('aria-controls')).toBe('weekCalendar');
    expect(viewCalendar().getAttribute('aria-expanded')).toBe('false');

    viewCalendar().click();
    await waitFor(() => !!byId(page, 'weekCalendar'), 'panel open');
    expect(text(page, '#viewCalendar')).toBe('Hide calendar');
    expect(viewCalendar().getAttribute('aria-expanded')).toBe('true');

    // Closing from the button returns focus to the button.
    viewCalendar().focus();
    viewCalendar().click();
    await waitFor(() => !byId(page, 'weekCalendar'), 'panel closed');
    expect(text(page, '#viewCalendar')).toBe('View calendar');
    expect(page.doc.activeElement).toBe(viewCalendar());
  });

  it('one primary “New meeting” split button: the main part uploads, the ▾ menu offers upload and both recording options', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'newMeetingMenu'), 'the header');
    // Exactly one primary button in the header; no “Commands” button any more.
    expect(page.doc.querySelectorAll('.page-header .btn-primary:not(.split-caret)')).toHaveLength(1);
    expect(byId(page, 'primaryAction').textContent).toBe('New meeting');
    expect(page.doc.getElementById('paletteButton')).toBeNull();
    const caret = byId<HTMLButtonElement>(page, 'newMeetingMenu');
    expect(caret.getAttribute('aria-haspopup')).toBe('menu');
    expect(caret.getAttribute('aria-label')).toBe('More ways to add a meeting');

    key(page, caret, 'ArrowDown');
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    expect(menuLabels(page)).toEqual(['Upload file', 'Record in person', 'Record an online meeting']);
    const items = page.doc.querySelectorAll('[role="menuitem"]');
    expect(page.doc.activeElement).toBe(items[0]);
    key(page, items[0], 'ArrowUp');
    expect(page.doc.activeElement).toBe(items[2]); // wraps
    key(page, items[2], 'Escape');
    expect(page.doc.querySelector('[role="menu"]')).toBeNull();
    expect(page.doc.activeElement).toBe(caret);

    // Online capture opens its recorder; jsdom can't capture audio, so the page explains instead of failing silently.
    caret.click();
    (page.doc.querySelectorAll('[role="menuitem"]')[2] as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Record an online meeting', 'online recorder');
    expect(text(page, '.callout-danger')).toContain('isn’t supported in this browser');

    (page.doc.querySelector('.back-link') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('newMeetingMenu'), 'back on meetings');
    (page.doc.getElementById('newMeetingMenu') as HTMLButtonElement).click();
    (page.doc.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Record an in-person meeting', 'in-person recorder');

    // The main part goes straight to the upload page.
    (page.doc.querySelector('.back-link') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('primaryAction'), 'back on meetings');
    byId<HTMLButtonElement>(page, 'primaryAction').click();
    await waitFor(() => text(page, 'h1.page-title') === 'Upload meeting', 'upload page');
  });

  it('the mobile “More” menu holds the calendar toggle', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'moreActions'), 'the header');
    const more = byId<HTMLButtonElement>(page, 'moreActions');
    expect(more.getAttribute('aria-label')).toBe('More actions');
    expect(more.className).toContain('narrow-only');
    expect(byId(page, 'viewCalendar').className).toContain('wide-only');

    more.click();
    expect(menuLabels(page)).toEqual(['View calendar']);
    (page.doc.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    await waitFor(() => !!byId(page, 'weekCalendar'), 'panel opened from More');
    byId<HTMLButtonElement>(page, 'moreActions').click();
    expect(menuLabels(page)[0]).toBe('Hide calendar');
    // A second click on the trigger closes the menu (toggle, never two menus).
    byId<HTMLButtonElement>(page, 'moreActions').click();
    expect(page.doc.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  it('help menu explains shortcuts; the avatar menu reaches your name and Settings', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'helpButton'), 'the top bar');
    const help = byId<HTMLButtonElement>(page, 'helpButton');
    expect(help.getAttribute('aria-label')).toBe('Help');
    help.click();
    expect(menuLabels(page)).toEqual(['Keyboard shortcuts', 'How it works']);
    byId<HTMLButtonElement>(page, 'helpShortcuts').click();
    await waitFor(() => text(page, '[role="dialog"]').includes('Search meetings'), 'shortcuts dialog');
    expect(text(page, '[role="dialog"]')).toContain('Open the selected meeting row');
    byId<HTMLButtonElement>(page, 'helpClose').click();

    const avatar = byId<HTMLButtonElement>(page, 'avatar');
    expect(avatar.tagName).toBe('BUTTON');
    expect(avatar.getAttribute('aria-haspopup')).toBe('menu');
    key(page, avatar, 'ArrowDown');
    expect(menuLabels(page)).toEqual(['Set your name', 'Settings']);
    byId<HTMLButtonElement>(page, 'accountProfile').click();
    await waitFor(() => text(page, 'h1.page-title') === 'Settings', 'settings');
    await waitFor(() => page.doc.activeElement === byId(page, 'settingsName'), 'name field focused');
  });

  it('search uses the new placeholder and keeps its label', async () => {
    const page = track(openPage(server()));
    const search = byId<HTMLInputElement>(page, 'search');
    expect(search.placeholder).toBe('Search meetings, transcripts, or action items');
    expect(text(page, 'label[for="search"]')).toBe('Search meetings, transcripts, or action items');
  });
});

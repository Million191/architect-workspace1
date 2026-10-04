import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Meetings header: "View calendar", "Record meeting" menu, mobile "More" menu, and the search placeholder. */
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
  it('“View calendar” opens and closes the week panel, stays in sync with the summary card, and swaps its label', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'viewCalendar'), 'the header');
    const viewCalendar = () => byId<HTMLButtonElement>(page, 'viewCalendar');
    expect(text(page, '#viewCalendar')).toBe('View calendar');
    expect(viewCalendar().getAttribute('aria-controls')).toBe('weekCalendar');
    expect(viewCalendar().getAttribute('aria-expanded')).toBe('false');

    viewCalendar().click();
    await waitFor(() => !!byId(page, 'weekCalendar'), 'panel open');
    expect(text(page, '#viewCalendar')).toBe('Hide calendar');
    expect(viewCalendar().getAttribute('aria-expanded')).toBe('true');
    expect(byId(page, 'weekCard').getAttribute('aria-expanded')).toBe('true');

    // Closing from the button returns focus to the button, not the card.
    viewCalendar().focus();
    viewCalendar().click();
    await waitFor(() => !byId(page, 'weekCalendar'), 'panel closed');
    expect(text(page, '#viewCalendar')).toBe('View calendar');
    expect(page.doc.activeElement).toBe(viewCalendar());

    // The summary card is the same toggle.
    byId<HTMLButtonElement>(page, 'weekCard').click();
    await waitFor(() => text(page, '#viewCalendar') === 'Hide calendar', 'label follows the card');
  });

  it('“Record meeting” is a keyboard-operable menu with both recording options', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'recordMeeting'), 'the header');
    const record = byId<HTMLButtonElement>(page, 'recordMeeting');
    expect(record.getAttribute('aria-haspopup')).toBe('menu');
    expect(record.className).toContain('btn-secondary');
    expect(byId(page, 'primaryAction').textContent).toBe('Upload meeting');
    expect(byId(page, 'primaryAction').className).toContain('btn-primary');

    key(page, record, 'ArrowDown');
    expect(record.getAttribute('aria-expanded')).toBe('true');
    expect(menuLabels(page)).toEqual(['In-person meeting', 'Online meeting on this computer']);
    const items = page.doc.querySelectorAll('[role="menuitem"]');
    expect(page.doc.activeElement).toBe(items[0]);
    key(page, items[0], 'ArrowDown');
    expect(page.doc.activeElement).toBe(items[1]);
    key(page, items[1], 'ArrowDown');
    expect(page.doc.activeElement).toBe(items[0]); // wraps

    key(page, items[0], 'Escape');
    expect(page.doc.querySelector('[role="menu"]')).toBeNull();
    expect(record.getAttribute('aria-expanded')).toBe('false');
    expect(page.doc.activeElement).toBe(record);

    // Online capture opens its recorder; jsdom can't capture audio, so the page explains instead of failing silently.
    record.click();
    (page.doc.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Record an online meeting', 'online recorder');
    expect(text(page, '.callout-danger')).toContain('isn’t supported in this browser');

    // In-person opens the in-person recorder.
    (page.doc.querySelector('.back-link') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('recordMeeting'), 'back on meetings');
    (page.doc.getElementById('recordMeeting') as HTMLButtonElement).click();
    (page.doc.querySelectorAll('[role="menuitem"]')[0] as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Record an in-person meeting', 'in-person recorder');
  });

  it('the mobile “More” menu holds the calendar toggle and both recording options', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!byId(page, 'moreActions'), 'the header');
    const more = byId<HTMLButtonElement>(page, 'moreActions');
    expect(more.getAttribute('aria-label')).toBe('More actions');
    expect(more.className).toContain('narrow-only');
    expect(byId(page, 'viewCalendar').className).toContain('wide-only');

    more.click();
    expect(menuLabels(page)).toEqual(['View calendar', 'In-person meeting', 'Online meeting on this computer']);
    (page.doc.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    await waitFor(() => !!byId(page, 'weekCalendar'), 'panel opened from More');
    byId<HTMLButtonElement>(page, 'moreActions').click();
    expect(menuLabels(page)[0]).toBe('Hide calendar');
    // A second click on the trigger closes the menu (toggle, never two menus).
    byId<HTMLButtonElement>(page, 'moreActions').click();
    expect(page.doc.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  it('search uses the new placeholder and keeps its label', async () => {
    const page = track(openPage(server()));
    const search = byId<HTMLInputElement>(page, 'search');
    expect(search.placeholder).toBe('Search meetings, transcripts, or action items');
    expect(text(page, 'label[for="search"]')).toBe('Search meetings, transcripts, or action items');
  });
});

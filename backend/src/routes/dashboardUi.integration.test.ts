import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Meetings dashboard: status badges, tabs and filters, clickable rows, inline rename, stat cards, recent activity. */
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
  return Buffer.concat([header, Buffer.alloc(4000, 5), Buffer.from(salt)]);
}

function server(): Express {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}
async function upload(app: Express, title: string, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('title', title).field('attendees', 'Sara Lee <sara@acme.com>, Tom <tom@acme.com>').attach('audio', wav(salt), `${salt}.wav`);
  expect(res.status).toBe(201);
  return res.body.runId as string;
}
async function approveAll(app: Express, runId: string) {
  const p = `/api/meetings/${encodeURIComponent(runId)}`;
  expect((await request(app).post(`${p}/approve-minutes`).send({ approvedBy: 'Priya' })).status).toBe(200);
  expect((await request(app).post(`${p}/approve-emails`).send({ approvedBy: 'Priya' })).status).toBe(200);
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const key = (page: Page, target: Element, k: string) => target.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const rows = (page: Page) => Array.from(page.doc.querySelectorAll<HTMLTableRowElement>('.meetings-table tbody tr'));
const rowTitles = (page: Page) => rows(page).map((r) => r.querySelector('.title-text')?.textContent);
const tab = (page: Page, id: string) => page.doc.getElementById(`tab-${id}`) as HTMLButtonElement;
const title = (page: Page) => text(page, 'h1.page-title');
type MAWindow = { MA: { ui: { badge(s: unknown): HTMLElement }; statusOf(stage: string): unknown } };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Status badge', () => {
  it('every lifecycle status has an icon and a text label, never colour alone', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!page.doc.getElementById('primaryAction'), 'the app');
    const MA = (page.dom.window as unknown as MAWindow).MA;
    const expected: Array<[string, string, string]> = [
      ['processing', 'Processing', 'badge-neutral'],
      ['minutes_pending_approval', 'Needs review', 'badge-warning'],
      ['emails_drafted', 'Emails drafted', 'badge-accent'],
      ['emails_pending_approval', 'Emails drafted', 'badge-accent'],
      ['approved_not_sent', 'Approved', 'badge-success'],
      ['sent', 'Sent', 'badge-success'],
      ['failed', 'Failed', 'badge-danger'],
    ];
    for (const [stage, label, kind] of expected) {
      const b = MA.ui.badge(MA.statusOf(stage));
      expect(b.textContent).toBe(label);
      expect(b.className).toContain(kind);
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('Meetings tabs and table', () => {
  it('defaults to “Needs review” with counts; tabs filter the table and move with arrow keys', async () => {
    const app = server();
    await upload(app, 'Budget review', 'tab-a');
    const done = await upload(app, 'Design sync', 'tab-b');
    await approveAll(app, done);
    const page = track(openPage(app));
    await waitFor(() => !!tab(page, 'needs_review'), 'tabs');
    expect(page.doc.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Filter meetings');
    expect(tab(page, 'needs_review').getAttribute('aria-selected')).toBe('true');
    expect(tab(page, 'needs_review').textContent).toBe('Needs review1');
    expect(tab(page, 'approved').textContent).toBe('Approved1');
    expect(tab(page, 'all').textContent).toBe('All2');
    expect(tab(page, 'approved').getAttribute('tabindex')).toBe('-1'); // roving tabindex
    expect(rowTitles(page)).toEqual(['Budget review']);
    expect(page.doc.getElementById('meetingsPanel')!.getAttribute('aria-labelledby')).toBe('tab-needs_review');

    tab(page, 'needs_review').focus();
    key(page, tab(page, 'needs_review'), 'ArrowRight');
    await waitFor(() => tab(page, 'approved').getAttribute('aria-selected') === 'true', 'Approved tab');
    expect(page.doc.activeElement).toBe(tab(page, 'approved'));
    expect(rowTitles(page)).toEqual(['Design sync']);
    expect(text(page, '.meetings-table tbody .badge')).toBe('Approved');

    key(page, tab(page, 'approved'), 'End');
    await waitFor(() => tab(page, 'all').getAttribute('aria-selected') === 'true', 'All tab');
    expect(rowTitles(page).sort()).toEqual(['Budget review', 'Design sync']);
    // Columns: date with time · duration, title, participants, action items, status; the chevron column is decorative.
    expect(Array.from(page.doc.querySelectorAll('.meetings-table th')).map((th) => th.textContent)).toEqual(['Date', 'Title', 'Participants', 'Action items', 'Status']);
    expect(rows(page)[0].querySelector('.date-sub')!.textContent).toMatch(/min/);
    expect(rows(page)[0].querySelector('.col-chevron')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('with nothing to review it opens on “All”; the Pending card says “All caught up” and there is no Review now', async () => {
    const app = server();
    await approveAll(app, await upload(app, 'Done meeting', 'tab-c'));
    const page = track(openPage(app));
    await waitFor(() => !!tab(page, 'all'), 'tabs');
    expect(tab(page, 'all').getAttribute('aria-selected')).toBe('true');
    expect(text(page, '#pendingCard-value')).toBe('All caught up');
    expect(page.doc.getElementById('reviewNow')).toBeNull();
    expect(page.doc.querySelector('#pendingCard')!.closest('.stat-card')!.className).not.toContain('is-attention');
    // An empty Needs review tab explains itself and offers a way back.
    tab(page, 'needs_review').click();
    await waitFor(() => text(page, '#meetingsPanel .empty h2') === 'All caught up', 'empty tab');
  });

  it('search narrows the table and shows a removable chip; the Meetings card filters to its period', async () => {
    const app = server();
    await upload(app, 'Budget review', 'flt-a');
    await upload(app, 'Design sync', 'flt-b');
    const page = track(openPage(app));
    await waitFor(() => rows(page).length === 2, 'two rows');
    (page.dom.window as unknown as { MA: { app: { actions: { search(q: string, o: object): void } } } }).MA.app.actions.search('design', { keepFocus: true });
    await waitFor(() => rows(page).length === 1, 'filtered');
    expect(rowTitles(page)).toEqual(['Design sync']);
    expect(text(page, '.filter-chips')).toContain('Search: “design”');
    (page.doc.querySelector('.filter-chip [aria-label="Clear search"]') as HTMLButtonElement).click();
    await waitFor(() => rows(page).length === 2, 'search cleared');

    (page.doc.getElementById('meetingsCard') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('clearRangeFilter'), 'period chip');
    expect(tab(page, 'all').getAttribute('aria-selected')).toBe('true');
    expect(text(page, '.filter-chips')).toContain('This week');
    expect(rows(page)).toHaveLength(2); // both were recorded today
    (page.doc.getElementById('clearRangeFilter') as HTMLButtonElement).click();
    await waitFor(() => !page.doc.getElementById('clearRangeFilter'), 'chip removed');
  });

  it('the whole row opens the meeting by click, Enter or Space; controls inside the row do not', async () => {
    const app = server();
    const runId = await upload(app, 'Budget review', 'row-a');
    const page = track(openPage(app));
    await waitFor(() => rows(page).length === 1, 'row');
    const row = rows(page)[0];
    expect(row.tabIndex).toBe(0);
    expect(row.getAttribute('aria-label')).toBe('Open Budget review');
    expect(row.className).toContain('row-link');

    // The participants stack opens its own popover, not the meeting.
    (row.querySelector('.avatar-stack') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.querySelector('[role="dialog"]'), 'participants popover');
    expect(title(page)).toBe('Meetings');
    page.doc.querySelector('[role="dialog"]')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !page.doc.querySelector('[role="dialog"]'), 'popover closed');

    // Enter on a key event from inside a control is ignored; Enter on the row opens it.
    key(page, row.querySelector('.rename-btn')!, 'Enter');
    expect(title(page)).toBe('Meetings');
    row.focus();
    key(page, row, 'Enter');
    await waitFor(() => title(page) === 'Budget review', 'opened with Enter');
    expect(page.calls).toContain(`GET /api/meetings/${encodeURIComponent(runId)}`);

    // Space works too, and so does a click anywhere on the row.
    (page.doc.querySelector('.nav-link') as HTMLAnchorElement).click();
    await waitFor(() => rows(page).length === 1, 'back on the dashboard');
    key(page, rows(page)[0], ' ');
    await waitFor(() => title(page) === 'Budget review', 'opened with Space');
    (page.doc.querySelector('.nav-link') as HTMLAnchorElement).click();
    await waitFor(() => rows(page).length === 1, 'back again');
    (rows(page)[0].querySelector('.col-date') as HTMLElement).click();
    await waitFor(() => title(page) === 'Budget review', 'opened by click');
  });

  it('inline rename: the pencil opens a field; Esc cancels, Enter saves through the API', async () => {
    const app = server();
    const runId = await upload(app, 'Old title', 'ren-a');
    const page = track(openPage(app));
    await waitFor(() => rows(page).length === 1, 'row');
    const pencil = () => page.doc.getElementById(`rename-${runId}`) as HTMLButtonElement;
    expect(pencil().getAttribute('aria-label')).toBe('Rename Old title');

    pencil().click();
    await waitFor(() => page.doc.activeElement === page.doc.getElementById('renameInput-table'), 'field focused');
    const field = () => page.doc.getElementById('renameInput-table') as HTMLInputElement;
    expect(field().value).toBe('Old title');
    expect(title(page)).toBe('Meetings'); // the row did not open
    field().value = 'Never saved';
    field().dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    key(page, field(), 'Escape');
    await waitFor(() => !page.doc.getElementById('renameInput-table'), 'cancelled');
    expect(rowTitles(page)).toEqual(['Old title']);
    expect(page.doc.activeElement).toBe(pencil());
    expect(page.calls.some((c) => c.startsWith('PATCH'))).toBe(false);

    pencil().click();
    await waitFor(() => !!page.doc.getElementById('renameInput-table'), 'field again');
    field().value = 'Q4 planning';
    field().dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    key(page, field(), 'Enter');
    await waitFor(() => rowTitles(page)[0] === 'Q4 planning', 'renamed');
    expect(page.calls.filter((c) => c === `PATCH /api/meetings/${encodeURIComponent(runId)}/title`)).toHaveLength(1);
    expect(text(page, '#toasts')).toContain('Renamed to “Q4 planning”');
    expect(title(page)).toBe('Meetings');
    // The server has it too.
    const listed = (await request(app).get('/api/meetings')).body.meetings;
    expect(listed[0].title).toBe('Q4 planning');
  });
});

describe('Stat cards, activity, draft-only cues', () => {
  it('Review now opens the first pending meeting; Action items card navigates; the range selector re-counts', async () => {
    const app = server();
    await upload(app, 'Budget review', 'st-a');
    const page = track(openPage(app));
    await waitFor(() => !!page.doc.getElementById('reviewNow'), 'Review now');
    expect(text(page, '#pendingCard-value')).toBe('1');
    expect(page.doc.querySelector('#pendingCard')!.closest('.stat-card')!.className).toContain('is-attention');
    await waitFor(() => text(page, '#meetingsCard-value') === '1', 'meetings this week');
    await waitFor(() => /^Oldest from (today|yesterday)$/.test(text(page, '#pendingCard-secondary')), 'oldest waiting');

    // Range selector: a real menu, not a decorative chevron.
    const range = page.doc.getElementById('rangeSelect') as HTMLButtonElement;
    expect(range.getAttribute('aria-haspopup')).toBe('menu');
    expect(range.textContent).toBe('This week');
    range.click();
    expect(Array.from(page.doc.querySelectorAll('[role="menu"] .menu-label')).map((n) => n.textContent)).toEqual(['This week', 'This month', 'All time']);
    (page.doc.querySelectorAll('[role="menuitem"]')[2] as HTMLButtonElement).click();
    await waitFor(() => text(page, '#rangeSelect') === 'All time' && text(page, '#meetingsCard-value') === '1', 'all time count');
    expect(page.doc.getElementById('meetingsCard-secondary')).toBeNull(); // no comparison for All time — nothing faked

    (page.doc.getElementById('reviewNow') as HTMLButtonElement).click();
    await waitFor(() => title(page) === 'Budget review' && !!page.doc.getElementById('transcriptHeading'), 'review page');
    // Draft-only mode: the approve action carries a Draft-only badge.
    expect(page.doc.getElementById('draftOnlyBadge')!.textContent).toBe('Draft-only');

    (page.doc.querySelector('.nav-link') as HTMLAnchorElement).click();
    await waitFor(() => !!page.doc.getElementById('itemsCard'), 'dashboard');
    (page.doc.getElementById('itemsCard') as HTMLButtonElement).click();
    await waitFor(() => title(page) === 'Action items', 'action items page');
  });

  it('Recent activity lists what happened and opens the meeting; hidden when there is nothing', async () => {
    const empty = track(openPage(server()));
    await waitFor(() => text(empty, '.empty h2') === 'No meetings yet', 'empty dashboard');
    expect(empty.doc.getElementById('activityHeading')).toBeNull();

    const app = server();
    await approveAll(app, await upload(app, 'Weekly sync', 'act-a'));
    const page = track(openPage(app));
    await waitFor(() => !!page.doc.getElementById('activityHeading'), 'activity');
    expect(text(page, '.activity-list')).toContain('Minutes approved for Weekly sync');
    expect(text(page, '.activity-list')).toContain('Emails approved for Weekly sync (not sent — draft-only mode)');
    expect(page.doc.querySelector('.activity-list time')!.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    (page.doc.querySelector('.activity-list button') as HTMLButtonElement).click();
    await waitFor(() => title(page) === 'Weekly sync', 'meeting opened from activity');
  });

  it('the sidebar Draft-only card links to Settings', async () => {
    const page = track(openPage(server()));
    await waitFor(() => !!page.doc.getElementById('modeSettingsLink'), 'mode card');
    expect(text(page, '.mode-pill')).toContain('Draft-only mode');
    (page.doc.getElementById('modeSettingsLink') as HTMLAnchorElement).click();
    await waitFor(() => title(page) === 'Settings', 'settings');
  });
});

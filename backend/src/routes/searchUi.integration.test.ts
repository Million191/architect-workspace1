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

/** Top-bar search: grouped results, highlighting, typo handling, keyboard, recent searches, See all. */
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

async function server(): Promise<Express> {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  schedule.create({ title: 'Vendor kickoff', start: '2026-10-07T15:00:00.000Z', end: '2026-10-07T16:00:00.000Z', participants: [{ name: 'Raj Patel', email: 'raj@vendor.io' }] });
  const app = createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()), schedule, people: createPeopleService({ store: new Map<string, PersonRecord>() }), email: { mode: 'draft-only', deliver: providers.emailDeliveryClient } });
  for (const [title, salt] of [['Launch planning', 'a'], ['Launch retro', 'b'], ['Launch dry run', 'c'], ['Launch checklist', 'd']]) {
    const res = await request(app).post('/api/meetings/draft').field('title', title).field('attendees', 'Sara Lee <sara.lee@acme.com>, Tom Ward <tom.ward@acme.com>').attach('audio', wav(salt), `${salt}.wav`);
    expect(res.status).toBe(201);
  }
  return app;
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const search = (page: Page) => page.doc.getElementById('search') as HTMLInputElement;
const typeSearch = (page: Page, value: string) => { search(page).value = value; search(page).dispatchEvent(new page.dom.window.Event('input', { bubbles: true })); };
const key = (page: Page, k: string) => search(page).dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const groupHeads = (page: Page) => Array.from(page.doc.querySelectorAll('#searchPanel .search-group-head > span:first-child')).map((n) => n.textContent);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Search', () => {
  it('groups results, highlights matches, caps each group at 3 with “See all”, and announces the count', async () => {
    const page = track(openPage(await server()));
    search(page).focus();
    typeSearch(page, 'launch');
    await waitFor(() => groupHeads(page).includes('Meetings'), 'grouped results');
    expect(groupHeads(page)).toEqual(['Meetings', 'Transcripts', 'Action items'].filter((g) => groupHeads(page).includes(g)));
    const meetings = page.doc.querySelector('#searchPanel .search-group')!;
    expect(meetings.querySelectorAll('.search-hit:not(.search-see-all)')).toHaveLength(3);
    expect(text(page, '#searchPanel .search-group .search-see-all')).toBe('See all 4 meetings');
    expect(meetings.querySelector('.search-hit-title mark')!.textContent).toBe('Launch');
    expect(text(page, '#searchPanel [role="status"]')).toMatch(/^\d+ results$/);
    expect(search(page).getAttribute('role')).toBe('combobox');
    expect(search(page).getAttribute('aria-expanded')).toBe('true');

    (meetings.querySelector('.search-see-all') as HTMLElement).click();
    await waitFor(() => page.doc.querySelectorAll('#searchPanel .search-group .search-hit:not(.search-see-all)').length === 4, 'all 4 meetings');
    expect(groupHeads(page)).toEqual(['Meetings']);
    expect(text(page, '#searchPanel')).toContain('All results');
  });

  it('typo: “Showing results for …” with “Search instead for …”, which searches the exact words', async () => {
    const page = track(openPage(await server()));
    search(page).focus();
    typeSearch(page, 'onbaording');
    await waitFor(() => text(page, '.search-correction').startsWith('Showing results for onboarding.'), 'correction');
    expect(text(page, '.search-correction')).toContain('Search instead for onbaording');
    expect(page.doc.querySelectorAll('#searchPanel .search-hit mark').length).toBeGreaterThan(0);
    (page.doc.querySelector('.search-correction .link-button') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#searchPanel .search-empty').startsWith('No results for “onbaording”'), 'exact search');
    expect(text(page, '#searchPanel .search-empty')).toContain('Try a participant’s name');
  });

  it('keyboard: arrows move through results, Enter on a transcript line opens the meeting at that moment', async () => {
    const page = track(openPage(await server()));
    search(page).focus();
    typeSearch(page, 'integration work');
    await waitFor(() => groupHeads(page).includes('Transcripts'), 'transcript results');
    const options = Array.from(page.doc.querySelectorAll('#searchPanel [role="option"]')) as HTMLElement[];
    const first = options[0];
    key(page, 'ArrowDown');
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(search(page).getAttribute('aria-activedescendant')).toBe(first.id);
    key(page, 'ArrowUp'); // wraps to the last option
    expect(first.getAttribute('aria-selected')).toBe('false');
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true');
    // Arrow down to the first transcript line (speaker · time), then Enter.
    const transcriptGroup = Array.from(page.doc.querySelectorAll('#searchPanel .search-group')).find((g) => g.querySelector('.search-group-head')!.textContent!.startsWith('Transcripts'))!;
    const line = transcriptGroup.querySelector('[role="option"]') as HTMLElement;
    expect(line.querySelector('.search-hit-sub')!.textContent).toBe('Tom Ward · 0:08');
    for (let i = 0; i <= options.indexOf(line); i++) key(page, 'ArrowDown');
    expect(line.getAttribute('aria-selected')).toBe('true');
    key(page, 'Enter');
    await waitFor(() => !!page.doc.querySelector('.transcript-line.is-highlighted'), 'review at the moment');
    expect(page.doc.querySelector('.transcript-line.is-highlighted')!.getAttribute('data-start')).toBe('8000');
    expect((page.doc.getElementById('searchPanel') as HTMLElement).hidden).toBe(true);
  });

  it('recent searches show when the box is empty; Esc closes the list; scheduled meetings open their details', async () => {
    const page = track(openPage(await server()));
    search(page).focus();
    await waitFor(() => text(page, '#searchPanel').includes('Search titles, people, dates'), 'empty hint');
    typeSearch(page, 'raj');
    await waitFor(() => text(page, '#searchPanel').includes('Vendor kickoff'), 'scheduled meeting result');
    expect(text(page, '#searchPanel .search-hit-sub')).toMatch(/^Scheduled · /);
    key(page, 'Enter');
    await waitFor(() => text(page, '[role="dialog"] h2') === 'Vendor kickoff', 'details dialog');

    search(page).focus();
    typeSearch(page, '');
    await waitFor(() => text(page, '#searchPanel').includes('Recent searches'), 'recent searches');
    expect(text(page, '#searchPanel .search-recent')).toBe('raj');
    key(page, 'Escape');
    expect((page.doc.getElementById('searchPanel') as HTMLElement).hidden).toBe(true);
  });
});

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

/** Participants with names and avatars: meetings list, calendar, People screen, participant suggestions. */
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

function at(dayOffset: number, hh: number): string {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayOffset, hh).toISOString();
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

async function uploadMeeting(app: Express) {
  const res = await request(app).post('/api/meetings/draft').field('title', 'Project Progress')
    .field('attendees', 'Million <million@example.com>, Priya <priya@example.com>').attach('audio', wav('people'), 'standup.wav');
  expect(res.status).toBe(201);
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const nav = (page: Page, label: string) => Array.from(page.doc.querySelectorAll('.nav-link')).find((a) => a.querySelector('.label-text')?.textContent === label) as HTMLAnchorElement;
const key = (page: Page, target: Element, k: string) => target.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
/** Waits until the page has made no new requests for 150 ms (its start-up loads have landed). */
async function settle(page: Page) {
  let last = -1;
  for (let i = 0; i < 100 && last !== page.calls.length; i++) { last = page.calls.length; await new Promise((r) => setTimeout(r, 150)); }
}
const typeInto = (page: Page, el: HTMLInputElement, value: string) => { el.value = value; el.dispatchEvent(new page.dom.window.Event('input', { bubbles: true })); };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Participants with names and avatars', () => {
  it('meetings list shows an avatar stack; tapping it lists names and emails without opening the meeting', async () => {
    const app = server();
    await uploadMeeting(app);
    const page = track(openPage(app));
    await waitFor(() => !!page.doc.querySelector('td.participants .avatar-stack'), 'participant stack');
    const stack = page.doc.querySelector('td.participants .avatar-stack') as HTMLButtonElement;
    expect(stack.getAttribute('aria-label')).toBe('Million and Priya. Show participants');
    expect(stack.title).toBe('Million <million@example.com>\nPriya <priya@example.com>');
    const avatars = stack.querySelectorAll('.person-avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0].getAttribute('data-initials')).toBe('M');
    expect((avatars[0] as HTMLElement).style.backgroundColor).not.toBe('');
    expect(stack.textContent).toBe(''); // initials are drawn by CSS, so the row's text stays clean

    stack.click();
    await waitFor(() => !!page.doc.querySelector('[role="dialog"] .people-list'), 'participants popover');
    expect(text(page, '[role="dialog"] h2')).toBe('Participants (2)');
    expect(text(page, '[role="dialog"] .people-list')).toBe('Millionmillion@example.comPriyapriya@example.com');
    expect(text(page, 'h1.page-title')).toBe('Meetings'); // the row did not open
  });

  it('People screen: edits a name and photo, and every screen picks it up; a broken photo falls back to initials', async () => {
    const app = server();
    await uploadMeeting(app);
    const page = track(openPage(app));
    await waitFor(() => !!nav(page, 'People'), 'nav');
    nav(page, 'People').click();
    // Opening People refreshes the list once; wait for that redraw before typing.
    await waitFor(() => page.calls.filter((c) => c === 'GET /api/people').length >= 2, 'People refresh');
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => page.doc.querySelectorAll('.person-row').length === 2, 'two people');
    expect(text(page, '.person-rows')).toContain('Name from a meeting invite');

    const name = page.doc.getElementById('person-priya-example-com-name') as HTMLInputElement;
    const photo = page.doc.getElementById('person-priya-example-com-photo') as HTMLInputElement;
    const save = name.closest('.person-row')!.querySelector('.person-row-actions button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    typeInto(page, photo, 'javascript:alert(1)');
    save.click();
    expect(name.closest('.person-row')!.querySelector('.help-error')!.textContent).toBe('Photo links must start with https://');
    expect(photo.getAttribute('aria-invalid')).toBe('true');
    expect(page.calls.some((c) => c.startsWith('PUT'))).toBe(false);

    typeInto(page, name, 'Priya Raman');
    typeInto(page, photo, 'https://photos.example/priya.jpg');
    save.click();
    await waitFor(() => text(page, '#toasts').includes('Saved Priya Raman'), 'saved toast');
    await waitFor(() => !!page.doc.querySelector('.person-row img.person-avatar'), 'photo shown');
    const img = page.doc.querySelector('.person-row img.person-avatar') as HTMLImageElement;
    expect(img.alt).toBe('Priya Raman');
    img.dispatchEvent(new page.dom.window.Event('error'));
    expect(page.doc.querySelector('.person-row img.person-avatar')).toBeNull();
    expect(page.doc.querySelector('.person-row [role="img"][aria-label="Priya Raman"]')!.getAttribute('data-initials')).toBe('PR');

    nav(page, 'Meetings').click();
    await waitFor(() => (page.doc.querySelector('td.participants .avatar-stack')?.getAttribute('aria-label') ?? '') === 'Million and Priya Raman. Show participants', 'edited name on the meetings list');
  });

  it('calendar: blocks show up to 3 avatars + “+N” with a spoken summary; the form suggests known people by name', async () => {
    const app = server();
    await uploadMeeting(app);
    const six = ['sara.lee', 'tom.ward', 'ann.bo', 'li.wu', 'raj.patel', 'eve.adams'].map((n) => ({ email: `${n}@acme.com` }));
    await request(app).post('/api/schedule').send({ title: 'All hands', start: at(2, 10), end: at(2, 11), participants: six });
    const page = track(openPage(app));
    await waitFor(() => !!page.doc.getElementById('weekCard'), 'dashboard');
    await settle(page); // background loads (People, "Happening now") redraw the page once; don't hold stale elements
    (page.doc.getElementById('weekCard') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.querySelector('.cal-block .avatar-stack'), 'block stack');
    await settle(page);
    const stack = page.doc.querySelector('.cal-block .avatar-stack')!;
    expect(stack.tagName).toBe('SPAN'); // never a button inside the block button
    expect(stack.getAttribute('aria-label')).toBe('Sara Lee, Tom Ward, and 4 others');
    expect(stack.querySelectorAll('.person-avatar:not(.avatar-more)')).toHaveLength(3);
    expect(stack.querySelector('.avatar-more')!.getAttribute('data-initials')).toBe('+3');

    // Tooltip lists every name with its email.
    const block = page.doc.querySelector('.cal-block') as HTMLButtonElement;
    block.dispatchEvent(new page.dom.window.Event('mouseenter'));
    expect(text(page, '#calTip')).toContain('Raj Patel · raj.patel@acme.com');

    // New meeting → participant suggestions by name (People list loaded with the dashboard).
    await waitFor(() => !!page.doc.getElementById('calNew'), 'new button');
    (page.doc.getElementById('calNew') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('calParticipants'), 'form');
    const input = page.doc.getElementById('calParticipants') as HTMLInputElement;
    typeInto(page, input, 'pri');
    await waitFor(() => !page.doc.getElementById('calSuggest')!.hidden, 'suggestions');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(text(page, '#calSuggest')).toBe('Priyapriya@example.com');
    key(page, input, 'Escape'); // closes the list, not the dialog
    expect(page.doc.getElementById('calSuggest')!.hidden).toBe(true);
    expect(page.doc.querySelector('[role="dialog"]')).not.toBeNull();

    typeInto(page, input, 'sara');
    await waitFor(() => text(page, '#calSuggest').includes('sara.lee@acme.com'), 'Sara suggested');
    key(page, input, 'Enter');
    expect(text(page, '.chip-list')).toBe('Sara Lee');
    expect(page.doc.querySelector('.chip')!.getAttribute('title')).toBe('Sara Lee <sara.lee@acme.com>');
    // Already-added people aren't suggested again; a brand-new address can still be typed.
    typeInto(page, input, 'sara');
    expect(page.doc.getElementById('calSuggest')!.hidden).toBe(true);
    typeInto(page, input, 'new.person@acme.com');
    key(page, input, 'Enter');
    expect(Array.from(page.doc.querySelectorAll('.chip > span:not(.person-avatar)')).map((n) => n.textContent)).toEqual(['Sara Lee', 'New Person']);
  });
});

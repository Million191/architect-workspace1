import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor, goToStep } from './__testutils__/pageHarness';

/** Spell check while writing: underlines, suggestions, Ignore, Add to dictionary, and the check before approval. */
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

async function server(): Promise<{ app: Express; runId: string }> {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const app = createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }),
    people: createPeopleService({ store: new Map<string, PersonRecord>() }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
  const res = await request(app).post('/api/meetings/draft').field('title', 'Launch planning').field('attendees', 'Sara Lee <sara.lee@acme.com>, Tom Ward <tom.ward@acme.com>').attach('audio', wav('sp'), 'sp.wav');
  return { app, runId: res.body.runId };
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
/** The first section's rich-text editor (Quill), as the page created it. */
const editor = (page: Page): Q => { const eds = (page.dom.window as unknown as { MA: { review?: { sections?: { editors: Record<string, Q> } } } }).MA.review?.sections?.editors ?? {}; return Object.values(eds)[0]; };
const issues = (q: Q) => Number(q.root.getAttribute('data-spelling-issues') ?? '-1');
const errs = (field: HTMLElement) => Array.from(field.parentElement!.querySelectorAll('.spell-mirror .spell-err')).map((n) => n.textContent);
const menuLabels = (page: Page) => Array.from(page.doc.querySelectorAll('.spell-menu .menu-label')).map((n) => n.textContent);
const menuItem = (page: Page, label: string) => Array.from(page.doc.querySelectorAll('.spell-menu .menu-item')).find((b) => b.querySelector('.menu-label')!.textContent === label) as HTMLButtonElement;
/** Replace the editor's text the way typing does (a "user" change, so it autosaves). */
function typeRich(q: Q, text: string) { q.focus(); q.deleteText(0, q.getLength(), 'user'); q.insertText(0, text, 'user'); }
function pointAtRich(page: Page, q: Q, word: string, event: 'click' | 'contextmenu') {
  q.setSelection(q.getText().indexOf(word) + 1, 0, 'silent');
  q.root.dispatchEvent(new page.dom.window.MouseEvent(event, { bubbles: true, cancelable: true }));
}
/** The Summary step in Edit mode (where the minutes editors are), or the step given. */
async function openReview(page: Page, step = 'summary') {
  await goToStep(page, step, true);
  if (step === 'decisions') { await waitFor(() => !!page.doc.querySelector('.ai-row .ai-task'), 'the action items editor'); return editor(page); } // "Action items" step: no rich-text editors
  await waitFor(() => !!editor(page), 'the minutes editor');
  return editor(page);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Spell check', () => {
  it('flags mistakes as you write in the minutes; a suggestion is applied only when chosen, and it autosaves', async () => {
    const { app, runId } = await server();
    const page = track(openPage(app, `/?run=${runId}&view=review`));
    localStorageReviewer(page);
    const q = await openReview(page);
    // The transcript is never spell checked.
    expect(page.doc.querySelector('.transcript-panel .spell-wrap, .transcript-panel [data-spelling-issues]')).toBeNull();

    typeRich(q, 'We agred to move the budjet review.');
    await waitFor(() => issues(q) === 2, 'two flagged words');
    expect(q.getText().trim()).toBe('We agred to move the budjet review.'); // nothing changed by itself

    pointAtRich(page, q, 'budjet', 'click');
    expect(menuLabels(page)).toContain('budget');
    expect(menuLabels(page).slice(-2)).toEqual(['Ignore', 'Add to dictionary']);
    menuItem(page, 'budget').click();
    expect(q.getText().trim()).toBe('We agred to move the budget review.');
    await waitFor(() => text(page, '#saveState') === 'Saved', 'autosaved', 12000);
    const saved = (await request(app).get(`/api/meetings/${runId}`)).body;
    expect(saved.minutes.discussionTopics[0].summary).toBe('We agred to move the budget review.');

    // Right-click (or the menu key) opens the menu with focus in it; Ignore hides that word for the session.
    await waitFor(() => issues(q) === 1, 'one left');
    pointAtRich(page, q, 'agred', 'contextmenu');
    expect(page.doc.activeElement!.classList.contains('menu-item')).toBe(true);
    menuItem(page, 'Ignore').click();
    await waitFor(() => issues(q) === 0, 'ignored');
    expect(q.getText()).toContain('agred');
  });

  it('“Add to dictionary” teaches the whole team a word', async () => {
    const { app, runId } = await server();
    const page = track(openPage(app, `/?run=${runId}&view=review`));
    localStorageReviewer(page);
    const q = await openReview(page);
    typeRich(q, ' Ship Zephyrion next week.');
    await waitFor(() => issues(q) === 1, 'unknown project name');
    pointAtRich(page, q, 'Zephyrion', 'click');
    menuItem(page, 'Add to dictionary').click();
    await waitFor(() => text(page, '#toasts').includes('Added “Zephyrion” to the team dictionary'), 'toast');
    await waitFor(() => issues(q) === 0, 'now known');
    expect((await request(app).get('/api/spellcheck/dictionary')).body.words.map((w: { word: string }) => w.word)).toEqual(['Zephyrion']);
  });

  it('before approving: “N possible spelling mistakes — Review / Approve anyway”; Review approves nothing', async () => {
    const { app, runId } = await server();
    const page = track(openPage(app, `/?run=${runId}&view=review`));
    localStorageReviewer(page);
    const q = await openReview(page);
    typeRich(q, 'The budjet is final.');
    await waitFor(() => issues(q) === 1, 'flagged');
    await waitFor(() => text(page, '#saveState') === 'Saved', 'saved', 12000);

    await goToStep(page, 'approval');
    (page.doc.getElementById('approveMinutes') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('spellAnyway'), 'spelling check dialog', 12000);
    expect(text(page, '[role="dialog"] h2')).toBe('1 possible spelling mistake');
    expect(text(page, '.spell-review-list')).toContain('budjet → budget');
    (page.doc.getElementById('spellReview') as HTMLButtonElement).click();
    expect(page.doc.querySelector('[role="dialog"]')).toBeNull();
    expect(page.calls.filter((c) => c.endsWith('/approve-minutes'))).toHaveLength(0);
    // Review opens the summary editor (on the Review step) in Edit mode with the flagged editor focused.
    await waitFor(() => page.doc.getElementById('wfStep-approval')?.getAttribute('aria-current') === 'step' && !!editor(page) && page.doc.activeElement === editor(page).root, 'the flagged editor');
    await new Promise((r) => setTimeout(r, 20)); // the first approval attempt finishes (double-click guard)

    await goToStep(page, 'approval');
    (page.doc.getElementById('approveMinutes') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('spellAnyway'), 'dialog again');
    (page.doc.getElementById('spellAnyway') as HTMLButtonElement).click();
    await waitFor(() => page.doc.getElementById('wfStep-email')?.getAttribute('aria-current') === 'step', 'approved anyway');
    expect(page.calls.filter((c) => c.endsWith('/approve-minutes'))).toHaveLength(1);
    // The email preview underlines what's still misspelled, without changing the email text.
    await waitFor(() => !!page.doc.querySelector('.email-body .spell-err-static'), 'email preview underline');
    expect(page.doc.querySelector('.email-body .spell-err-static')!.textContent).toBe('budjet');
  });
});

function localStorageReviewer(page: Page) {
  const w = page.dom.window as unknown as { MA: { store: { setForm(p: { reviewer: string }): void } } };
  w.MA.store.setForm({ reviewer: 'Million' });
}

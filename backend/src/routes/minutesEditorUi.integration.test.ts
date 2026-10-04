import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';
import { demoAssistant } from '../services/minutesDoc/assistant';

/** Editable minutes in the real page: sections, formatting, autosave (incl. offline), action items, versions, conflicts, approval. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 3), Buffer.from(salt)]);
}

async function server(): Promise<{ app: Express; runId: string; pipeline: MeetingPipeline }> {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const app = createApp({ meetingPipeline: pipeline, schedule: createScheduleService({ store: new Map<string, ScheduledMeeting>() }), people: createPeopleService({ store: new Map<string, PersonRecord>() }), assistant: demoAssistant(), email: { mode: 'draft-only', deliver: providers.emailDeliveryClient } });
  const res = await request(app).post('/api/meetings/draft').field('title', 'Launch planning').field('attendees', 'Sara Lee <sara.lee@acme.com>, Tom Ward <tom.ward@acme.com>').attach('audio', wav('ed'), 'ed.wav');
  return { app, runId: res.body.runId, pipeline };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
type Win = { MA: { review: { sections: { editors: Record<string, Q> } }; store: { setForm(p: object): void } }; localStorage: Storage; fetch: (u: string, o?: { method?: string }) => Promise<unknown> };
const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const w = (page: Page) => page.dom.window as unknown as Win;
const editors = (page: Page): Q[] => Object.values(w(page).MA.review?.sections?.editors ?? {});
const titles = (page: Page) => Array.from(page.doc.querySelectorAll('.md-title')).map((n) => (n as HTMLInputElement).value);
const status = (page: Page) => text(page, '#saveState');
function typeRich(q: Q, text: string) { q.focus(); q.setSelection(q.getLength() - 1, 0, 'silent'); q.insertText(q.getLength() - 1, text, 'user'); }
async function open(app: Express, runId: string) {
  const page = track(openPage(app, `/?run=${runId}&view=review`));
  w(page).MA.store.setForm({ reviewer: 'Sara Lee' });
  await waitFor(() => editors(page).length > 0, 'the minutes editor');
  return page;
}
const doc = async (app: Express, runId: string) => (await request(app).get(`/api/minutes/${runId}`)).body;
const menuItem = (page: Page, label: string) => Array.from(page.doc.querySelectorAll('[role="menuitem"]')).find((b) => b.querySelector('.menu-label')!.textContent === label) as HTMLButtonElement;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Editable minutes', () => {
  it('sections: type, format, undo, rename, add, reorder, delete with Undo — each autosaved', async () => {
    const { app, runId, pipeline } = await server();
    const page = await open(app, runId);
    const first = editors(page)[0];
    expect(first.root.getAttribute('role')).toBe('textbox');
    expect(page.doc.querySelector('.md-edited')).toBeNull();

    typeRich(first, ' Launch moves to Nov 3.');
    await waitFor(() => status(page) === 'Saving…' || status(page) === 'Saved', 'saving');
    await waitFor(() => status(page) === 'Saved', 'saved', 12000);
    expect(page.doc.querySelector('.md-edited')!.textContent).toBe('Edited');
    expect(pipeline.getRun(runId).minutes.discussionTopics[0].summary).toContain('Launch moves to Nov 3.');

    // Toolbar: bold the first word; the button says it's on.
    first.setSelection(0, 5, 'user');
    const bold = page.doc.querySelector('[aria-label="Bold (Ctrl+B)"]') as HTMLButtonElement;
    bold.click();
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    // Ctrl+Z undoes it (Quill's history).
    first.history.cutoff();
    first.history.undo();
    expect(first.getFormat(0, 5).bold).toBeUndefined();
    first.history.redo();
    await waitFor(() => status(page) === 'Saved', 'saved formatting', 12000);
    expect((await doc(app, runId)).content.sections[0].html).toMatch(/^<p><strong>\w+<\/strong>/);

    // Rename, add a section, move it up, delete one with Undo.
    const title = page.doc.querySelector('.md-title') as HTMLInputElement;
    title.value = 'Timeline';
    title.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    (page.doc.getElementById('addSection') as HTMLButtonElement).click();
    menuItem(page, 'Next steps').click();
    await waitFor(() => titles(page).at(-1) === 'Next steps', 'new section');
    const added = editors(page).at(-1);
    typeRich(added, 'Ship the beta.');
    (page.doc.querySelector('[aria-label="Move Next steps up"]') as HTMLButtonElement).click();
    expect(titles(page).at(-2)).toBe('Next steps');
    expect(text(page, '#reviewAnnounce')).toBe('');
    const count = titles(page).length;
    (page.doc.querySelector('[aria-label="Delete Timeline"]') as HTMLButtonElement).click();
    expect(titles(page)).toHaveLength(count - 1);
    await waitFor(() => text(page, '#toasts').includes('Deleted “Timeline”'), 'undo toast');
    (page.doc.querySelector('#toasts .toast-action') as HTMLButtonElement).click();
    expect(titles(page)[0]).toBe('Timeline');
    await waitFor(() => status(page) === 'Saved', 'saved structure', 12000);
    const saved = (await doc(app, runId)).content.sections.map((s: { title: string }) => s.title);
    expect(saved[0]).toBe('Timeline');
    expect(saved.at(-2)).toBe('Next steps');
  });

  it('offline: “Couldn’t save. Retry”, text kept in this browser, leave warning; Retry saves it', async () => {
    const { app, runId } = await server();
    const page = await open(app, runId);
    const real = w(page).fetch;
    let offline = true;
    w(page).fetch = (u: string, o: { method?: string } = {}) => (offline && o.method === 'PUT' && u.startsWith('/api/minutes/') ? Promise.reject(new TypeError('Failed to fetch')) : real(u, o));
    typeRich(editors(page)[0], ' Offline edit.');
    await waitFor(() => status(page).startsWith('Couldn’t save'), 'save failed', 12000);
    expect(page.doc.getElementById('saveRetry')).not.toBeNull();
    expect(text(page, '.review-banners')).toContain('You’re offline. Your changes are kept in this browser');
    const backup = JSON.parse(w(page).localStorage.getItem(`ma.minutes.${runId}`) as string);
    expect(JSON.stringify(backup.content)).toContain('Offline edit.');
    const leave = new page.dom.window.Event('beforeunload', { cancelable: true }) as Event & { returnValue: unknown };
    page.dom.window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    offline = false;
    (page.doc.getElementById('saveRetry') as HTMLButtonElement).click();
    await waitFor(() => status(page) === 'Saved', 'saved after retry', 12000);
    expect(w(page).localStorage.getItem(`ma.minutes.${runId}`)).toBeNull();
    expect(JSON.stringify((await doc(app, runId)).content)).toContain('Offline edit.');
  });

  it('action items: add with owner picker, due date, priority; delete with Undo; “Not an action item”; timestamp jumps to the transcript', async () => {
    const { app, runId, pipeline } = await server();
    const page = await open(app, runId);
    const before = page.doc.querySelectorAll('.ai-list .ai-row').length;
    (page.doc.getElementById('addActionItem') as HTMLButtonElement).click();
    const n = before + 1;
    const task = page.doc.querySelector(`[aria-label="Action item ${n}"]`) as HTMLInputElement;
    expect(page.doc.activeElement).toBe(task);
    task.value = 'Write the release note';
    task.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    const owner = page.doc.querySelector(`[aria-label="Owner of action item ${n}"]`) as HTMLInputElement;
    owner.focus();
    owner.value = 'tom';
    owner.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    expect(owner.getAttribute('aria-expanded')).toBe('true');
    expect(text(page, `#${owner.getAttribute('aria-controls')}`)).toContain('Tom Ward');
    owner.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(owner.value).toBe('Tom Ward');
    const due = page.doc.querySelector(`[aria-label="Due date for action item ${n}"]`) as HTMLInputElement;
    due.value = '2026-10-20';
    due.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    const prio = page.doc.querySelector(`[aria-label="Priority for action item ${n}"]`) as HTMLSelectElement;
    prio.value = 'high';
    prio.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    await waitFor(() => status(page) === 'Saved', 'saved item', 12000);
    expect(pipeline.getRun(runId).minutes.actionItems.at(-1)).toMatchObject({ task: 'Write the release note', owner: 'Tom Ward', dueDate: '2026-10-20', priority: 'high', status: 'open' });

    // "Not an action item" → hidden list with Restore; Delete → Undo toast.
    (page.doc.querySelector('[aria-label="More actions for action item 1"]') as HTMLButtonElement).click();
    menuItem(page, 'Not an action item').click();
    await waitFor(() => text(page, '.ai-dismissed summary') === 'Not action items (1)', 'dismissed');
    (page.doc.querySelector('[aria-label="More actions for action item 1"]') as HTMLButtonElement).click();
    menuItem(page, 'Delete').click();
    await waitFor(() => text(page, '#toasts').includes('Action item deleted'), 'undo toast');
    const afterDelete = page.doc.querySelectorAll('.ai-list .ai-row').length;
    (page.doc.querySelector('#toasts .toast-action') as HTMLButtonElement).click();
    expect(page.doc.querySelectorAll('.ai-list .ai-row').length).toBe(afterDelete + 1);
    await waitFor(() => status(page) === 'Saved', 'saved', 12000);
    expect(pipeline.getRun(runId).minutes.actionItems).toHaveLength(before); // one dismissed, one deleted+restored, one added

    // Timestamp → transcript line highlighted (and the Transcript tab selected on phones).
    (page.doc.querySelector('.ai-row .time-link') as HTMLButtonElement).click();
    expect(page.doc.querySelectorAll('.transcript-line.is-highlighted')).toHaveLength(1);
    expect(page.doc.getElementById('tab-transcript')!.getAttribute('aria-selected')).toBe('true');
  });

  it('insert from transcript: a line becomes a quote with speaker and time', async () => {
    const { app, runId } = await server();
    const page = await open(app, runId);
    const firstTitle = titles(page)[0];
    (page.doc.querySelector('.transcript-time-btn') as HTMLButtonElement).click();
    menuItem(page, `Quote in “${firstTitle}”`).click();
    await waitFor(() => !!editors(page)[0].root.querySelector('blockquote'), 'quote inserted');
    expect(editors(page)[0].root.querySelector('blockquote').textContent).toMatch(/^“.+” — .+, 0:00$/);
    await waitFor(() => status(page) === 'Saved', 'saved', 12000);
    expect((await doc(app, runId)).content.sections[0].html).toContain('<blockquote>');
  });

  it('version history: compare with the AI draft, preview, restore (as a new version)', async () => {
    const { app, runId } = await server();
    const page = await open(app, runId);
    const original = editors(page)[0].getText();
    typeRich(editors(page)[0], ' Added by Sara.');
    await waitFor(() => status(page) === 'Saved', 'saved', 12000);
    (page.doc.getElementById('versionHistory') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.querySelector('.compare-section .diff-add'), 'compare view');
    expect(text(page, '.compare-section .diff-add')).toContain('Added by Sara.');
    expect(Array.from(page.doc.querySelectorAll('.version-item strong')).map((n) => n.textContent)).toEqual(['Current version', 'Version 1']);
    expect(text(page, '.version-list')).toContain('AI draft · AI');

    (page.doc.querySelectorAll('.version-item')[1] as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('restoreVersion'), 'preview with restore');
    (page.doc.getElementById('restoreVersion') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#toasts').includes('Restored version 1'), 'restored toast');
    await waitFor(() => editors(page).length > 0 && editors(page)[0].getText() === original, 'editor shows the AI text');
    const versions = (await request(app).get(`/api/minutes/${runId}/versions`)).body.versions;
    expect(versions[0]).toMatchObject({ kind: 'restore', restoredFrom: 1, author: 'Sara Lee' });
  });

  it('someone else’s newer save: “Tom Ward updated this draft. Reload” instead of overwriting', async () => {
    const { app, runId } = await server();
    const page = await open(app, runId);
    const d = await doc(app, runId);
    d.content.sections[0].html = '<p>Tom rewrote this.</p>';
    expect((await request(app).put(`/api/minutes/${runId}`).send({ content: d.content, baseRevision: 1, editedBy: 'Tom Ward' })).status).toBe(200);
    typeRich(editors(page)[0], ' Sara’s edit.');
    await waitFor(() => text(page, '.review-banners').includes('Tom Ward updated this draft.'), 'conflict banner', 12000);
    expect(status(page)).toBe('Not saved — newer version');
    expect((await doc(app, runId)).content.sections[0].html).toBe('<p>Tom rewrote this.</p>'); // nothing overwritten
    (page.doc.getElementById('conflictReload') as HTMLButtonElement).click();
    await waitFor(() => editors(page).length > 0 && editors(page)[0].getText().trim() === 'Tom rewrote this.', 'reloaded');
  });

  it('approved: read-only with “Approved by”; editing needs a reason, then “Send updated minutes”', async () => {
    const { app, runId, pipeline } = await server();
    await pipeline.approveMinutes(runId, 'Sara Lee');
    await pipeline.approveEmailsAndSend(runId, 'Sara Lee');
    const page = await open(app, runId);
    await waitFor(() => text(page, '.review-banners').includes('Approved by Sara Lee on'), 'approved banner');
    expect(editors(page)[0].root.getAttribute('contenteditable')).toBe('false');
    (page.doc.getElementById('editApproved') as HTMLButtonElement).click();
    (page.doc.getElementById('amendStart') as HTMLButtonElement).click();
    expect(text(page, '[role="dialog"] .help-error')).toBe('Say briefly why the approved minutes are being changed.');
    const reason = page.doc.getElementById('amendReason') as HTMLTextAreaElement;
    reason.value = 'Corrected the launch date';
    (page.doc.getElementById('amendStart') as HTMLButtonElement).click();
    await waitFor(() => text(page, '.review-banners').includes('Editing approved minutes.'), 'amending');
    await waitFor(() => editors(page)[0].root.getAttribute('contenteditable') === 'true', 'editable again');
    typeRich(editors(page)[0], ' Launch is Nov 3.');
    await waitFor(() => status(page) === 'Saved', 'saved amendment', 12000);
    expect(pipeline.getRun(runId).minutes.discussionTopics[0].summary).toContain('Launch is Nov 3.');
    (page.doc.getElementById('finishAmendment') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('sendUpdate'), 'send updated minutes offer');
    (page.doc.getElementById('sendUpdate') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#toasts').includes('Updated minutes drafted — not sent (draft-only mode)'), 'update toast');
    const versions = (await request(app).get(`/api/minutes/${runId}/versions`)).body.versions;
    expect(versions[0]).toMatchObject({ kind: 'amendment', reason: 'Corrected the launch date' });
  });

  it('AI help: a suggestion preview with “Keep mine” or “Replace” — never applied without a choice', async () => {
    const { app, runId } = await server();
    const page = await open(app, runId);
    const q = editors(page)[0];
    q.setContents(q.clipboard.convert({ html: '<p>One point. Two point. Three point. Four point.</p>' }), 'user');
    await waitFor(() => status(page) === 'Saved', 'saved', 12000);
    const aiButton = page.doc.querySelector('.md-ai') as HTMLButtonElement;
    expect(aiButton.getAttribute('aria-label')).toMatch(/^AI help for /);
    aiButton.click();
    menuItem(page, 'Make shorter').click();
    await waitFor(() => !!page.doc.getElementById('assistKeep'), 'suggestion');
    expect(text(page, '.assist-preview')).toBe('One point. Two point.');
    expect(text(page, '[role="dialog"]')).toContain('demo mode');
    (page.doc.getElementById('assistKeep') as HTMLButtonElement).click();
    expect(q.getText().trim()).toBe('One point. Two point. Three point. Four point.');

    (page.doc.querySelector('.md-ai') as HTMLButtonElement).click();
    menuItem(page, 'Make shorter').click();
    await waitFor(() => !!page.doc.getElementById('assistReplace'), 'suggestion again');
    (page.doc.getElementById('assistReplace') as HTMLButtonElement).click();
    expect(q.getText().trim()).toBe('One point. Two point.');
    await waitFor(() => status(page) === 'Saved', 'saved replacement', 12000);
    expect((await doc(app, runId)).content.sections[0].html).toBe('<p>One point. Two point.</p>');
    q.history.undo(); // Ctrl+Z brings the reviewer's text back
    expect(q.getText().trim()).toBe('One point. Two point. Three point. Four point.');
  });

  it('transcript corrections: rename a speaker, then “Update minutes with corrected names”', async () => {
    const { app, runId, pipeline } = await server();
    const page = await open(app, runId);
    const from = pipeline.getRun(runId).transcript[0].speakerLabel;
    (page.doc.getElementById('correctTranscript') as HTMLButtonElement).click();
    const input = page.doc.getElementById('rename-0') as HTMLInputElement;
    expect(text(page, 'label[for="rename-0"]')).toBe(`${from} →`);
    input.value = 'Priya Raman';
    (input.parentElement!.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#toasts').includes(`Renamed “${from}” to “Priya Raman”`), 'renamed toast');
    await waitFor(() => text(page, '.transcript-list').includes('Priya Raman'), 'transcript shows the new name');
    const action = page.doc.querySelector('#toasts .toast-action') as HTMLButtonElement;
    expect(action.textContent).toBe('Update minutes with corrected names');
    action.click();
    await waitFor(() => status(page) === 'Saved', 'minutes saved', 12000);
    const saved = (await doc(app, runId)).content;
    expect(saved.actionItems.map((a: { owner?: string }) => a.owner)).not.toContain(from); // current owners (the AI original is kept for comparison)
    expect(saved.sections.map((x: { html: string }) => x.html).join(' ')).not.toContain(from);
    expect(saved.actionItems.some((a: { owner?: string }) => a.owner === 'Priya Raman')).toBe(true);
    const versions = (await request(app).get(`/api/minutes/${runId}/versions`)).body.versions;
    expect(versions.some((v: { kind: string }) => v.kind === 'transcript_correction')).toBe(true);
  });

  it('shows who else has the draft open', async () => {
    const { app, runId } = await server();
    await request(app).post(`/api/minutes/${runId}/presence`).send({ viewerId: 'other-viewer-1', name: 'Tom Ward' });
    const page = await open(app, runId);
    await waitFor(() => text(page, '#presence').includes('Also viewing'), 'presence');
    expect(page.doc.getElementById('presence')!.getAttribute('aria-label')).toBe('Also viewing: Tom Ward');
    expect(page.doc.querySelector('#presence .avatar-stack')!.getAttribute('aria-label')).toBe('Tom Ward');
  });
});

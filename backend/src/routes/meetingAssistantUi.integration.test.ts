import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { chooseFile, openPage, Page, text, type, waitFor } from './__testutils__/pageHarness';

/** Redesigned app, end to end: real page scripts in jsdom + real Express app + real pipeline (stand-in providers, draft-only). */
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
  const samples = Buffer.alloc(4000);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 5) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

function server(dataDir: string, configure?: (p: ReturnType<typeof createDemoProviders>) => void) {
  // Deterministic stand-ins presented as real mode, so the page behaves as it does with Whisper + Claude.
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  configure?.(providers);
  const send = jest.spyOn(providers.emailDeliveryClient, 'send');
  return { app: createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores({ dataDir })) }), send };
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const title = (page: Page) => text(page, 'h1.page-title');
const primary = (page: Page) => page.doc.getElementById('primaryAction') as HTMLButtonElement;
const posts = (page: Page, suffix: string) => page.calls.filter((c) => c.startsWith('POST') && c.endsWith(suffix)).length;
/** A real double click: the same button pressed twice, even if the screen changes after the first press. */
const doubleClick = (b: HTMLButtonElement) => { b.click(); b.click(); };

async function uploadMeeting(page: Page, audio: Buffer) {
  await waitFor(() => title(page) === 'Meetings', 'the meetings page');
  primary(page).click();
  await waitFor(() => title(page) === 'Upload meeting', 'the upload page');
  chooseFile(page, 'standup.wav', audio);
  type(page, '#title', 'Project Progress');
  type(page, '#attendees', 'Million <million@example.com>, Priya <priya@example.com>');
  type(page, '#reviewer', 'Million');
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Meeting Assistant — redesigned app', () => {
  it('upload → processing → review with autosave → send confirmation → approved; lists, palette, theme, refresh; never sends', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ui2-journey-'));
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    const { app, send } = server(dataDir);
    const page = track(openPage(app));

    // Dashboard: friendly empty state, zeroed cards, draft-only mode explained.
    await waitFor(() => text(page, '.empty h2') === 'No meetings yet', 'the empty state');
    expect(text(page, '.stats')).toContain('Pending reviews0');
    await waitFor(() => text(page, '.mode-pill').includes('Draft-only mode'), 'the mode pill');

    // Upload: validation, then a single submission even when double-clicked.
    primary(page).click();
    await waitFor(() => title(page) === 'Upload meeting', 'upload');
    expect(primary(page).disabled).toBe(true);
    expect(text(page, '#primaryHelp')).toBe('To continue, add a recording, participants, your name.');
    chooseFile(page, 'notes.txt', Buffer.from('not audio'));
    expect(text(page, '.help-error')).toBe('That file type isn’t supported. Upload an MP3, WAV, M4A, MP4, WebM, or OGG recording.');
    (page.doc.querySelector('[aria-label="Remove notes.txt"]') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.querySelector('.dropzone'), 'the drop zone again');
    chooseFile(page, 'standup.wav', wav('ui2-journey'));
    type(page, '#title', 'Project Progress');
    type(page, '#attendees', 'Million <million@example.com>, Priya <priya@example.com>');
    type(page, '#reviewer', 'Million');
    expect(text(page, '.file-name')).toBe('standup.wav');
    expect(text(page, '#avatar')).toBe('M');
    doubleClick(primary(page));
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'the review screen');
    expect(posts(page, '/api/meetings/draft')).toBe(1);
    expect(title(page)).toBe('Project Progress');
    expect(text(page, '.page-header')).toContain('Needs review');
    expect(text(page, '.page-header')).toContain('Approval 1 of 2');

    // Inline edit + checkbox in the action items editor → autosave → saved on the server.
    await waitFor(() => !!page.doc.querySelector('[aria-label="Owner of action item 1"]'), 'the minutes editor');
    type(page, '[aria-label="Owner of action item 1"]', 'Priya');
    const done = page.doc.querySelector('[aria-label="Done: action item 1"]') as HTMLInputElement;
    done.checked = true;
    done.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    await waitFor(() => text(page, '#saveState') === 'Saved', 'autosave');
    const runId = new URL(page.dom.window.location.href).searchParams.get('run')!;
    const saved = (await request(app).get(`/api/meetings/${encodeURIComponent(runId)}`)).body;
    expect(saved.minutes.actionItems[0]).toMatchObject({ owner: 'Priya', status: 'done' });
    (page.doc.querySelector('.time-link') as HTMLButtonElement).click();
    expect(page.doc.querySelectorAll('.transcript-line.is-highlighted')).toHaveLength(1);

    // Approval 1 — double click sends one request, then the send confirmation.
    doubleClick(primary(page));
    await waitFor(() => title(page) === 'Review and send', 'the send confirmation');
    expect(posts(page, '/approve-minutes')).toBe(1);
    expect(primary(page).textContent).toBe('Approve (draft only)');
    expect(page.doc.querySelectorAll('.recipient')).toHaveLength(2);
    expect(text(page, '.email-to')).toBe('Million <million@example.com>');
    expect(text(page, '.email-subject')).toBe('Recap and action items: Project Progress');
    const body = page.doc.querySelector('.email-body')!.textContent!;
    expect(body.startsWith('Hi Million,')).toBe(true);
    (page.doc.getElementById('recipient-1') as HTMLButtonElement).click();
    await waitFor(() => text(page, '.email-to') === 'Priya <priya@example.com>', 'Priya');
    expect(page.doc.querySelector('.email-body')!.textContent).toContain('Your action items:');
    page.doc.getElementById('recipient-1')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await waitFor(() => text(page, '.email-to') === 'Million <million@example.com>', 'keyboard selection');

    // Back to review is read-only now.
    (page.doc.querySelector('.back-link') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review again');
    // Approved minutes are read-only: every field locked, editors read-only, and the lock explained.
    await waitFor(() => text(page, '.review-banners').includes('Minutes approved.'), 'locked banner');
    const fields = Array.from(page.doc.querySelectorAll('.minutes-panel input[type="text"]')) as HTMLInputElement[];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.readOnly)).toBe(true);
    expect(Array.from(page.doc.querySelectorAll('.minutes-panel .ql-editor')).every((e) => e.getAttribute('contenteditable') === 'false')).toBe(true);
    expect(page.doc.getElementById('addActionItem')).toBeNull();
    expect(primary(page).textContent).toBe('Review email');
    primary(page).click();
    await waitFor(() => title(page) === 'Review and send', 'send again');

    // Approval 2 — one request; draft-only toast; the email stays visible below the completion summary.
    doubleClick(primary(page));
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'the approved state');
    expect(posts(page, '/approve-emails')).toBe(1);
    expect(text(page, '#toasts')).toContain('Minutes approved — email not sent (draft-only mode)');
    expect(text(page, '#toasts')).not.toMatch(/sent to \d/i);
    const facts = text(page, '.final-approval');
    expect(facts).toMatch(/Approved bys*Million/);
    expect(facts).toMatch(/Emails*Not sent — draft-only mode/);
    expect(page.doc.querySelector('.email-body')!.textContent).toBe(body);
    expect(primary(page).textContent).toBe('Back to meetings');

    // Lists reflect it.
    primary(page).click();
    await waitFor(() => text(page, 'tbody').includes('Project Progress') && text(page, 'tbody').includes('Approved'), 'the refreshed meetings table');
    (page.doc.querySelectorAll('.nav-link')[1] as HTMLAnchorElement).click();
    await waitFor(() => title(page) === 'Action items' && text(page, 'tbody').includes('Priya'), 'action items');

    // Search (grouped dropdown): no-match state, then a match.
    type(page, '#search', 'zzz');
    await waitFor(() => text(page, '#searchPanel .search-empty').startsWith('No results for “zzz”'), 'no-match state');
    type(page, '#search', 'project');
    await waitFor(() => text(page, '#searchPanel .search-group').includes('Project Progress'), 'search match');

    // Ctrl K focuses the search; its Commands group reaches Settings → dark theme. The palette stays on its button.
    page.doc.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    expect(page.doc.activeElement).toBe(page.doc.getElementById('search'));
    type(page, '#search', 'settings');
    await waitFor(() => text(page, '#searchPanel').includes('Go to settings'), 'command in results');
    page.doc.getElementById('search')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => title(page) === 'Settings', 'settings via search commands');
    (page.doc.getElementById('paletteButton') as HTMLButtonElement).click();
    await waitFor(() => !(page.doc.getElementById('palette') as HTMLElement).hidden, 'the palette');
    page.doc.querySelector('.palette')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const dark = page.doc.getElementById('theme-dark') as HTMLInputElement;
    dark.checked = true;
    dark.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    expect(page.doc.documentElement.getAttribute('data-theme')).toBe('dark');

    // Refresh after a server restart reopens the approved email.
    const restarted = server(dataDir);
    const refreshed = track(openPage(restarted.app, `/?run=${encodeURIComponent(runId)}&view=send`));
    await waitFor(() => !!refreshed.doc.querySelector('.final-approval'), 'approved meeting after refresh');
    expect(refreshed.doc.querySelector('.email-body')!.textContent).toBe(body);

    expect(send).not.toHaveBeenCalled();
    expect(restarted.send).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    createTransport.mockRestore();
  });

  it('a failed step explains what happened, keeps the details, and Try again succeeds', async () => {
    let failOnce = true;
    const { app } = server(mkdtempSync(path.join(os.tmpdir(), 'ui2-retry-')), (providers) => {
      const real = providers.transcriptionClient.transcribe.bind(providers.transcriptionClient);
      providers.transcriptionClient.transcribe = async (input) => {
        if (failOnce) { failOnce = false; throw new Error('speech service unavailable'); }
        return real(input);
      };
    });
    const page = track(openPage(app));
    await uploadMeeting(page, wav('ui2-retry'));
    primary(page).click();
    await waitFor(() => !!page.doc.querySelector('.process-step.is-failed'), 'the failed step');
    expect(text(page, '.callout-danger')).toContain('Transcribing didn’t finish.');
    expect(text(page, '.process-step.is-done')).toBe('Uploaded');
    (Array.from(page.doc.querySelectorAll('button')).find((b) => b.textContent === 'Edit details') as HTMLButtonElement).click();
    await waitFor(() => title(page) === 'Upload meeting', 'edit details');
    expect(text(page, '.file-name')).toBe('standup.wav');
    primary(page).click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review after retry');
  });

  it('approval needs a name, and asks for it instead of submitting', async () => {
    const { app } = server(mkdtempSync(path.join(os.tmpdir(), 'ui2-name-')));
    const page = track(openPage(app));
    await uploadMeeting(page, wav('ui2-name'));
    primary(page).click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review');
    (page.dom.window as unknown as { MA: { store: { setForm: (p: object) => void } } }).MA.store.setForm({ reviewer: '' });
    primary(page).click();
    await waitFor(() => text(page, '#toasts').includes('Add your name'), 'the name prompt');
    expect(posts(page, '/approve-minutes')).toBe(0);
  });

  it('browser recordings are encoded as WAV the server accepts', async () => {
    const { app } = server(mkdtempSync(path.join(os.tmpdir(), 'ui2-wav-')));
    const page = track(openPage(app));
    const win = page.dom.window as unknown as { Float32Array: Float32ArrayConstructor; MA: { audio: { encodeWav: (s: Float32Array, r: number) => Uint8Array } } };
    const samples = new win.Float32Array(48000).map((_, i) => Math.sin(i / 20) * 0.5);
    const bytes = Buffer.from(win.MA.audio.encodeWav(samples, 48000));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.length).toBe(44 + 16000 * 2);
    const res = await request(app).post('/api/meetings/draft').field('attendees', 'Million').attach('audio', bytes, 'recording.wav');
    expect(res.status).toBe(201);
  });

  it('regression: an older approval saved without its draft does not skip review', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ui2-legacy-'));
    const audio = wav('ui2-legacy');
    const runId = `physical:room_mic:${createHash('sha256').update(audio).digest('hex')}`;
    writeFileSync(path.join(dataDir, 'final-approvals.json'), JSON.stringify({ [runId]: { approvedAt: '2026-10-04T01:43:29.170Z', approvedBy: 'Million', emailMode: 'draft-only' } }));
    writeFileSync(path.join(dataDir, 'tracker-log.json'), JSON.stringify({ [runId]: { id: runId, sendingReviewGateSessionId: runId, loggedItems: [], loggedAt: '2026-10-04T01:43:29.172Z' } }));
    const { app } = server(dataDir);
    const page = track(openPage(app));
    await uploadMeeting(page, audio);
    primary(page).click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review');
    primary(page).click();
    await waitFor(() => title(page) === 'Review and send', 'send confirmation');
    expect(text(page, '.email-subject')).toBe('Recap and action items: Project Progress');
  });
});

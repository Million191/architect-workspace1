import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { chooseFile, goToStep, openPage, Page, text, type, waitFor } from './__testutils__/pageHarness';

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
  it('upload → processing → review with autosave → send confirmation → reviewed; lists, search commands, theme, refresh; never sends', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ui2-journey-'));
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    const { app, send } = server(dataDir);
    const page = track(openPage(app));

    // Dashboard: friendly empty state, zeroed cards, draft-only mode explained.
    await waitFor(() => text(page, '.empty h2') === 'No meetings yet', 'the empty state');
    expect(text(page, '#pendingCard-value')).toBe('All caught up'); // zero pending reviews: no "0", a done state
    await waitFor(() => text(page, '.mode-pill').includes('Draft-only mode'), 'the mode pill');

    // Upload: validation, then a single submission even when double-clicked.
    primary(page).click();
    await waitFor(() => title(page) === 'Upload meeting', 'upload');
    expect(primary(page).disabled).toBe(true);
    expect(text(page, '#primaryHelp')).toBe('To continue, add a recording, participants, the reviewer.');
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
    await waitFor(() => !!page.doc.querySelector('.wf-steps'), 'the review screen');
    expect(posts(page, '/api/meetings/draft')).toBe(1);
    expect(title(page)).toBe('Project Progress');
    expect(text(page, '.page-header')).toContain('Needs review');
    // Guided steps: Meeting first; approval and email can't be opened yet (no skipping review).
    expect(page.doc.getElementById('wfStep-meeting')!.getAttribute('aria-current')).toBe('step');
    expect((page.doc.getElementById('wfStep-approval') as HTMLButtonElement).disabled).toBe(true);
    expect((page.doc.getElementById('wfStep-email') as HTMLButtonElement).disabled).toBe(true);
    const next = async (step: string) => {
      (page.doc.getElementById('wfNext') as HTMLButtonElement).click();
      await waitFor(() => page.doc.getElementById(`wfStep-${step}`)?.getAttribute('aria-current') === 'step', `the ${step} step`);
    };
    await next('transcript');
    await next('summary');
    // The review has no action-items step any more: Summary leads straight to Approval.
    expect(page.doc.getElementById('wfStep-decisions')).toBeNull();
    expect(page.doc.getElementById('addActionItem')).toBeNull();
    const runId = new URL(page.dom.window.location.href).searchParams.get('run')!;
    await next('approval');

    // Approval: Next waits for the explicit approval. Double click sends one request, then the email.
    expect((page.doc.getElementById('wfNext') as HTMLButtonElement).disabled).toBe(true);
    doubleClick(page.doc.getElementById('approveMinutes') as HTMLButtonElement);
    await waitFor(() => page.doc.getElementById('wfStep-email')?.getAttribute('aria-current') === 'step', 'the email step');
    expect(posts(page, '/approve-minutes')).toBe(1);
    expect(text(page, '.page-header')).toContain('Emails drafted');
    expect(primary(page).textContent).toBe('Approve draft');
    expect(text(page, '.callout-info')).toContain('Sending is disabled (draft-only mode).');
    expect(page.doc.querySelectorAll('.recipient')).toHaveLength(2);
    expect(text(page, '.email-to')).toBe('Million <million@example.com>');
    expect(text(page, '.email-subject')).toBe('Meeting recap: Project Progress');
    const body = page.doc.querySelector('.email-body')!.textContent!;
    expect(body.startsWith('Hi Million,')).toBe(true);
    (page.doc.getElementById('recipient-1') as HTMLButtonElement).click();
    await waitFor(() => text(page, '.email-to') === 'Priya <priya@example.com>', 'Priya');
    expect(page.doc.querySelector('.email-body')!.textContent).not.toContain('Your action items:'); // action items stay on the server, not in the email
    page.doc.getElementById('recipient-1')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await waitFor(() => text(page, '.email-to') === 'Million <million@example.com>', 'keyboard selection');

    // Back to review: the approved minutes are read-only now.
    (page.doc.getElementById('backToReview') as HTMLButtonElement).click();
    await waitFor(() => text(page, '.wf-card').includes('Minutes reviewed.'), 'approval step, reviewed');
    // The summary is shown (read-only) right below on the Review step.
    await waitFor(() => text(page, '.review-banners').includes('Minutes reviewed.') && !!page.doc.getElementById('summaryHeading'), 'locked banner');
    expect(Array.from(page.doc.querySelectorAll('.minutes-panel .ql-editor')).every((e) => e.getAttribute('contenteditable') === 'false')).toBe(true);
    // Still correctable, but only through the "approval again" warning (Edit Summary).
    expect(text(page, '#editStep')).toBe('Edit Summary');
    expect(text(page, '.wf-minutes .wf-head')).toContain('Editing it will require approval again.');
    (page.doc.getElementById('wfStep-email') as HTMLButtonElement).click();
    await waitFor(() => !!primary(page) && primary(page).textContent === 'Approve draft', 'email again');

    // Approval 2 — one request; draft-only: "Draft created — sending is disabled."; the email stays visible.
    doubleClick(primary(page));
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'the reviewed state');
    expect(posts(page, '/approve-emails')).toBe(1);
    expect(text(page, '#toasts')).toContain('Minutes reviewed — email not sent (draft-only mode)');
    expect(text(page, '#toasts')).not.toMatch(/sent to \d/i);
    const facts = text(page, '.final-approval');
    expect(facts).toContain('Draft created — sending is disabled.');
    expect(facts).toMatch(/Reviewed bys*Million/);
    expect(facts).toMatch(/Emails*Not sent — sending is disabled/);
    expect(page.doc.querySelector('.email-body')!.textContent).toBe(body);
    expect(text(page, '#wfDone')).toBe('Back to meetings');

    // Lists reflect it.
    (page.doc.getElementById('wfDone') as HTMLButtonElement).click();
    await waitFor(() => text(page, 'tbody').includes('Project Progress') && text(page, 'tbody').includes('Emails drafted'), 'the refreshed meetings table');
    // Action items aren't in the navigation any more (removed from the dashboard).
    expect(Array.from(page.doc.querySelectorAll('.nav-link .label-text')).map((n) => n.textContent)).toEqual(['Meetings', 'People', 'Settings']);

    // Search (grouped dropdown): no-match state, then a match.
    type(page, '#search', 'zzz');
    await waitFor(() => text(page, '#searchPanel .search-empty').startsWith('No results for “zzz”'), 'no-match state');
    type(page, '#search', 'project');
    await waitFor(() => text(page, '#searchPanel .search-group').includes('Project Progress'), 'search match');

    // Ctrl K focuses the search; its Commands group reaches Settings → dark theme.
    page.doc.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    expect(page.doc.activeElement).toBe(page.doc.getElementById('search'));
    type(page, '#search', 'settings');
    await waitFor(() => text(page, '#searchPanel').includes('Go to settings'), 'command in results');
    page.doc.getElementById('search')!.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => title(page) === 'Settings', 'settings via search commands');
    expect(page.doc.getElementById('paletteButton')).toBeNull(); // the search box replaces the old Commands palette
    const dark = page.doc.getElementById('theme-dark') as HTMLInputElement;
    dark.checked = true;
    dark.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    expect(page.doc.documentElement.getAttribute('data-theme')).toBe('dark');

    // Refresh after a server restart reopens the approved email.
    const restarted = server(dataDir);
    const refreshed = track(openPage(restarted.app, `/?run=${encodeURIComponent(runId)}&view=send`));
    await waitFor(() => !!refreshed.doc.querySelector('.final-approval'), 'reviewed meeting after refresh');
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
    await waitFor(() => !!page.doc.querySelector('.wf-steps'), 'review after retry');
  });

  it('approval needs a name, and asks for it instead of submitting', async () => {
    const { app } = server(mkdtempSync(path.join(os.tmpdir(), 'ui2-name-')));
    const page = track(openPage(app));
    await uploadMeeting(page, wav('ui2-name'));
    primary(page).click();
    await waitFor(() => !!page.doc.querySelector('.wf-steps'), 'review');
    (page.dom.window as unknown as { MA: { store: { setForm: (p: object) => void } } }).MA.store.setForm({ reviewer: '' });
    await goToStep(page, 'approval');
    expect((page.doc.getElementById('approverName') as HTMLInputElement).value).toBe('');
    (page.doc.getElementById('approveMinutes') as HTMLButtonElement).click();
    await waitFor(() => text(page, '#approverError').includes('Type your name'), 'the name prompt');
    expect(posts(page, '/approve-minutes')).toBe(0);
    type(page, '#approverName', 'Million');
    (page.doc.getElementById('approveMinutes') as HTMLButtonElement).click();
    await waitFor(() => posts(page, '/approve-minutes') === 1, 'reviewed with the typed name');
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
    await waitFor(() => !!page.doc.querySelector('.wf-steps'), 'review');
    expect(text(page, '.page-header')).toContain('Needs review');
    await goToStep(page, 'approval');
    (page.doc.getElementById('approveMinutes') as HTMLButtonElement).click();
    await waitFor(() => page.doc.getElementById('wfStep-email')?.getAttribute('aria-current') === 'step', 'email step');
    expect(text(page, '.email-subject')).toBe('Meeting recap: Project Progress');
  });
});

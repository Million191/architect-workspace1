import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createRecordingService } from '../services/recording/recordingService';
import { RecordingStore } from '../services/recording/recordingStore';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/**
 * Live in-person recording in the real page: setup + consent → recording → chunks uploaded every few
 * seconds → a network drop and recovery → pause, marker → leave and return → Stop → processing →
 * review with the marker in the transcript. Browser media APIs are faked (jsdom has none).
 */
function server(schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() })): Express {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  return createApp({
    meetingPipeline: createMeetingPipeline(providers, createPipelineStores()),
    schedule,
    people: createPeopleService({ store: new Map<string, PersonRecord>() }),
    recordings: createRecordingService({ store: new RecordingStore(mkdtempSync(path.join(os.tmpdir(), 'rec-ui-'))) }),
    email: { mode: 'draft-only', deliver: providers.emailDeliveryClient },
  });
}

interface FakeRec { emit(): void; state: string }
type FakeWin = Window & { __rec?: FakeRec; __offline?: boolean; __shareAudio?: boolean; __chunkPuts: number; [k: string]: unknown };

/** Fake microphone, AudioContext, and MediaRecorder (chunks emitted on demand), plus a switchable network drop. */
function installMedia(page: Page) {
  const w = page.dom.window as unknown as FakeWin;
  const track = () => ({ stop: () => undefined, addEventListener: () => undefined });
  const stream = () => ({ getAudioTracks: () => [track()], getVideoTracks: () => [], getTracks: () => [track()] });
  Object.defineProperty(w.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => stream(),
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Desk microphone' }],
    // Tab capture: the test decides whether "Share tab audio" was turned on.
    getDisplayMedia: async () => (w.__shareAudio === false ? { getAudioTracks: () => [], getVideoTracks: () => [track()], getTracks: () => [track()] } : { getAudioTracks: () => [track()], getVideoTracks: () => [track()], getTracks: () => [track(), track()] }),
  } });
  (w as unknown as { MediaStream: unknown }).MediaStream = class { constructor(public tracks: unknown[]) {} };
  w.AudioContext = class {
    createMediaStreamSource() { return { connect: () => undefined }; }
    createMediaStreamDestination() { return { stream: {} }; }
    createAnalyser() { return { fftSize: 0, connect: () => undefined, getByteTimeDomainData: (a: Uint8Array) => a.fill(160) }; }
    close() { return Promise.resolve(); }
  };
  let n = 0;
  w.MediaRecorder = class {
    static isTypeSupported(t: string) { return t === 'audio/webm;codecs=opus'; }
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = 'recording'; w.__rec = this; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.emit(); this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
    emit() {
      // The first chunk carries the WebM (EBML) header, like a real MediaRecorder stream.
      const bytes = n === 0 ? Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]) : Uint8Array.from([n, n, n, n]);
      n++;
      this.ondataavailable?.({ data: new (w.Blob as typeof Blob)([bytes]) });
    }
  };
  w.__chunkPuts = 0;
  const realFetch = w.fetch.bind(w);
  (w as unknown as { fetch: unknown }).fetch = (url: string, o: { method?: string } = {}) => {
    if (o.method === 'PUT' && url.includes('/chunks/')) {
      if (w.__offline) return Promise.reject(new TypeError('Failed to fetch'));
      w.__chunkPuts++;
    }
    return realFetch(url, o as RequestInit);
  };
  return w;
}

const pages: Page[] = [];
const track = (p: Page) => (pages.push(p), p);
const byId = <T extends HTMLElement>(page: Page, id: string) => page.doc.getElementById(id) as T;
const click = (page: Page, id: string) => byId<HTMLButtonElement>(page, id).click();
const typeInto = (page: Page, id: string, value: string) => { const i = byId<HTMLInputElement>(page, id); i.value = value; i.dispatchEvent(new page.dom.window.Event('input', { bubbles: true })); };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Live in-person recording', () => {
  it('records, survives a network drop, pauses, marks, and becomes a meeting ready for review', async () => {
    const app = server();
    const page = track(openPage(app, '/'));
    const w = installMedia(page);
    await waitFor(() => !!byId(page, 'recordMeeting'), 'meetings');
    click(page, 'recordMeeting');
    (page.doc.querySelectorAll('[role="menuitem"]')[0] as HTMLButtonElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Record an in-person meeting', 'setup');
    expect(text(page, '.rec-setup')).toContain('Place your device in the middle of the table');

    // Consent is required before Start works.
    const start = byId<HTMLButtonElement>(page, 'primaryAction');
    expect(start.disabled).toBe(true);
    const consent = byId<HTMLInputElement>(page, 'recConsent');
    consent.checked = true;
    consent.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    expect(start.disabled).toBe(false);
    typeInto(page, 'recTitle', 'Ops standup');
    typeInto(page, 'recPeople', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>');

    click(page, 'recCheckMic');
    await waitFor(() => text(page, '#recMic').includes('Desk microphone'), 'device list');

    click(page, 'primaryAction');
    await waitFor(() => text(page, '#recState') === 'Recording', 'recording screen');
    await waitFor(() => text(page, '#recAnnounce') === 'Recording started.', 'announced');
    expect(byId(page, 'recLevel').getAttribute('role')).toBe('meter');
    await waitFor(() => page.doc.title.startsWith('● Recording – '), 'tab title');
    await waitFor(() => page.calls.includes('POST /api/recordings'), 'created on the server');

    // First chunk uploads.
    w.__rec!.emit();
    await waitFor(() => w.__chunkPuts === 1 && text(page, '#recUpload') === 'All audio so far is safely on the server.', 'chunk 0 safe');

    // Network drop: the chunk waits on the device and the page says so; back online → it uploads.
    w.__offline = true;
    w.__rec!.emit();
    await waitFor(() => text(page, '#recUpload').startsWith('Connection trouble — retrying. 1 part waiting'), 'retrying');
    w.__offline = false;
    page.dom.window.dispatchEvent(new page.dom.window.Event('online'));
    await waitFor(() => w.__chunkPuts === 2 && text(page, '#recUpload') === 'All audio so far is safely on the server.', 'recovered');

    // Pause / resume.
    click(page, 'recPause');
    await waitFor(() => text(page, '#recState') === 'Paused', 'paused');
    expect(w.__rec!.state).toBe('paused');
    expect(page.doc.activeElement!.id).toBe('recPause');
    await waitFor(() => page.doc.title.startsWith('❚❚ Paused – '), 'paused title');
    click(page, 'recPause');
    await waitFor(() => text(page, '#recState') === 'Recording', 'resumed');

    // Marker.
    click(page, 'recMarker');
    const note = byId<HTMLInputElement>(page, 'recMarkerNote');
    note.value = 'Budget decision';
    note.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => text(page, '.rec-markers').includes('Budget decision'), 'marker listed');

    // Leaving the page keeps recording, with an indicator on every page.
    (Array.from(page.doc.querySelectorAll('.nav-link')).find((a) => a.querySelector('.label-text')?.textContent === 'Action items') as HTMLAnchorElement).click();
    await waitFor(() => text(page, 'h1.page-title') === 'Action items', 'another page');
    expect(byId(page, 'recPill').hidden).toBe(false);
    expect(byId(page, 'recPill').getAttribute('aria-label')).toBe('Recording in progress — return to the recorder');
    click(page, 'recPill');
    await waitFor(() => text(page, '#recState') === 'Recording', 'back to the recorder');

    // Stop → processing → review; the marker shows in the transcript.
    click(page, 'recStop');
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review', 15000);
    expect(text(page, 'h1.page-title')).toBe('Ops standup');
    await waitFor(() => text(page, '.transcript-list').includes('Budget decision'), 'marker in transcript');
    expect(page.doc.querySelector('.transcript-marker')!.getAttribute('aria-label')).toMatch(/^Marker at \d+:\d{2}: Budget decision$/);
    expect(byId(page, 'recPill').hidden).toBe(true);
    expect(page.doc.title).not.toContain('Recording');

    const runId = new URL(page.dom.window.location.href).searchParams.get('run')!;
    const saved = (await request(app).get(`/api/recordings/by-run/${runId}`)).body;
    expect(saved).toMatchObject({ status: 'ready', chunks: [0, 1, 2], mode: 'in_person', attendees: [{ name: 'Sara Lee', email: 'sara@x.io' }, { name: 'Tom Ward', email: 'tom@x.io' }] });
    expect(saved.consent.confirmedAt).toBeDefined();
  });

  it('a recording left behind by a crash can be uploaded and processed from the Meetings page', async () => {
    const app = server();
    const page = track(openPage(app, '/'));
    const w = installMedia(page);
    await waitFor(() => !!byId(page, 'recordMeeting'), 'meetings');
    const MA = (w as unknown as { MA: { chunks: { local: { putRecording(r: object): Promise<void>; putChunk(id: string, i: number, b: Blob): Promise<void> } }; app: { actions: { recFindUnfinished(): Promise<void> } } } }).MA;
    const id = '0f0e0d0c-aaaa-4bbb-8ccc-111122223333';
    await MA.chunks.local.putRecording({ id, mode: 'in_person', startedAt: new Date().toISOString(), chunkCount: 1, durationMs: 65000, markers: [], finished: false, title: 'Crashed meeting',
      serverBody: { id, mode: 'in_person', title: 'Crashed meeting', attendees: 'Sara <sara@x.io>', mimeType: 'audio/webm', consent: true } });
    await MA.chunks.local.putChunk(id, 0, new (w.Blob as typeof Blob)([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 9, 9])]));
    await MA.app.actions.recFindUnfinished();
    await waitFor(() => text(page, '.recovered').includes('Unfinished recording — Crashed meeting.'), 'recovery banner');
    expect(text(page, '.recovered')).toContain('1:05 recorded and saved on this device');
    (Array.from(page.doc.querySelectorAll('.recovered button')).find((b) => b.textContent === 'Upload and process') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'processed into review', 15000);
    expect(text(page, 'h1.page-title')).toBe('Crashed meeting');
    expect(page.doc.querySelector('.recovered')).toBeNull();
  });
});

describe('Online meeting on this computer + Start recording from the calendar', () => {
  it('a meeting happening now offers Start recording; the online recorder guides, captures tab + mic, and links the meeting', async () => {
    const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
    const now = Date.now();
    const live = schedule.create({ title: 'Customer call', start: new Date(now - 10 * 60000).toISOString(), end: new Date(now + 50 * 60000).toISOString(),
      participants: [{ name: 'Ann Bo', email: 'ann@client.io' }], link: 'https://acme.zoom.us/j/123' }).meeting;
    schedule.create({ title: 'Tomorrow sync', start: new Date(now + 26 * 3600000).toISOString(), end: new Date(now + 27 * 3600000).toISOString(), participants: [] });
    const app = server(schedule);
    const page = track(openPage(app, '/'));
    const w = installMedia(page);

    await waitFor(() => text(page, '.now-banner').includes('Customer call'), 'happening-now banner');
    expect(text(page, '.now-banner')).toContain('Zoom');
    expect(text(page, '.now-banner')).not.toContain('Tomorrow sync');
    (page.doc.querySelector('.now-banner button[aria-haspopup="menu"]') as HTMLButtonElement).click();
    const labels = Array.from(page.doc.querySelectorAll('[role="menu"] .menu-label')).map((n) => n.textContent);
    expect(labels).toEqual(['Online meeting on this computer', 'In-person meeting']); // a meeting link → online first
    (page.doc.querySelector('[role="menuitem"]') as HTMLButtonElement).click();

    await waitFor(() => text(page, 'h1.page-title') === 'Record an online meeting', 'online setup');
    expect(byId<HTMLInputElement>(page, 'recTitle').value).toBe('Customer call');
    expect(byId<HTMLInputElement>(page, 'recPeople').value).toBe('Ann Bo <ann@client.io>');
    expect(text(page, '.rec-steps')).toContain('turn on “Share tab audio”');
    expect(text(page, '.page-header')).toContain('attached to this calendar meeting');

    const consent = byId<HTMLInputElement>(page, 'recConsent');
    consent.checked = true;
    consent.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));

    // Shared without audio → a clear explanation, nothing recorded.
    w.__shareAudio = false;
    click(page, 'primaryAction');
    await waitFor(() => text(page, '.callout-danger').includes('No meeting audio was shared'), 'no-audio explanation');
    expect(page.calls.includes('POST /api/recordings')).toBe(false);

    // Shared with audio → records.
    w.__shareAudio = true;
    click(page, 'primaryAction');
    await waitFor(() => text(page, '#recState') === 'Recording', 'recording');
    expect(text(page, '.page-header')).toContain('Online meeting on this computer');
    w.__rec!.emit();
    await waitFor(() => w.__chunkPuts === 1, 'chunk uploaded');
    click(page, 'recStop');
    await waitFor(() => !!page.doc.getElementById('transcriptHeading'), 'review', 15000);
    expect(text(page, 'h1.page-title')).toBe('Customer call');

    // Linked to the calendar meeting; the banner no longer offers it.
    const runId = new URL(page.dom.window.location.href).searchParams.get('run')!;
    expect(schedule.get(live.id).runId).toBe(runId);
    expect((await request(app).get(`/api/recordings/by-run/${runId}`)).body).toMatchObject({ mode: 'browser_capture', scheduledMeetingId: live.id });
  });

  it('meeting details show Start recording only from 5 minutes before the start until the end', async () => {
    const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
    const now = Date.now();
    schedule.create({ title: 'Soon', start: new Date(now + 3 * 60000).toISOString(), end: new Date(now + 33 * 60000).toISOString(), participants: [] });
    schedule.create({ title: 'Later', start: new Date(now + 20 * 60000).toISOString(), end: new Date(now + 50 * 60000).toISOString(), participants: [] });
    const page = track(openPage(server(schedule), '/'));
    installMedia(page);
    const MA = (page.dom.window as unknown as { MA: { cal: { recordable(m: object, now?: Date): boolean } } }).MA;
    const at = (startMin: number, endMin: number, extra: object = {}) => ({ start: new Date(now + startMin * 60000).toISOString(), end: new Date(now + endMin * 60000).toISOString(), display: 'upcoming', ...extra });
    expect(MA.cal.recordable(at(3, 33))).toBe(true);
    expect(MA.cal.recordable(at(20, 50))).toBe(false);
    expect(MA.cal.recordable(at(-60, -1))).toBe(false);
    expect(MA.cal.recordable(at(-5, 30, { display: 'cancelled' }))).toBe(false);
    expect(MA.cal.recordable(at(-5, 30, { runId: 'r1' }))).toBe(false);
    await waitFor(() => text(page, '.now-banner').includes('Soon'), 'banner');
    expect(text(page, '.now-banner')).toMatch(/Starts at /);
    expect(text(page, '.now-banner')).not.toContain('Later');
  });
});

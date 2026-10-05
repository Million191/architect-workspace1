import { Express } from 'express';
import { createApp } from '../server';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createMeetingBotService, MeetingBotService } from '../services/meetingBot/meetingBotService';
import { createDemoBotClient } from '../services/meetingBot/demoBotClient';
import { BotSession } from '../services/meetingBot/types';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/**
 * The notetaker in the real page: "Send notetaker" switch on a meeting happening now → consent →
 * Joining → Waiting to be admitted → Recording (top-bar pill, screen-reader announcement) → Stop
 * recording → Processing → Ready for review → the meeting opens. The simulated bot's clock is the test's.
 */
function setup(opts: { configured?: boolean } = {}) {
  let clock = Date.now();
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const bots = createMeetingBotService({ store: new Map<string, BotSession>(), client: opts.configured === false ? undefined : createDemoBotClient({ now: () => clock, stepMs: 1000 }), pipeline, schedule });
  const settings = new Map<string, string>();
  const app: Express = createApp({ meetingPipeline: pipeline, schedule, bots, settings, people: createPeopleService({ store: new Map<string, PersonRecord>() }), email: { mode: 'draft-only', deliver: providers.emailDeliveryClient } });
  const m = schedule.create({ title: 'Board call', start: new Date(clock - 5 * 60_000).toISOString(), end: new Date(clock + 55 * 60_000).toISOString(), link: 'https://zoom.us/j/999', participants: [{ name: 'Sara Lee', email: 'sara@acme.com' }] }).meeting;
  return { app, bots, settings, meeting: m, advance: (ms: number) => { clock += ms; } };
}

type Win = Window & { MA: { app: { actions: Record<string, (...a: unknown[]) => Promise<unknown>> } } };
const actions = (page: Page) => (page.dom.window as unknown as Win).MA.app.actions;
/** Polls the bot like the server's fallback loop would, then has the page refresh. */
async function tick(page: Page, bots: MeetingBotService) {
  await bots.reconcile();
  await actions(page).notetakerRefresh();
}
const q = (page: Page, sel: string) => page.doc.querySelector(sel) as HTMLElement | null;

let page: Page | undefined;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { page?.close(); page = undefined; });

describe('notetaker in the page', () => {
  it('send with consent → live status → stop → processed into review', async () => {
    const s = setup();
    page = openPage(s.app);
    const p = page;
    await waitFor(() => !!q(p, '.now-banner [role=switch]'), 'switch in the happening-now banner');
    const sw = q(p, '.now-banner [role=switch]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(text(p, '.now-banner')).toContain('Send notetaker');
    expect(q(p, '.now-banner .platform-logo')?.getAttribute('title')).toBe('Zoom');

    // Consent is required: the Send button stays disabled until the box is checked.
    sw.click();
    await waitFor(() => !!q(p, '#botConsent'), 'consent dialog');
    const send = q(p, '#botConsentSend') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    send.click();
    expect(p.calls.some((c) => c.startsWith('POST /api/notetaker/sessions'))).toBe(false);
    (q(p, '#botConsent') as HTMLInputElement).click();
    expect(send.disabled).toBe(false);
    send.click();
    await waitFor(() => text(p, '.now-banner').includes('Joining'), 'Joining status');
    expect(q(p, '.now-banner [role=switch]')?.getAttribute('aria-checked')).toBe('true');

    s.advance(1500);
    await tick(p, s.bots);
    await waitFor(() => text(p, '.now-banner').includes('Waiting to be admitted'), 'waiting room');
    expect(text(p, '#botAnnounce')).toBe('');
    await waitFor(() => text(p, '#botAnnounce').includes('Board call: Waiting to be admitted'), 'announcement');

    s.advance(1500);
    await tick(p, s.bots);
    await waitFor(() => text(p, '.now-banner').includes('Recording'), 'recording');
    expect((q(p, '#botPill') as HTMLElement).hidden).toBe(false);
    expect(text(p, '#botPill')).toContain('Notetaker recording · Board call');

    // Stop recording asks first, then the bot leaves and the recording is processed.
    (q(p, '.now-banner [role=switch]') as HTMLButtonElement).click();
    await waitFor(() => !!q(p, '#botStopConfirm'), 'stop confirmation');
    (q(p, '#botStopConfirm') as HTMLButtonElement).click();
    await waitFor(() => text(p, '.now-banner').includes('Processing'), 'processing');
    expect((q(p, '#botPill') as HTMLElement).hidden).toBe(true);

    await tick(p, s.bots);
    await waitFor(() => !!Array.from(p.doc.querySelectorAll('.toast')).find((t) => t.textContent?.includes('ready for review')), 'ready toast');
    const open = Array.from(p.doc.querySelectorAll('.toast-action')).find((b) => b.textContent === 'Open') as HTMLButtonElement;
    open.click();
    await waitFor(() => (page as Page).doc.querySelector('.page-title')?.textContent === 'Board call', 'review of the recorded meeting', 10000);
  });

  it('explains a failure in words (not admitted from the waiting room)', async () => {
    const s = setup();
    page = openPage(s.app);
    const p = page;
    await waitFor(() => !!q(p, '.now-banner [role=switch]'), 'switch');
    const sess = await s.bots.send({ scheduledMeetingId: s.meeting.id, consent: true });
    await s.bots.handleEvent({ providerBotId: sess.providerBotId as string, sessionId: sess.id, code: 'call_ended', subCode: 'bot_kicked_from_waiting_room' });
    await actions(p).notetakerRefresh();
    await waitFor(() => text(p, '.now-banner').includes('Notetaker failed'), 'failed status');
    expect(text(p, '.now-banner [role=alert]')).toBe('The host didn’t admit the notetaker from the waiting room.');
  });

  it('Settings: automatic sending needs consent; not configured explains what to set', async () => {
    const s = setup();
    page = openPage(s.app, '/?page=settings');
    const p = page;
    await waitFor(() => !!q(p, '#notetakerAuto'), 'auto switch');
    (q(p, '#notetakerAuto') as HTMLButtonElement).click();
    await waitFor(() => !!q(p, '#botConsent'), 'consent dialog');
    (q(p, '#botConsent') as HTMLInputElement).click();
    (q(p, '#botConsentSend') as HTMLButtonElement).click();
    await waitFor(() => q(p, '#notetakerAuto')?.getAttribute('aria-checked') === 'true', 'auto on');
    expect(JSON.parse(s.settings.get('notetaker') as string)).toMatchObject({ autoSendToSynced: true });

    page.close();
    const off = setup({ configured: false });
    page = openPage(off.app, '/?page=settings');
    const p2 = page;
    await waitFor(() => text(p2, '.settings-grid').includes('RECALL_API_KEY'), 'not configured note');
    expect(q(p2, '#notetakerAuto')).toBeNull();
  });
});

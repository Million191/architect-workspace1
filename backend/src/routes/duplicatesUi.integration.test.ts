import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, waitFor } from './__testutils__/pageHarness';

/** Dashboard counts: each meeting once in the table, the tab badges and the Meetings card. */
let page: Page | undefined;
afterEach(() => page?.close());
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('a repeated meeting and a failed recording being processed again are each counted once', async () => {
  const pipeline = createMeetingPipeline(Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const }), createPipelineStores());
  page = openPage(createApp({ meetingPipeline: pipeline }), '/');
  const win = page.dom.window as unknown as { MA: { store: { set(p: object): void; get(): { upload: object } }; app: { actions: { dashSetTab(t: string): void } } } };
  await waitFor(() => !!page!.doc.querySelector('.page-title'), 'dashboard');
  const today = new Date().toISOString();
  const row = (over: object) => ({ title: 'Kickoff', date: today.slice(0, 10), time: today.slice(11, 16), participants: [], people: [], actionItemCount: 0, ...over });
  win.MA.store.set({
    meetings: [
      row({ runId: 'r1', status: 'needs_review', stage: 'minutes_pending_approval' }),
      row({ runId: 'r1', status: 'needs_review', stage: 'minutes_pending_approval' }), // same meeting twice in the list
      row({ runId: null, recordingId: 'rec-1', title: 'Board call', status: 'failed', stage: 'failed' }),
    ],
    upload: Object.assign({}, win.MA.store.get().upload, { id: 'rec-1', recordingId: 'rec-1', title: 'Board call', startedAt: Date.now() }),
    page: 'meetings',
  });
  win.MA.app.actions.dashSetTab('all');
  await waitFor(() => page!.doc.querySelectorAll('.meetings-table tbody tr').length > 0, 'table rows');
  const rows = [...page.doc.querySelectorAll('.meetings-table tbody tr')].map((r) => r.textContent ?? '');
  expect(rows).toHaveLength(2); // Kickoff once + Board call (processing) once
  expect(rows.filter((t) => t.includes('Board call'))).toHaveLength(1);
  expect(page.doc.getElementById('meetingsCard-value')?.textContent ?? page.doc.querySelector('.stat-value')?.textContent).toBe('2');
});

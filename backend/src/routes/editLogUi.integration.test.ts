import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** Summary step: the edit log keeps the original AI draft and a new version for every Edit → Save; the approval step is called "Review". */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 7), Buffer.from(salt)]);
}
type Q = { insertText(i: number, t: string, s: string): void; getLength(): number };
type W = { MA: { store: { setForm(p: object): void }; review: { sections: { editors: Record<string, Q> } } } };

let page: Page | undefined;
afterEach(() => page?.close());
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('the Summary shows an edit log: the original first, then a new version for each Edit → Save changes', async () => {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const app = createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()) });
  const runId = (await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>').field('title', 'Log test').attach('audio', wav('log-1'), 'm.wav')).body.runId as string;
  page = openPage(app, `/?run=${encodeURIComponent(runId)}&view=review&step=summary`);
  const w = page.dom.window as unknown as W;
  w.MA.store.setForm({ reviewer: 'Sara Lee' });
  await waitFor(() => text(page!, '.edit-log').includes('Original (AI draft)'), 'edit log with the original');
  expect(Array.from(page.doc.querySelectorAll('.wf-step .wf-label')).map((n) => n.textContent)).toEqual(['Meeting', 'Transcript', 'Summary', 'Review', 'Email']);
  expect(text(page, '.edit-log')).toContain('The original summary is saved before anything is edited.');

  const editOnce = async (words: string) => {
    (page!.doc.getElementById('editStep') as HTMLButtonElement).click();
    await waitFor(() => Object.keys(w.MA.review.sections.editors).length > 0 && !!page!.doc.getElementById('editSave'), 'edit mode');
    const q = Object.values(w.MA.review.sections.editors)[0];
    q.insertText(q.getLength() - 1, words, 'user');
    (page!.doc.getElementById('editSave') as HTMLButtonElement).click();
    await waitFor(() => !page!.doc.getElementById('editSave'), 'saved');
  };
  // The Summary step is read-only; edits are made on the Review step.
  const goStep = (step: string) => (page!.dom.window as unknown as { MA: { app: { actions: { goStep(s: string, o: object): Promise<void> } } } }).MA.app.actions.goStep(step, { force: true });
  expect(page.doc.getElementById('editStep')).toBeNull();
  await goStep('approval');
  await waitFor(() => !!page!.doc.getElementById('editStep'), 'Review step');
  await editOnce(' First change.');
  await editOnce(' Second change.'); // same person, seconds later: still its own version
  await goStep('summary');
  const versions = (await request(app).get(`/api/minutes/${encodeURIComponent(runId)}/versions`)).body.versions as Array<{ kind: string }>;
  expect(versions.map((v) => v.kind)).toEqual(['edit', 'edit', 'ai_draft']);
  await waitFor(() => page!.doc.querySelectorAll('.edit-log-item').length === 3, 'three entries in the log');
  expect(text(page, '.edit-log-item.is-original')).toContain('version 1');
  expect(text(page, '.edit-log-list')).toContain('Edited by Sara Lee');
});

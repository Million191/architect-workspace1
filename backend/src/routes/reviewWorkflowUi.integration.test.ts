import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { EmailMode } from '../services/meetingPipeline/types';
import { openPage, Page, text, type, waitFor } from './__testutils__/pageHarness';

/**
 * The guided review in the real page: step bar + Back / Next (work kept), Edit / Cancel / Save changes,
 * a transcript correction carried into the minutes, participant renames, Request changes, approval
 * gating, email edit + draft-only wording, delete with confirmation, and the sidebar safety message.
 */
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
function server(emailMode: EmailMode = 'draft-only'): { app: express.Express; pipeline: MeetingPipeline; outbox: ReturnType<typeof createDemoProviders>['outbox'] } {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  return { pipeline, outbox: providers.outbox, app: createApp({ meetingPipeline: pipeline, email: { mode: emailMode, deliver: providers.emailDeliveryClient } }) };
}
async function draft(app: express.Express, title: string, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>').field('title', title).attach('audio', wav(salt), 'm.wav');
  return res.body.runId as string;
}

const pages: Page[] = [];
const track = (p: Page) => { pages.push(p); return p; };
const byId = (page: Page, id: string) => page.doc.getElementById(id) as HTMLButtonElement;
const current = (page: Page) => page.doc.querySelector('.wf-step[aria-current="step"]')?.id.replace('wfStep-', '');
async function next(page: Page, step: string) {
  byId(page, 'wfNext').click();
  await waitFor(() => current(page) === step, `the ${step} step`);
}
async function back(page: Page, step: string) {
  byId(page, 'wfBack').click();
  await waitFor(() => current(page) === step, `back to ${step}`);
}
type W = { MA: { store: { setForm(p: object): void }; minutes: { get(): { content: { sections: Array<{ html: string; kind: string }> } } }; review: { sections: { editors: Record<string, { insertText(i: number, t: string, s: string): void; getText(): string }> } } } };
const win = (page: Page) => page.dom.window as unknown as W;
async function goToStepIn(page: Page, step: string) {
  (page.doc.getElementById(`wfStep-${step}`) as HTMLButtonElement).click();
  await waitFor(() => current(page) === step, `the ${step} step`);
}
const firstEditor = (page: Page) => Object.values(win(page).MA.review.sections.editors)[0];

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Guided review', () => {
  it('Back / Next through the steps keeps every saved edit; Edit → Cancel undoes, Save changes keeps', async () => {
    const { app, pipeline } = server();
    const runId = await draft(app, 'Budget review', 'wf-1');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review`));
    win(page).MA.store.setForm({ reviewer: 'Sara Lee' });
    await waitFor(() => current(page) === 'meeting', 'Meeting step');
    expect(Array.from(page.doc.querySelectorAll('.wf-step .wf-label')).map((n) => n.textContent)).toEqual(['Meeting', 'Transcript', 'Summary', 'Review', 'Email']);
    expect(byId(page, 'wfStep-approval').disabled).toBe(true);
    expect(byId(page, 'wfStep-email').disabled).toBe(true);

    // Transcript: Edit → fix a word → Save changes; the same word is fixed in the minutes.
    await next(page, 'transcript');
    byId(page, 'editStep').click();
    await waitFor(() => !!page.doc.getElementById('line-0'), 'transcript editor');
    const line = page.doc.getElementById('line-0') as HTMLTextAreaElement;
    expect(line.value).toContain('launch');
    line.value = line.value.replace('launch', 'release');
    line.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    byId(page, 'editSave').click();
    await waitFor(() => text(page, '#toasts').includes('the same correction was made in the minutes'), 'saved transcript');
    expect(text(page, '.transcript-list')).toContain('review the release timeline');
    await waitFor(() => pipeline.getRun(runId).minutes.discussionTopics.some((t) => /release moves to month end/.test(t.summary)), 'minutes corrected on the server');
    expect(text(page, '.page-header')).toContain('In progress');

    // Summary: read-only, with the recording and the transcript; no Edit here.
    await next(page, 'summary');
    expect(page.doc.querySelector('.minutes-panel .ql-editor')!.getAttribute('contenteditable')).toBe('false');
    expect(page.doc.getElementById('editStep')).toBeNull();
    expect(page.doc.querySelector('.md-section [id^="editSection-"]')).toBeNull();
    expect(page.doc.getElementById('meetingAudio')).not.toBeNull();
    expect(text(page, '.transcript-panel')).toContain('review the release timeline');
    // Review: the summary is edited here — Cancel puts it back; Save changes keeps it.
    await next(page, 'approval');
    byId(page, 'editStep').click();
    await waitFor(() => page.doc.querySelector('.minutes-panel .ql-editor')?.getAttribute('contenteditable') === 'true', 'editable');
    firstEditor(page).insertText(0, 'TEMP ', 'user');
    byId(page, 'editCancel').click();
    await waitFor(() => !page.doc.getElementById('editCancel') && !firstEditor(page).getText().startsWith('TEMP'), 'cancelled');
    byId(page, 'editStep').click();
    await waitFor(() => !!page.doc.getElementById('editSave'), 'editing again');
    firstEditor(page).insertText(0, 'Reviewed: ', 'user');
    byId(page, 'editSave').click();
    await waitFor(() => text(page, '#toasts').includes('Changes saved'), 'saved');
    expect(pipeline.getRun(runId).minutes.discussionTopics[0].summary.startsWith('Reviewed: ')).toBe(true);

    // Back to Summary: the saved text is shown there.
    await back(page, 'summary');
    expect(firstEditor(page).getText().startsWith('Reviewed: ')).toBe(true);
    await back(page, 'transcript');
    expect(text(page, '.transcript-list')).toContain('review the release timeline');
    // Refresh: the same step, the same saved content.
    expect(new URL(page.dom.window.location.href).searchParams.get('step')).toBe('transcript');
  });

  it('Approval: Next waits for "Approve minutes"; Request changes is recorded; Edit returns to the minutes; email edit; draft-only wording', async () => {
    const { app, pipeline } = server('draft-only');
    const runId = await draft(app, 'Design sync', 'wf-2');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review`));
    win(page).MA.store.setForm({ reviewer: 'Sara Lee' });
    await waitFor(() => current(page) === 'meeting', 'Meeting step');
    await next(page, 'transcript');
    await next(page, 'summary');
    await next(page, 'approval');
    expect(byId(page, 'wfNext').disabled).toBe(true);
    expect(text(page, '.wf-card')).toContain('Nothing is reviewed until you choose “Approve minutes”');
    expect(pipeline.getRun(runId).stage).toBe('minutes_pending_approval');

    byId(page, 'requestChanges').click();
    await waitFor(() => !!page.doc.getElementById('changesNote'), 'request dialog');
    byId(page, 'changesSend').click();
    expect(text(page, '[role="dialog"] .help-error')).toBe('Say what needs to change.');
    (page.doc.getElementById('changesNote') as HTMLTextAreaElement).value = 'Owner missing on item 2';
    byId(page, 'changesSend').click();
    await waitFor(() => text(page, '.wf-card .callout').includes('Changes requested by Sara Lee: Owner missing on item 2'), 'change request shown');
    expect(pipeline.getRun(runId).stage).toBe('minutes_pending_approval'); // still not approved

    expect(page.doc.getElementById('approvalEdit')).toBeNull(); // the summary editor is right below on this step
    byId(page, 'editStep').click();
    await waitFor(() => current(page) === 'approval' && !!page.doc.getElementById('editSave'), 'summary in Edit mode on Review');
    byId(page, 'editCancel').click();
    await waitFor(() => !page.doc.getElementById('editSave'), 'approval again');

    byId(page, 'approveMinutes').click();
    await waitFor(() => current(page) === 'email', 'email step');
    expect(text(page, '.page-header')).toContain('Emails drafted');
    expect(text(page, '.callout-info')).toContain('Sending is disabled (draft-only mode).');
    expect(byId(page, 'primaryAction').textContent).toBe('Approve draft');

    // Edit email → Save changes → on the server; Back to review keeps the approval.
    byId(page, 'editEmail').click();
    await waitFor(() => !!page.doc.getElementById('emailSubject'), 'email editor');
    expect(byId(page, 'primaryAction').disabled).toBe(true); // finish editing first
    type(page, '#emailSubject', 'Minutes: Design sync');
    byId(page, 'emailSave').click();
    await waitFor(() => text(page, '.email-subject') === 'Minutes: Design sync', 'saved subject');
    expect(pipeline.getRun(runId).emails!.emails[0].subject).toBe('Minutes: Design sync');

    byId(page, 'primaryAction').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'final approval');
    expect(text(page, '.final-approval')).toContain('Draft created — sending is disabled.');
    expect(text(page, '.final-approval')).not.toMatch(/Sent to/);
    expect(pipeline.getRun(runId).status).toBe('emails_drafted'); // draft-only: never "sent"
  });

  it('Meeting step: rename a participant everywhere; empty names are refused', async () => {
    const { app, pipeline } = server();
    const runId = await draft(app, 'Ops sync', 'wf-3');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review`));
    win(page).MA.store.setForm({ reviewer: 'Sara Lee' });
    await waitFor(() => current(page) === 'meeting', 'Meeting step');
    byId(page, 'editStep').click();
    await waitFor(() => !!page.doc.getElementById('editTitle'), 'meeting editor');
    type(page, '#editTitle', '');
    byId(page, 'editSave').click();
    await waitFor(() => text(page, '#meetingError') === 'Give the meeting a title.', 'title required');
    type(page, '#editTitle', 'Ops weekly');
    const tom = Array.from(page.doc.querySelectorAll('.wf-person input[type="text"]')).find((i) => (i as HTMLInputElement).value === 'Tom Ward') as HTMLInputElement;
    tom.value = 'Thomas Ward';
    tom.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    byId(page, 'editSave').click();
    await waitFor(() => text(page, '#toasts').includes('Meeting details saved'), 'saved');
    const run = pipeline.getRun(runId);
    expect(run.minutes.meetingSummary.title).toBe('Ops weekly');
    expect(run.minutes.meetingSummary.attendees).toContain('Thomas Ward');
    expect(run.recipients!['Thomas Ward']).toBe('tom@x.io');
    expect(run.transcript.some((s) => s.speakerLabel === 'Tom Ward')).toBe(false);
    await waitFor(() => pipeline.getRun(runId).minutes.actionItems.every((a) => a.owner !== 'Tom Ward'), 'owners renamed in the minutes');
    expect(text(page, 'h1.page-title')).toBe('Ops weekly');
  });

  it('Delete from ••• More asks first; Cancel keeps the meeting; Delete removes it and updates the counts', async () => {
    const { app, pipeline } = server();
    await draft(app, 'Keep me', 'wf-4a');
    const gone = await draft(app, 'Remove me', 'wf-4b');
    const page = track(openPage(app));
    await waitFor(() => page.doc.querySelectorAll('.meetings-table tbody tr').length === 2, 'two rows');
    expect(text(page, '#pendingCard-value')).toBe('2');
    const more = () => page.doc.getElementById(`more-${gone}`) as HTMLButtonElement;
    more().click();
    const item = (label: string) => Array.from(page.doc.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent!.includes(label)) as HTMLButtonElement;
    expect(item('Edit meeting')).toBeTruthy();
    item('Delete meeting').click();
    await waitFor(() => text(page, '[role="dialog"] h2') === 'Delete this meeting?', 'confirmation');
    expect(text(page, '[role="dialog"] .cal-dialog-body')).toBe('This meeting, its transcript, and its minutes will be removed. This action cannot be undone.');
    expect(page.doc.activeElement!.id).toBe('cancelDelete');
    byId(page, 'cancelDelete').click();
    expect(page.calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    more().click();
    item('Delete meeting').click();
    await waitFor(() => !!page.doc.getElementById('confirmDelete'), 'confirmation again');
    byId(page, 'confirmDelete').click();
    await waitFor(() => page.doc.querySelectorAll('.meetings-table tbody tr').length === 1, 'one row');
    expect(text(page, '.meetings-table')).not.toContain('Remove me');
    expect(text(page, '#pendingCard-value')).toBe('1');
    expect(text(page, '#toasts')).toContain('Deleted “Remove me”');
    expect(pipeline.listMeetings().map((m) => m.title)).toEqual(['Keep me']);
  });

  it('Edit Summary: labelled as an AI draft, edited in text areas, kept through Back from Approval and refresh, and the SENT email uses the edited summary', async () => {
    const { app, pipeline, outbox } = server('send');
    const runId = await draft(app, 'Launch review', 'wf-6');
    const original = pipeline.getRun(runId).minutes.discussionTopics[0].summary;
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review`));
    win(page).MA.store.setForm({ reviewer: 'Sara Lee' });
    await waitFor(() => current(page) === 'meeting', 'Meeting step');
    await next(page, 'transcript');
    await next(page, 'summary');
    expect(text(page, '#wfHeading')).toBe('Meeting Summary');
    expect(text(page, '#draftLabel')).toContain('AI-generated draft — review and edit before approval.');
    await next(page, 'approval'); // edited on the Review step
    expect(text(page, '#summaryHeading')).toBe('Meeting Summary');
    expect(byId(page, 'editStep').textContent).toBe('Edit Summary');
    expect(page.doc.querySelector('.wf-minutes')!.classList.contains('is-editing')).toBe(false);

    byId(page, 'editStep').click();
    await waitFor(() => page.doc.querySelector('.wf-minutes')?.classList.contains('is-editing') === true, 'text areas');
    const q = firstEditor(page) as unknown as { setText(t: string, s: string): void; getText(): string };
    q.setText('Launch moves to November 3 after QA signs off. Priya owns the release note.', 'user'); // rewritten: sentences replaced and added
    byId(page, 'editSave').click();
    await waitFor(() => text(page, '#toasts').includes('Changes saved') && !page.doc.getElementById('editSave'), 'saved');
    expect(firstEditor(page).getText().trim()).toBe('Launch moves to November 3 after QA signs off. Priya owns the release note.'); // shown at once

    await back(page, 'summary');
    expect(firstEditor(page).getText().trim()).toBe('Launch moves to November 3 after QA signs off. Priya owns the release note.');

    // Reopening the meeting (a fresh page) shows the same saved text.
    const reopened = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review&step=summary`));
    await waitFor(() => !!reopened.doc.querySelector('.md-section .ql-editor'), 'reopened summary');
    expect(text(reopened, '.md-section .ql-editor')).toBe('Launch moves to November 3 after QA signs off. Priya owns the release note.');

    (page.doc.getElementById('wfStep-approval') as HTMLButtonElement).click();
    await waitFor(() => current(page) === 'approval', 'approval');
    // The spelling check may ask first (names like "Priya"); approving anyway is the person's choice.
    const approveAnyway = async (done: () => boolean, what: string) => {
      await waitFor(() => done() || !!page.doc.getElementById('spellAnyway'), what, 12000);
      if (!done()) byId(page, 'spellAnyway').click();
      await waitFor(done, what, 12000);
    };
    byId(page, 'approveMinutes').click();
    await approveAnyway(() => current(page) === 'email', 'email step');
    expect(text(page, '.email-body')).toContain('Launch moves to November 3 after QA signs off.');
    expect(byId(page, 'primaryAction').textContent).toBe('Approve & send');
    byId(page, 'primaryAction').click();
    await approveAnyway(() => !!page.doc.getElementById('sendConfirm'), 'send dialog');
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'sent');
    expect(text(page, '.final-approval')).toContain('Sent.');
    expect(pipeline.getRun(runId).status).toBe('sent');
    expect(outbox.length).toBe(2);
    for (const email of outbox) {
      expect(email.body).toContain('Launch moves to November 3 after QA signs off. Priya owns the release note.');
      expect(email.body).not.toContain(original);
    }
  });

  it('each summary section has its own Edit → text area with Cancel / Save changes; the timestamp stays; saved text persists', async () => {
    const { app, pipeline } = server();
    const runId = await draft(app, 'Kickoff', 'wf-7');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review`));
    win(page).MA.store.setForm({ reviewer: 'Million' });
    await waitFor(() => current(page) === 'meeting', 'Meeting step');
    await next(page, 'transcript');
    await next(page, 'summary');
    await next(page, 'approval'); // sections are edited on the Review step
    const sections = () => Array.from(page.doc.querySelectorAll('.md-section')) as HTMLElement[];
    const [first, second] = sections();
    const id1 = first.getAttribute('data-id')!;
    expect(first.querySelector('.time-link')!.textContent).toMatch(/^\d+:\d{2}$/); // traceable to the recording
    expect(first.querySelector(`#editSection-${id1}`)!.getAttribute('aria-label')).toMatch(/^Edit /);

    (first.querySelector(`#editSection-${id1}`) as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById(`sectionSave-${id1}`), 'section in Edit mode');
    const editorOf = (el: HTMLElement) => el.querySelector('.ql-editor') as HTMLElement;
    expect(editorOf(sections()[0]).getAttribute('contenteditable')).toBe('true');
    expect(editorOf(sections()[1]).getAttribute('contenteditable')).toBe('false'); // only that section
    expect(page.doc.getElementById(`editSection-${second.getAttribute('data-id')}`)).toBeNull(); // one edit at a time
    const q = () => win(page).MA.review.sections.editors[id1] as unknown as { setText(t: string, s: string): void; getText(): string };
    q().setText('The facilitator, Milen, opened the meeting.', 'user');
    byId(page, `sectionCancel-${id1}`).click();
    await waitFor(() => !page.doc.getElementById(`sectionSave-${id1}`), 'cancelled');
    expect(q().getText()).not.toContain('Milen');

    (page.doc.getElementById(`editSection-${id1}`) as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById(`sectionSave-${id1}`), 'editing again');
    q().setText('The facilitator, Million, opened the meeting on 6 October.', 'user');
    byId(page, `sectionSave-${id1}`).click();
    await waitFor(() => text(page, '#toasts').includes('Changes saved') && !page.doc.getElementById(`sectionSave-${id1}`), 'saved');
    expect(q().getText().trim()).toBe('The facilitator, Million, opened the meeting on 6 October.');
    expect(pipeline.getRun(runId).minutes.discussionTopics[0].summary).toBe('The facilitator, Million, opened the meeting on 6 October.');
    await back(page, 'summary');
    expect(q().getText().trim()).toBe('The facilitator, Million, opened the meeting on 6 October.');
    const fresh = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review&step=summary`));
    await waitFor(() => !!fresh.doc.querySelector('.md-section .ql-editor'), 'refreshed');
    expect(text(fresh, '.md-section .ql-editor')).toBe('The facilitator, Million, opened the meeting on 6 October.');
  });

  it('reviewed minutes: "Edit Summary" warns; Cancel keeps the approval; Save changes → Needs review, email blocked until reviewed again; the new email uses the correction', async () => {
    const { app, pipeline } = server('draft-only');
    const runId = await draft(app, 'Board call', 'wf-8');
    await pipeline.approveMinutes(runId, 'Million');
    await pipeline.approveEmailsAndSend(runId, 'Million'); // draft-only: approved, nothing sent
    expect(pipeline.getRun(runId).status).toBe('emails_drafted');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=review&step=approval`));
    win(page).MA.store.setForm({ reviewer: 'Million' });
    await waitFor(() => current(page) === 'approval' && !!page.doc.getElementById('editStep'), 'Review step');
    expect(byId(page, 'editStep').textContent).toBe('Edit Summary');
    expect(page.doc.getElementById('editApproved')).toBeNull(); // the old "Edit approved minutes" is gone
    const id1 = page.doc.querySelector('.md-section')!.getAttribute('data-id')!;

    // Warning first; Cancel there changes nothing.
    byId(page, `editSection-${id1}`).click();
    await waitFor(() => text(page, '#reopenWarning') === 'Editing reviewed minutes will require approval again.', 'warning');
    byId(page, 'reopenCancel').click();
    expect(page.doc.getElementById(`sectionSave-${id1}`)).toBeNull();

    // Edit anyway → edit → Cancel: still approved, nothing sent to the server.
    byId(page, `editSection-${id1}`).click();
    await waitFor(() => !!page.doc.getElementById('reopenContinue'), 'warning again');
    byId(page, 'reopenContinue').click();
    await waitFor(() => !!page.doc.getElementById(`sectionSave-${id1}`), 'editing reviewed minutes');
    expect(text(page, '.review-banners')).toContain('Editing reviewed minutes will require approval again.');
    const q = () => win(page).MA.review.sections.editors[id1] as unknown as { setText(t: string, s: string): void; getText(): string };
    q().setText('Corrected: the budget was reviewed by Million.', 'user');
    await new Promise((r) => setTimeout(r, 2500)); // no autosave while the approval stands
    expect(page.calls.some((c) => c.startsWith('PUT /api/minutes/'))).toBe(false);
    byId(page, `sectionCancel-${id1}`).click();
    await waitFor(() => !page.doc.getElementById(`sectionSave-${id1}`), 'cancelled');
    expect(pipeline.getRun(runId).status).toBe('emails_drafted');
    expect(q().getText()).not.toContain('Corrected:');

    // Edit anyway → Save changes: approval withdrawn → Needs review; Email can't be opened.
    byId(page, `editSection-${id1}`).click();
    await waitFor(() => !!page.doc.getElementById('reopenContinue'), 'warning third time');
    byId(page, 'reopenContinue').click();
    await waitFor(() => !!page.doc.getElementById(`sectionSave-${id1}`), 'editing');
    q().setText('Corrected: the budget was reviewed by Million.', 'user');
    byId(page, `sectionSave-${id1}`).click();
    await waitFor(() => text(page, '#toasts').includes('the minutes need approval again'), 'saved + reopened');
    const run = pipeline.getRun(runId);
    expect(run.status).toBe('needs_review');
    expect(run.stage).toBe('minutes_pending_approval');
    expect(run.finalApproval).toBeUndefined();
    expect(run.minutes.discussionTopics[0].summary).toBe('Corrected: the budget was reviewed by Million.');
    expect(text(page, '.page-header')).toContain('Needs review');
    expect(byId(page, 'wfStep-email').disabled).toBe(true);
    expect((await request(app).post(`/api/meetings/${encodeURIComponent(runId)}/approve-emails`).send({ approvedBy: 'Million' })).status).toBe(409);

    // Approve again → the new email draft carries the correction.
    await goToStepIn(page, 'approval');
    byId(page, 'approveMinutes').click();
    await waitFor(() => current(page) === 'email', 'email step');
    expect(text(page, '.email-body')).toContain('Corrected: the budget was reviewed by Million.');
  });

  it('a meeting already emailed: after correction and a second approval, everyone gets "Updated minutes" once', async () => {
    const { app, pipeline, outbox } = server('send');
    const runId = await draft(app, 'Weekly sync', 'wf-9');
    await pipeline.approveMinutes(runId, 'Million');
    await pipeline.approveEmailsAndSend(runId, 'Million');
    expect(outbox).toHaveLength(2);
    const reopened = await request(app).post(`/api/minutes/${encodeURIComponent(runId)}/reopen`).send({ editedBy: 'Million' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.state).toBe('draft');
    expect(pipeline.getRun(runId).status).toBe('needs_review');
    // Reopening again is a no-op.
    expect((await request(app).post(`/api/minutes/${encodeURIComponent(runId)}/reopen`).send({ editedBy: 'Million' })).body.revision).toBe(reopened.body.revision);
    const doc = reopened.body;
    doc.content.sections[0].html = '<p>Corrected summary.</p>';
    expect((await request(app).put(`/api/minutes/${encodeURIComponent(runId)}`).send({ content: doc.content, baseRevision: doc.revision, editedBy: 'Million' })).status).toBe(200);
    await pipeline.approveMinutes(runId, 'Million');
    const resent = await pipeline.approveEmailsAndSend(runId, 'Million');
    expect(resent.status).toBe('sent');
    expect(outbox).toHaveLength(4);
    expect(outbox.slice(2).every((e) => e.subject.startsWith('Updated minutes: ') && e.body.includes('Corrected summary.'))).toBe(true);
    await pipeline.approveEmailsAndSend(runId, 'Million'); // replay: nobody is emailed twice
    expect(outbox).toHaveLength(4);
  });

  it('sidebar: "Human approval enabled" when sending is on; the draft-only message only in draft-only mode', async () => {
    const sending = track(openPage(server('send').app));
    await waitFor(() => !!sending.doc.querySelector('.mode-pill'), 'sidebar');
    expect(text(sending, '.mode-pill')).toContain('Human approval enabled');
    expect(text(sending, '.mode-pill')).toContain('Nothing is sent without your approval.');
    const draftOnly = track(openPage(server('draft-only').app));
    await waitFor(() => !!draftOnly.doc.querySelector('.mode-pill'), 'sidebar');
    expect(text(draftOnly, '.mode-pill')).toContain('Draft-only mode');
    expect(text(draftOnly, '.mode-pill')).toContain('Emails are drafted, never sent.');
  });
});

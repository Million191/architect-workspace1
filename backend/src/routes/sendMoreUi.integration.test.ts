import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';

/** After the minutes were emailed: missed people can be added and sent the same reviewed minutes; nobody gets it twice. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  const samples = Buffer.alloc(4000);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 5) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}
function server() {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  return { pipeline, outbox: providers.outbox, app: createApp({ meetingPipeline: pipeline, people: createPeopleService({ store: new Map<string, PersonRecord>() }), email: { mode: 'send', deliver: providers.emailDeliveryClient } }) };
}
const byId = (page: Page, id: string) => page.doc.getElementById(id) as HTMLButtonElement;
const box = (page: Page, name: string) => page.doc.querySelector(`.send-confirm-list input[data-name="${name}"]`) as HTMLInputElement;

let page: Page | undefined;
afterEach(() => page?.close());
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('a sent meeting: add the missed people, "Send to N more" emails only them, the original review is kept', async () => {
  const { app, pipeline, outbox } = server();
  const runId = (await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>, Priya').field('title', 'Budget review').attach('audio', wav('more-1'), 'm.wav')).body.runId as string;
  await pipeline.approveMinutes(runId, 'Million');
  await pipeline.approveEmailsAndSend(runId, 'Million', { recipients: ['Sara Lee', 'Tom Ward'] });
  const reviewed = pipeline.getRun(runId).finalApproval!;
  expect(outbox.map((e) => e.participantName).sort()).toEqual(['Sara Lee', 'Tom Ward']);

  // Nobody else has an address yet: the bar explains, the button waits.
  page = openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`);
  (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
  await waitFor(() => !!page!.doc.getElementById('sendMore'), 'the send-more bar');
  expect(byId(page, 'sendMore').disabled).toBe(true);
  expect(text(page, '#sendMoreHint')).toBe('Not sent yet: Priya. Add an email address for them first.');
  expect(page.doc.getElementById('addRecipient')).not.toBeNull();
  page.close();

  // Priya's address, plus someone who was left off the list entirely.
  const path = `/api/meetings/${encodeURIComponent(runId)}/recipients`;
  expect((await request(app).post(path).send({ name: 'Priya', email: 'priya@x.io' })).status).toBe(200);
  expect((await request(app).post(path).send({ name: 'Eve Park', email: 'eve@x.io' })).status).toBe(200);

  page = openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`);
  (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
  await waitFor(() => byId(page!, 'sendMore')?.textContent === 'Send to 2 more' && !byId(page!, 'sendMore').disabled, 'Send to 2 more');
  byId(page, 'sendMore').click();
  await waitFor(() => !!page!.doc.getElementById('sendConfirm') || !!page!.doc.getElementById('spellAnyway'), 'dialog', 12000);
  if (page.doc.getElementById('spellAnyway')) byId(page, 'spellAnyway').click();
  await waitFor(() => !!page!.doc.getElementById('sendConfirm'), 'the send dialog', 12000);
  expect(text(page, '[role="dialog"]')).toContain('Send minutes to more people for Budget review?');
  expect(box(page, 'Sara Lee').disabled).toBe(true); // already has it
  expect(box(page, 'Sara Lee').checked).toBe(false);
  expect(text(page, '[role="dialog"]')).toContain('Already sent');
  expect(box(page, 'Priya').checked).toBe(true);
  expect(box(page, 'Eve Park').checked).toBe(true);
  expect(text(page, '#sendConfirm')).toBe('Yes, send to 2');
  byId(page, 'sendConfirm').click();
  await waitFor(() => text(page!, '#toasts').includes('Minutes sent to 2 more participants'), 'toast');

  expect(outbox.map((e) => e.participantName).sort()).toEqual(['Eve Park', 'Priya', 'Sara Lee', 'Tom Ward']); // each once
  const after = pipeline.getRun(runId);
  expect(after.status).toBe('sent');
  expect(after.finalApproval).toMatchObject({ approvedBy: reviewed.approvedBy, approvedAt: reviewed.approvedAt }); // the review isn't re-dated
  expect(after.sentTo!.map((x) => x.participantName).sort()).toEqual(['Eve Park', 'Priya', 'Sara Lee', 'Tom Ward']);
  await waitFor(() => text(page!, '#sendMoreHint').includes('Everyone on the list has the email.'), 'nothing left to send');

  // An address that already got the email can't be added again under another name (no second copy).
  const dup = await request(app).post(path).send({ name: 'S. Lee', email: 'SARA@x.io' });
  expect(dup.status).toBe(409);
  expect(dup.body.message).toBe('SARA@x.io already received the email (as Sara Lee).');

  // Asking again for someone who has it sends nothing.
  await expect(pipeline.approveEmailsAndSend(runId, 'Million', { recipients: ['Sara Lee'] })).rejects.toThrow('already received');
  expect(outbox).toHaveLength(4);
});

it('Add recipients suggests people from People: type "sar", pick Sara, her address is used; a typed full name works too', async () => {
  const { app, pipeline } = server();
  const runId = (await request(app).post('/api/meetings/draft').field('attendees', 'Tom Ward <tom@x.io>').field('title', 'Planning').attach('audio', wav('more-2'), 'm.wav')).body.runId as string;
  await pipeline.approveMinutes(runId, 'Million');
  await request(app).post('/api/people').send({ name: 'Sara Abate', email: 'sara.a@x.io', role: 'Business Analyst' });
  await request(app).post('/api/people').send({ name: 'Dana Cruz', email: 'dana@x.io' });

  page = openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`);
  await waitFor(() => !!page!.doc.getElementById('addRecipient'), 'email step');
  byId(page, 'addRecipient').click();
  await waitFor(() => !!page!.doc.getElementById('recipientEmail-0'), 'add dialog');
  await new Promise((r) => setTimeout(r, 50)); // the People list refreshes when the dialog opens
  const input = page.doc.getElementById('recipientEmail-0') as HTMLInputElement;
  input.value = 'sar';
  input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
  await waitFor(() => !page!.doc.getElementById('recipientEmail-0-suggest')!.hidden, 'suggestions');
  expect(text(page, '#recipientEmail-0-suggest')).toContain('Sara Abate');
  expect(text(page, '#recipientEmail-0-suggest')).toContain('sara.a@x.io · Business Analyst');
  expect(text(page, '#recipientEmail-0-suggest')).not.toContain('Dana');
  page.doc.querySelector('#recipientEmail-0-suggest li')!.dispatchEvent(new page.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  expect(input.value).toBe('sara.a@x.io');

  // Second row: the full name typed, not picked — still resolved from People.
  byId(page, 'recipientMore').click();
  const second = page.doc.getElementById('recipientEmail-1') as HTMLInputElement;
  second.value = 'dana cruz';
  second.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
  byId(page, 'recipientAdd').click();
  await waitFor(() => text(page!, '#recipientsHeading').includes('3'), 'two added');
  const run = pipeline.getRun(runId);
  expect(run.recipients).toMatchObject({ 'Sara Abate': 'sara.a@x.io', 'Dana Cruz': 'dana@x.io' });
  expect(run.emails!.emails.find((e) => e.participantName === 'Sara Abate')!.body.startsWith('Hi Sara Abate,')).toBe(true);
});

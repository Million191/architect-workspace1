import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/**
 * "Send minutes for <title>?" — the confirmation before real emails go out: participants with
 * checkboxes (ticked by default, missing addresses flagged), "Yes, send to N", a spinner with no
 * double sends, Sent + toast on success, and the error kept in the dialog on failure.
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
function server(opts: { failFirstSend?: boolean } = {}) {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
  if (opts.failFirstSend) {
    const real = providers.emailDeliveryClient.send.bind(providers.emailDeliveryClient);
    let failed = false;
    providers.emailDeliveryClient.send = async (email, meta) => {
      if (!failed) { failed = true; throw new Error('SMTP server not reachable'); }
      return real(email, meta);
    };
  }
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const app = createApp({ meetingPipeline: pipeline, email: { mode: 'send', deliver: providers.emailDeliveryClient } });
  return { app, pipeline, outbox: providers.outbox };
}
async function approvedMeeting(app: express.Express, pipeline: MeetingPipeline, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>, Priya').field('title', 'Budget review').attach('audio', wav(salt), 'm.wav');
  await pipeline.approveMinutes(res.body.runId, 'Million');
  return res.body.runId as string;
}

const pages: Page[] = [];
const track = (p: Page) => { pages.push(p); return p; };
const byId = (page: Page, id: string) => page.doc.getElementById(id) as HTMLButtonElement;
const box = (page: Page, name: string) => page.doc.querySelector(`.send-confirm-list input[data-name="${name}"]`) as HTMLInputElement;
async function openDialog(app: express.Express, runId: string, beforeSend?: (page: Page) => void) {
  const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`));
  (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
  await waitFor(() => byId(page, 'primaryAction')?.textContent === 'Approve & send', 'the email step');
  beforeSend?.(page);
  byId(page, 'primaryAction').click();
  // The spelling check may ask first; approving anyway is the person's choice.
  await waitFor(() => !!page.doc.getElementById('sendConfirm') || !!page.doc.getElementById('spellAnyway'), 'dialog', 12000);
  if (page.doc.getElementById('spellAnyway')) byId(page, 'spellAnyway').click();
  await waitFor(() => !!page.doc.getElementById('sendConfirm'), 'the send dialog', 12000);
  return page;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('Send confirmation dialog', () => {
  it('lists participants (ticked; missing address flagged), counts the selection, and sends only to the ticked people', async () => {
    const { app, pipeline, outbox } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-1');
    const page = await openDialog(app, runId);
    expect(text(page, '[role="dialog"] h2')).toBe('Send minutes for Budget review?');
    expect(text(page, '.send-confirm-list')).toContain('sara@x.io');
    expect(box(page, 'Sara Lee').checked).toBe(true);
    expect(box(page, 'Tom Ward').checked).toBe(true);
    expect(box(page, 'Priya').checked).toBe(false);
    expect(box(page, 'Priya').disabled).toBe(true);
    expect(text(page, '.send-confirm-row.is-missing')).toContain('No email address — can’t be sent');
    expect(text(page, '[role="dialog"] .callout-warning')).toContain('1 participant has no email address.');
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 2');

    // Untick everyone → send disabled; tick one back → "Yes, send to 1".
    for (const name of ['Sara Lee', 'Tom Ward']) { box(page, name).checked = false; box(page, name).dispatchEvent(new page.dom.window.Event('change')); }
    expect(byId(page, 'sendConfirm').disabled).toBe(true);
    box(page, 'Sara Lee').checked = true;
    box(page, 'Sara Lee').dispatchEvent(new page.dom.window.Event('change'));
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 1');

    // Double click: one request, a spinner while it runs.
    byId(page, 'sendConfirm').click();
    expect(page.doc.querySelector('#sendConfirm .spinner')).not.toBeNull();
    expect(text(page, '#sendConfirm')).toBe('Sending…');
    expect(byId(page, 'sendConfirm').disabled).toBe(true);
    byId(page, 'sendConfirm').click();
    await waitFor(() => !page.doc.getElementById('sendConfirm') && !!page.doc.querySelector('.final-approval'), 'sent');
    expect(page.calls.filter((c) => c.endsWith('/approve-emails'))).toHaveLength(1);
    expect(text(page, '#toasts')).toContain('Minutes sent to 1 participant');
    expect(text(page, '.page-header')).toContain('Sent');
    expect(pipeline.getRun(runId).status).toBe('sent');
    expect(outbox.map((e) => e.participantName)).toEqual(['Sara Lee']);
    // A replay never emails the people who were unticked.
    await request(app).post(`/api/meetings/${encodeURIComponent(runId)}/approve-emails`).send({ approvedBy: 'Million' });
    expect(outbox.map((e) => e.participantName)).toEqual(['Sara Lee']);
  });

  it('Cancel sends nothing and leaves the meeting at Emails drafted', async () => {
    const { app, pipeline, outbox } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-2');
    const page = await openDialog(app, runId);
    byId(page, 'sendCancel').click();
    expect(page.doc.querySelector('[role="dialog"]')).toBeNull();
    expect(page.calls.some((c) => c.endsWith('/approve-emails'))).toBe(false);
    expect(outbox).toHaveLength(0);
    expect(pipeline.getRun(runId).status).toBe('emails_drafted');
  });

  it('on a send error the dialog stays open with the reason, and sending again works', async () => {
    const { app, pipeline, outbox } = server({ failFirstSend: true });
    const runId = await approvedMeeting(app, pipeline, 'sd-3');
    const page = await openDialog(app, runId);
    byId(page, 'sendConfirm').click();
    await waitFor(() => text(page, '.send-confirm-error').includes('Not sent.'), 'error in the dialog');
    expect(page.doc.getElementById('sendConfirm')).not.toBeNull(); // still open
    expect(byId(page, 'sendConfirm').disabled).toBe(false);
    expect(byId(page, 'sendCancel').disabled).toBe(false);
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 2');
    expect(pipeline.getRun(runId).status).not.toBe('sent');
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'sent after retry');
    expect(outbox.map((e) => e.participantName).sort()).toEqual(['Sara Lee', 'Tom Ward']);
    expect(pipeline.getRun(runId).status).toBe('sent');
  });

  it('the API checks the selection: empty list 400, unknown name 409', async () => {
    const { app, pipeline } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-4');
    const path = `/api/meetings/${encodeURIComponent(runId)}/approve-emails`;
    expect((await request(app).post(path).send({ approvedBy: 'Million', recipients: [] })).status).toBe(400);
    expect((await request(app).post(path).send({ approvedBy: 'Million', recipients: ['Nobody'] })).status).toBe(409);
    expect(pipeline.getRun(runId).status).toBe('emails_drafted');
  });

  it('a meeting reviewed while sending was off gets "Approve & send" once sending is on, and is sent only to the ticked people', async () => {
    const stores = createPipelineStores();
    // Approved in draft-only mode (nothing sent)…
    const offProviders = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
    const off = createMeetingPipeline(offProviders, stores);
    const offApp = createApp({ meetingPipeline: off, email: { mode: 'draft-only', deliver: offProviders.emailDeliveryClient } });
    const runId = await approvedMeeting(offApp, off, 'sd-6');
    await off.approveEmailsAndSend(runId, 'Million');
    expect(off.getRun(runId).stage).toBe('approved_not_sent');
    // …then the server restarts with sending on (same saved data).
    const onProviders = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
    const on = createMeetingPipeline(onProviders, stores);
    const app = createApp({ meetingPipeline: on, email: { mode: 'send', deliver: onProviders.emailDeliveryClient } });
    expect(on.getRun(runId).status).toBe('emails_drafted');

    const page = await openDialog(app, runId, (p) => {
      expect(text(p, '.final-approval')).toContain('Reviewed while sending was off — this email hasn’t been sent yet.');
      expect(p.doc.getElementById('editEmail')).toBeNull(); // what was approved is sent as approved
    });
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 2');
    box(page, 'Tom Ward').checked = false;
    box(page, 'Tom Ward').dispatchEvent(new page.dom.window.Event('change'));
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval') && text(page, '.final-approval').startsWith('Sent.'), 'sent');
    expect(on.getRun(runId)).toMatchObject({ stage: 'sent', status: 'sent' });
    expect(onProviders.outbox.map((e) => e.participantName)).toEqual(['Sara Lee']);
    expect(text(page, '#toasts')).toContain('Minutes sent to 1 participant');
    await on.approveEmailsAndSend(runId, 'Million'); // replay: nobody else is emailed
    expect(onProviders.outbox).toHaveLength(1);
  });

  it('Email step: "Add" a recipient and "Add email" for someone without one; both are ticked in the send dialog and receive the minutes', async () => {
    const { app, pipeline, outbox } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-7');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`));
    (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
    await waitFor(() => !!page.doc.getElementById('addRecipient'), 'the email step');
    const type = (id: string, value: string) => { const i = page.doc.getElementById(id) as HTMLInputElement; i.value = value; i.dispatchEvent(new page.dom.window.Event('input')); };

    // Add a new recipient: validated, then their own email appears and is selected.
    byId(page, 'addRecipient').click();
    await waitFor(() => !!page.doc.getElementById('recipientEmail-0'), 'add dialog');
    expect(page.doc.querySelectorAll('[role="dialog"] .recipient-row input')).toHaveLength(1); // one box per person: a name from People, or an email
    type('recipientEmail-0', 'not-an-email');
    byId(page, 'recipientAdd').click();
    expect(text(page, '#recipientError')).toBe('“not-an-email” isn’t a valid email address or a person in People.');
    type('recipientEmail-0', 'dana.cruz@x.io');
    byId(page, 'recipientAdd').click();
    await waitFor(() => text(page, '.email-to').includes('dana.cruz@x.io'), 'Dana selected');
    expect(text(page, '.email-body')).toContain('Hi Dana Cruz,'); // greeting name from the address
    expect(text(page, '#recipientsHeading')).toContain('4');

    // Priya has no address: "Add email" on her email.
    (page.doc.getElementById('recipient-2') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.getElementById('addEmailFor'), 'missing address');
    byId(page, 'addEmailFor').click();
    await waitFor(() => text(page, '[role="dialog"] h2') === 'Add an email address for Priya', 'fix dialog');
    type('recipientEmail', 'priya@x.io');
    byId(page, 'recipientAdd').click();
    await waitFor(() => text(page, '.email-to').includes('priya@x.io'), 'Priya has an address');
    expect(pipeline.getRun(runId).minutes.meetingSummary.attendees).not.toContain('Dana Cruz'); // a recipient, not a participant

    byId(page, 'primaryAction').click();
    await waitFor(() => !!page.doc.getElementById('sendConfirm') || !!page.doc.getElementById('spellAnyway'), 'dialog', 12000);
    if (page.doc.getElementById('spellAnyway')) byId(page, 'spellAnyway').click();
    await waitFor(() => !!page.doc.getElementById('sendConfirm'), 'send dialog', 12000);
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 4');
    expect(page.doc.querySelector('.send-confirm-row.is-missing')).toBeNull();
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'sent');
    expect(outbox.map((e) => e.participantName).sort()).toEqual(['Dana Cruz', 'Priya', 'Sara Lee', 'Tom Ward']);
    // Sent: people who were missed can still be added; everyone listed has it, so there's nobody to send to yet.
    expect(page.doc.getElementById('addRecipient')).not.toBeNull();
    expect(byId(page, 'sendMore').disabled).toBe(true);
    expect(text(page, '#sendMoreHint')).toContain('Everyone on the list has the email.');
  });

  it('the recipients API: validation, same person again only updates the address, refused after sending, works for a meeting reviewed while sending was off', async () => {
    const { app, pipeline } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-8');
    const path = `/api/meetings/${encodeURIComponent(runId)}/recipients`;
    expect((await request(app).post(path).send({ name: 'Dana', email: 'nope' })).status).toBe(400);
    expect((await request(app).post(path).send({ name: '<b>', email: 'd@x.io' })).status).toBe(400);
    expect((await request(app).post(path).send({ name: 'Dana', email: 'd@x.io' })).body.emails.emails).toHaveLength(4);
    const again = await request(app).post(path).send({ name: 'dana', email: 'dana@x.io' });
    expect(again.body.emails.emails).toHaveLength(4);
    expect(again.body.recipients.Dana).toBe('dana@x.io');
    await pipeline.approveEmailsAndSend(runId, 'Million');
    // After sending: a missed person can be added (to be sent later), but someone who has the email keeps their address.
    expect((await request(app).post(path).send({ name: 'Eve', email: 'e@x.io' })).status).toBe(200);
    expect((await request(app).post(path).send({ name: 'Sara Lee', email: 'other@x.io' })).status).toBe(409);
    const fresh = await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>').field('title', 'Not yet').attach('audio', wav('sd-8b'), 'm.wav');
    expect((await request(app).post(`/api/meetings/${encodeURIComponent(fresh.body.runId)}/recipients`).send({ name: 'Eve', email: 'e@x.io' })).status).toBe(409); // minutes not approved yet

    // Approved while sending was off → recipients can still be added before it's sent.
    const stores = createPipelineStores();
    const offProviders = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
    const off = createMeetingPipeline(offProviders, stores);
    const offApp = createApp({ meetingPipeline: off });
    const earlier = await approvedMeeting(offApp, off, 'sd-8c');
    await off.approveEmailsAndSend(earlier, 'Million');
    const onProviders = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
    const on = createMeetingPipeline(onProviders, stores);
    on.addRecipient(earlier, { name: 'Dana', email: 'dana@x.io' });
    expect(on.getRun(earlier).emails!.emails.map((e) => e.participantName)).toContain('Dana');
    await on.approveEmailsAndSend(earlier, 'Million', { recipients: ['Dana'] });
    expect(onProviders.outbox.map((e) => [e.participantName, e.body.startsWith('Hi Dana,')])).toEqual([['Dana', true]]);
  });

  it('Add recipients: several email addresses at once (rows, "Add another email", pasted list); all ticked and emailed', async () => {
    const { app, pipeline, outbox } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-9');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`));
    (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
    await waitFor(() => !!page.doc.getElementById('addRecipient'), 'the email step');
    const type = (id: string, value: string) => { const i = page.doc.getElementById(id) as HTMLInputElement; i.value = value; i.dispatchEvent(new page.dom.window.Event('input')); };
    byId(page, 'addRecipient').click();
    await waitFor(() => !!page.doc.getElementById('recipientEmail-0'), 'add dialog');
    expect(text(page, '#recipientAdd')).toBe('Add recipient');

    // Pasting several addresses fills one row each.
    const paste = new page.dom.window.Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData(t: string): string } };
    paste.clipboardData = { getData: () => 'dana@x.io, Lee Park <lee.park@x.io>\nola_ade@x.io' };
    page.doc.getElementById('recipientEmail-0')!.dispatchEvent(paste);
    expect((page.doc.getElementById('recipientEmail-1') as HTMLInputElement).value).toBe('lee.park@x.io');
    expect(text(page, '#recipientAdd')).toBe('Add 3 recipients');

    // "Add another email" adds a row; a bad address is caught; a duplicate too.
    byId(page, 'recipientMore').click();
    type('recipientEmail-3', 'dana@x.io');
    byId(page, 'recipientAdd').click();
    expect(text(page, '#recipientError')).toBe('dana@x.io is listed twice.');
    type('recipientEmail-3', 'zed@x.io');
    byId(page, 'recipientAdd').click();
    await waitFor(() => text(page, '#toasts').includes('4 people will receive the minutes'), 'added');
    expect(page.calls.filter((c) => c.endsWith('/recipients'))).toHaveLength(1); // one request for all
    const names = pipeline.getRun(runId).emails!.emails.map((e) => e.participantName);
    expect(names).toEqual(['Sara Lee', 'Tom Ward', 'Priya', 'Dana', 'Lee Park', 'Ola Ade', 'Zed']);

    byId(page, 'primaryAction').click();
    await waitFor(() => !!page.doc.getElementById('sendConfirm') || !!page.doc.getElementById('spellAnyway'), 'dialog', 12000);
    if (page.doc.getElementById('spellAnyway')) byId(page, 'spellAnyway').click();
    await waitFor(() => !!page.doc.getElementById('sendConfirm'), 'send dialog', 12000);
    expect(text(page, '#sendConfirm')).toBe('Yes, send to 6'); // Priya still has no address
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'sent');
    expect(outbox).toHaveLength(6);
  });

  it('Approve & send with no name set asks for it in the send dialog (instead of blocking), then sends', async () => {
    const { app, pipeline, outbox } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-11');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`));
    (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: '' });
    await waitFor(() => byId(page, 'primaryAction')?.textContent === 'Approve & send', 'the email step');
    byId(page, 'primaryAction').click();
    await waitFor(() => !!page.doc.getElementById('sendConfirm') || !!page.doc.getElementById('spellAnyway'), 'dialog', 12000);
    if (page.doc.getElementById('spellAnyway')) byId(page, 'spellAnyway').click();
    await waitFor(() => !!page.doc.getElementById('sendApprover'), 'name field in the send dialog', 12000);
    expect(text(page, '#toasts')).not.toContain('Add your name');
    expect(byId(page, 'sendConfirm').disabled).toBe(true); // a name is needed
    const name = page.doc.getElementById('sendApprover') as HTMLInputElement;
    name.value = 'Million Abate';
    name.dispatchEvent(new page.dom.window.Event('input'));
    expect(byId(page, 'sendConfirm').disabled).toBe(false);
    byId(page, 'sendConfirm').click();
    await waitFor(() => !!page.doc.querySelector('.final-approval'), 'sent');
    expect(outbox).toHaveLength(2);
    expect(pipeline.getRun(runId).finalApproval!.approvedBy).toBe('Million Abate');
    expect(text(page, '#avatar')).toBe('MA'); // remembered like the name in Settings
  });

  it('the recipients API takes several addresses at once (names optional) and checks every row first', async () => {
    const { app, pipeline } = server();
    const runId = await approvedMeeting(app, pipeline, 'sd-10');
    const path = `/api/meetings/${encodeURIComponent(runId)}/recipients`;
    expect((await request(app).post(path).send({ people: [] })).status).toBe(400);
    expect((await request(app).post(path).send({ people: [{ email: 'a@x.io' }, { email: 'A@x.io' }] })).status).toBe(400); // same address twice
    expect((await request(app).post(path).send({ people: [{ name: 'A', email: 'a@x.io' }, { name: 'B', email: 'bad' }] })).status).toBe(400);
    expect(pipeline.getRun(runId).emails!.emails).toHaveLength(3); // nothing added from a bad batch
    const ok = await request(app).post(path).send({ people: [{ name: 'A', email: 'a@x.io' }, { email: 'b.smith@x.io' }, { email: 'sara@x.io' }, { email: 'tom.ward@other.io' }], editedBy: 'Million' });
    expect(ok.status).toBe(200);
    // "sara@x.io" already gets the email (skipped); "Tom Ward" is taken by another address, so the address is the name.
    expect(ok.body.emails.emails.map((e: { participantName: string }) => e.participantName)).toEqual(['Sara Lee', 'Tom Ward', 'Priya', 'A', 'B Smith', 'tom.ward@other.io']);
    expect(ok.body.recipients['Tom Ward']).toBe('tom@x.io'); // never overwritten
  });

  it('draft-only mode keeps "Approve draft" with no send dialog', async () => {
    const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const app = createApp({ meetingPipeline: pipeline, email: { mode: 'draft-only', deliver: providers.emailDeliveryClient } });
    const runId = await approvedMeeting(app, pipeline, 'sd-5');
    const page = track(openPage(app, `/?run=${encodeURIComponent(runId)}&view=send`));
    (page.dom.window as unknown as { MA: { store: { setForm(p: object): void } } }).MA.store.setForm({ reviewer: 'Million' });
    await waitFor(() => byId(page, 'primaryAction')?.textContent === 'Approve draft', 'draft-only email step');
    expect(text(page, '.page-header')).toContain('Emails drafted');
  });
});

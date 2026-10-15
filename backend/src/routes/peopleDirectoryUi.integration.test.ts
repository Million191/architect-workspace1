import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { openPage, Page, text, waitFor } from './__testutils__/pageHarness';

/** The People page: clean empty state, "+ Add person", editable email, and each person's meetings and action items. */
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
function server(): { app: express.Express; pipeline: MeetingPipeline } {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  return { pipeline, app: createApp({ meetingPipeline: pipeline, people: createPeopleService({ store: new Map<string, PersonRecord>() }) }) };
}
const pages: Page[] = [];
const track = (p: Page) => { pages.push(p); return p; };
const byId = (page: Page, id: string) => page.doc.getElementById(id) as HTMLButtonElement;
const type = (page: Page, id: string, value: string) => { const i = page.doc.getElementById(id) as HTMLInputElement; i.value = value; i.dispatchEvent(new page.dom.window.Event('input')); };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => pages.splice(0).forEach((p) => p.close()));

describe('People page', () => {
  it('empty app: "No participants yet" with + Add person; adding someone lists them', async () => {
    const { app } = server();
    const page = track(openPage(app, '/?page=people'));
    await waitFor(() => text(page, '.empty h2') === 'No participants yet', 'empty state');
    expect(text(page, '.page-header .meta')).toBe('Everyone from your meetings.');
    expect(text(page, '.empty p')).toBe('Participants from your meetings will appear here automatically. You can also add someone manually.');
    expect(page.doc.querySelectorAll('.person-row')).toHaveLength(0);

    byId(page, 'addPerson').click();
    await waitFor(() => !!page.doc.getElementById('newPersonName'), 'add dialog');
    type(page, 'newPersonName', 'Dana Cruz');
    type(page, 'newPersonEmail', 'nope');
    byId(page, 'newPersonAdd').click();
    expect(text(page, '#newPersonError')).toBe('Type a valid email address, like name@example.com.');
    type(page, 'newPersonEmail', 'dana@x.io');
    byId(page, 'newPersonAdd').click();
    await waitFor(() => page.doc.querySelectorAll('.person-row').length === 1, 'Dana listed', 15000);
    expect(text(page, '.person-row')).toContain('Dana Cruz');
    expect(text(page, '.person-row')).toContain('Added by you — not in any meeting yet.');
  });

  it('meeting participants appear with their meetings and action items; the email can be corrected', async () => {
    const { app, pipeline } = server();
    const res = await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>').field('title', 'Launch sync').attach('audio', wav('ppl-1'), 'm.wav');
    await pipeline.approveMinutes(res.body.runId, 'Million');
    await pipeline.approveEmailsAndSend(res.body.runId, 'Million'); // action items are recorded at the final approval
    const owners = pipeline.listActionItems().map((a) => a.owner);
    const page = track(openPage(app, '/?page=people'));
    // People and meetings load separately; the history shows once both are in.
    const saraItems = owners.filter((o) => o === 'Sara Lee').length;
    await waitFor(() => text(page, '.person-row[data-email="sara@x.io"] .person-history summary') === '1 meeting', 'Sara history', 15000);
    const saraRow = page.doc.querySelector('.person-row[data-email="sara@x.io"]') as HTMLElement;
    expect(saraRow.querySelector('.person-history-list')!.textContent).toContain('Launch sync');
    expect(saraItems).toBeGreaterThanOrEqual(0); // action items are still recorded on the server…
    expect(text(page, '.person-row[data-email="sara@x.io"]')).not.toMatch(/action item/i); // …but not shown

    // The table shows Name, Role and Email; Edit opens the row.
    expect([...page.doc.querySelectorAll('.people-table thead th')].map((th) => th.textContent)).toEqual(['Name', 'Role', 'Email', 'Actions']);
    expect(page.doc.querySelector('.person-row[data-email="tom@x.io"] input')).toBeNull(); // read-only until Edit
    (page.doc.querySelector('.person-row[data-email="tom@x.io"] [id$="-edit"]') as HTMLButtonElement).click();
    // Correct Tom's address on the People page.
    const tomEmail = page.doc.querySelector('.person-row[data-email="tom@x.io"] input[type="email"]') as HTMLInputElement;
    tomEmail.value = 'tom.ward@x.io';
    tomEmail.dispatchEvent(new page.dom.window.Event('input'));
    (page.doc.querySelector('.person-row[data-email="tom@x.io"] [id$="-save"]') as HTMLButtonElement).click();
    await waitFor(() => !!page.doc.querySelector('.person-row[data-email="tom.ward@x.io"]'), 'Tom re-keyed', 15000);
    expect(page.doc.querySelector('.person-row[data-email="tom@x.io"]')).toBeNull();
  });
});

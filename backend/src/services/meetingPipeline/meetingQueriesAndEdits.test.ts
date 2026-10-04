import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createApp } from '../../server';
import { createMeetingPipeline, createPipelineStores } from './meetingPipelineService';
import { createDemoProviders } from './demoProviders';
import { StageOrderError } from './errors';
import { MinutesEdits } from './minutesEditing';

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
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 8) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

const draftOnly = () => Object.assign(createDemoProviders(), { emailMode: 'draft-only' as const });
const input = (salt: string) => ({ originalFilename: 'm.wav', buffer: wav(salt), source: 'room_mic' as const, attendeeNames: ['Alice', 'Bob'], meetingContext: { title: `Meeting ${salt}` } });

/** Edits mirroring the current draft, with one change applied by `change`. */
function editsFrom(run: ReturnType<ReturnType<typeof createMeetingPipeline>['getRun']>, change: (e: MinutesEdits) => void): MinutesEdits {
  const e: MinutesEdits = {
    discussionTopics: run.minutes.discussionTopics.map((t) => ({ topic: t.topic, summary: t.summary })),
    decisions: run.minutes.decisions.map((d) => ({ decision: d.decision, rationale: d.rationale, approver: d.approver })),
    actionItems: run.minutes.actionItems.map((a) => ({ task: a.task, owner: a.owner, dueDate: a.dueDate, done: a.status === 'done' })),
  };
  change(e);
  return e;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('meeting list and action items (read-only)', () => {
  it('lists drafts and approved meetings with a status derived from the real stage', async () => {
    const pipeline = createMeetingPipeline(draftOnly(), createPipelineStores({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'list-')) }));
    expect(pipeline.listMeetings()).toEqual([]);
    const a = await pipeline.draftMinutes(input('a'));
    const b = await pipeline.draftMinutes(input('b'));
    await pipeline.approveMinutes(b.runId, 'R');
    await pipeline.approveEmailsAndSend(b.runId, 'R');

    const list = pipeline.listMeetings();
    expect(list.map((m) => [m.runId, m.status])).toEqual(expect.arrayContaining([[a.runId, 'needs_review'], [b.runId, 'approved']]));
    expect(list.find((m) => m.runId === b.runId)).toMatchObject({ title: 'Meeting b', participants: ['Alice', 'Bob'], actionItemCount: 2 });
    const items = pipeline.listActionItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ runId: b.runId, meetingTitle: 'Meeting b', status: 'Not Started' });
  });
});

describe('reviewer edits (autosave)', () => {
  it('saves edits through the revise rule, recomputes flags, keeps timestamps, and flows into the email draft', async () => {
    const stores = createPipelineStores();
    const pipeline = createMeetingPipeline(draftOnly(), stores);
    const run = await pipeline.draftMinutes(input('edit'));
    const before = run.minutes.actionItems[0];
    expect(before.missingFields).toContain('dueDate');

    const edited = pipeline.reviseMinutes(run.runId, editsFrom(run, (e) => {
      e.actionItems[0] = { task: 'Send the plan to stakeholders', owner: 'Alice', dueDate: '2026-10-31', done: true };
      e.decisions[0].rationale = 'QA needs a week';
    }), 'Reviewer');

    const item = edited.minutes.actionItems[0];
    expect(item).toMatchObject({ task: 'Send the plan to stakeholders', owner: 'Alice', dueDate: '2026-10-31', status: 'done', sourceTimestampMs: before.sourceTimestampMs });
    expect(item.missingFields).not.toContain('dueDate');
    expect(edited.minutes.decisions[0].missingFields).not.toContain('rationale');
    expect(stores.minutesGate.get(run.runId)?.revisions).toHaveLength(1);

    // Identical autosave is a no-op.
    pipeline.reviseMinutes(run.runId, editsFrom(edited, () => undefined));
    expect(stores.minutesGate.get(run.runId)?.revisions).toHaveLength(1);

    const withEmails = await pipeline.approveMinutes(run.runId, 'Reviewer');
    expect(withEmails.emails?.emails.find((e) => e.participantName === 'Alice')?.body).toContain('Send the plan to stakeholders (due 2026-10-31)');
  });

  it('refuses edits after approval and edits made to a different shape of minutes', async () => {
    const pipeline = createMeetingPipeline(draftOnly(), createPipelineStores());
    const run = await pipeline.draftMinutes(input('edit-locked'));
    expect(() => pipeline.reviseMinutes(run.runId, editsFrom(run, (e) => e.actionItems.pop()))).toThrow(StageOrderError);
    await pipeline.approveMinutes(run.runId, 'R');
    expect(() => pipeline.reviseMinutes(run.runId, editsFrom(run, () => undefined))).toThrow(/already approved/);
  });
});

describe('routes', () => {
  it('GET /api/meetings, GET /api/meetings/action-items/all, POST /:runId/minutes', async () => {
    const app = createApp({ meetingPipeline: createMeetingPipeline(draftOnly(), createPipelineStores()) });
    const created = await request(app).post('/api/meetings/draft').field('attendees', 'Alice').attach('audio', wav('route-edit'), 'm.wav');
    const id = encodeURIComponent(created.body.runId);
    expect((await request(app).get('/api/meetings')).body.meetings).toHaveLength(1);
    expect((await request(app).get('/api/meetings/action-items/all')).body.actionItems).toEqual([]);

    const edits = editsFrom(created.body, (e) => (e.actionItems[0].owner = 'Alice'));
    const saved = await request(app).post(`/api/meetings/${id}/minutes`).send({ ...edits, editedBy: 'R' });
    expect(saved.status).toBe(200);
    expect(saved.body.minutes.actionItems[0].owner).toBe('Alice');

    const bad = await request(app).post(`/api/meetings/${id}/minutes`).send({ ...edits, actionItems: [{ ...edits.actionItems[0], dueDate: 'Friday' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/2026-10-31/);
    await request(app).post(`/api/meetings/${id}/approve-minutes`).send({ approvedBy: 'R' });
    expect((await request(app).post(`/api/meetings/${id}/minutes`).send(edits)).status).toBe(409);
  });
});

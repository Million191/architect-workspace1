import { createMeetingPipeline, createPipelineStores } from './meetingPipelineService';
import { createDemoProviders } from './demoProviders';
import { RunNotFoundError, StageOrderError } from './errors';
import { DraftMinutesInput } from './types';

/** Human-in-the-loop actions: statuses, request changes, email edits, participant corrections, delete. */
function wavBuffer(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + 8000, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(8000, 40);
  const samples = Buffer.alloc(8000);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}
const input = (salt: string): DraftMinutesInput => ({
  originalFilename: 'meeting.wav', buffer: wavBuffer(salt), source: 'room_mic', attendeeNames: ['Sara Lee', 'Tom Ward'],
  attendeeEmails: { 'Sara Lee': 'sara@x.io', 'Tom Ward': 'tom@x.io' }, meetingContext: { title: 'Launch sync' },
});
async function setup(salt: string) {
  const stores = createPipelineStores();
  const pipeline = createMeetingPipeline(createDemoProviders(), stores);
  const { runId } = await pipeline.draftMinutes(input(salt));
  return { pipeline, stores, runId };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('statuses', () => {
  it('Needs review → In progress (any review work) → Emails drafted (explicit approval only) → Sent', async () => {
    const { pipeline, runId } = await setup('st-1');
    const status = () => pipeline.listMeetings().find((m) => m.runId === runId)!.status;
    expect(status()).toBe('needs_review');
    expect(pipeline.getRun(runId).status).toBe('needs_review');
    pipeline.correctTranscript(runId, pipeline.getRun(runId).transcript.map((s, i) => (i === 0 ? { ...s, text: 'Corrected.' } : s)));
    expect(status()).toBe('in_progress');
    await pipeline.approveMinutes(runId, 'Sara Lee');
    expect(status()).toBe('emails_drafted');
    await pipeline.approveEmailsAndSend(runId, 'Sara Lee');
    expect(status()).toBe('sent');
  });

  it('an edit, a rename, or a change request each count as review started', async () => {
    for (const [salt, act] of [
      ['st-edit', (p: Awaited<ReturnType<typeof setup>>) => p.pipeline.replaceDraft(p.runId, { ...p.pipeline.getRun(p.runId).minutes, decisions: [] }, 'Sara')],
      ['st-rename', (p: Awaited<ReturnType<typeof setup>>) => p.pipeline.renameMeeting(p.runId, 'New name')],
      ['st-request', (p: Awaited<ReturnType<typeof setup>>) => p.pipeline.requestChanges(p.runId, 'Fix the owner', 'Sara')],
    ] as const) {
      const p = await setup(salt);
      act(p);
      expect(p.pipeline.getRun(p.runId).status).toBe('in_progress');
    }
  });
});

describe('requestChanges', () => {
  it('records the note, approves nothing, and is shown until the next edit', async () => {
    const { pipeline, runId } = await setup('rc-1');
    const before = pipeline.getRun(runId).minutes;
    const run = pipeline.requestChanges(runId, 'Add the budget figures', 'Sara Lee');
    expect(run.stage).toBe('minutes_pending_approval');
    expect(run.minutes).toEqual(before);
    expect(run.changeRequest).toMatchObject({ note: 'Add the budget figures', by: 'Sara Lee' });
    pipeline.replaceDraft(runId, { ...before, decisions: [] }, 'Tom Ward');
    expect(pipeline.getRun(runId).changeRequest).toBeUndefined();
  });

  it('is idempotent for a double click, and refused once the minutes are reviewed or for an unknown meeting', async () => {
    const { pipeline, stores, runId } = await setup('rc-2');
    pipeline.requestChanges(runId, 'Same note', 'Sara');
    pipeline.requestChanges(runId, 'Same note', 'Sara');
    expect(stores.minutesGate.get(runId)!.revisions.filter((r) => r.changesRequested === 'Changes requested: Same note')).toHaveLength(1);
    expect(() => pipeline.requestChanges('nope', 'x')).toThrow(RunNotFoundError);
    await pipeline.approveMinutes(runId, 'Sara');
    expect(() => pipeline.requestChanges(runId, 'Too late')).toThrow(StageOrderError);
  });
});

describe('reviseEmails', () => {
  it('edits one email before the final approval; what is sent is the edited email', async () => {
    const { pipeline, stores, runId } = await setup('em-1');
    expect(() => pipeline.reviseEmails(runId, [{ participantName: 'Sara Lee', subject: 'S', body: 'B' }])).toThrow(/Approve the minutes first/);
    await pipeline.approveMinutes(runId, 'Sara Lee');
    const run = pipeline.reviseEmails(runId, [{ participantName: 'Sara Lee', subject: 'Minutes: Launch sync', body: 'Hi Sara,\nEdited body.' }], 'Sara Lee');
    const sara = run.emails!.emails.find((e) => e.participantName === 'Sara Lee')!;
    expect(sara).toMatchObject({ subject: 'Minutes: Launch sync', body: 'Hi Sara,\nEdited body.' });
    expect(run.emails!.emails.find((e) => e.participantName === 'Tom Ward')!.subject).not.toBe('Minutes: Launch sync');
    // Same edit again: no new revision on Gate #2.
    const revisions = () => stores.emailGate.get(runId)!.revisions.length;
    expect(revisions()).toBe(1);
    pipeline.reviseEmails(runId, [{ participantName: 'Sara Lee', subject: 'Minutes: Launch sync', body: 'Hi Sara,\nEdited body.' }]);
    expect(revisions()).toBe(1);
    expect(() => pipeline.reviseEmails(runId, [{ participantName: 'Nobody', subject: 'S', body: 'B' }])).toThrow(/no email to “Nobody”/);
    const sent = await pipeline.approveEmailsAndSend(runId, 'Sara Lee');
    expect(sent.emails!.emails.find((e) => e.participantName === 'Sara Lee')!.body).toBe('Hi Sara,\nEdited body.');
    expect(() => pipeline.reviseEmails(runId, [{ participantName: 'Sara Lee', subject: 'S', body: 'B' }])).toThrow(/already reviewed/);
  });
});

describe('updateParticipants', () => {
  it('renames a participant in the attendee list, the transcript speakers and the addresses; adds and removes people', async () => {
    const { pipeline, runId } = await setup('pp-1');
    const speaker = pipeline.getRun(runId).transcript.find((s) => s.speakerLabel === 'Tom Ward');
    const run = pipeline.updateParticipants(runId, [{ from: 'Sara Lee', name: 'Sara Lee' }, { from: 'Tom Ward', name: 'Thomas Ward', email: 'thomas@x.io' }, { name: 'Priya', email: 'priya@x.io' }], 'Sara');
    expect(run.minutes.meetingSummary.attendees).toEqual(['Sara Lee', 'Thomas Ward', 'Priya']);
    expect(run.recipients).toEqual({ 'Sara Lee': 'sara@x.io', 'Thomas Ward': 'thomas@x.io', Priya: 'priya@x.io' });
    if (speaker) expect(run.transcript.some((s) => s.speakerLabel === 'Thomas Ward')).toBe(true);
    expect(run.transcript.some((s) => s.speakerLabel === 'Tom Ward')).toBe(false);
    expect(run.status).toBe('in_progress');
    // Same list again: nothing changes.
    const again = pipeline.updateParticipants(runId, [{ from: 'Sara Lee', name: 'Sara Lee' }, { from: 'Thomas Ward', name: 'Thomas Ward' }, { from: 'Priya', name: 'Priya' }]);
    expect(again.recipients).toEqual(run.recipients);
  });

  it('is refused after approval', async () => {
    const { pipeline, runId } = await setup('pp-2');
    await pipeline.approveMinutes(runId, 'Sara');
    expect(() => pipeline.updateParticipants(runId, [{ name: 'X' }])).toThrow(StageOrderError);
  });
});

describe('deleteMeeting', () => {
  it('removes the meeting and its action items from every list; deleting again is a no-op', async () => {
    const { pipeline, stores, runId } = await setup('del-1');
    await pipeline.approveMinutes(runId, 'Sara');
    await pipeline.approveEmailsAndSend(runId, 'Sara');
    expect(pipeline.listActionItems().some((a) => a.runId === runId)).toBe(true);
    expect(pipeline.deleteMeeting(runId)).toBe(true);
    expect(pipeline.listMeetings().some((m) => m.runId === runId)).toBe(false);
    expect(pipeline.listActionItems().some((a) => a.runId === runId)).toBe(false);
    expect(() => pipeline.getRun(runId)).toThrow(RunNotFoundError);
    expect([...stores.sentEmails.keys()].some((k) => k.startsWith(`${runId}:`))).toBe(true); // a re-upload never emails anyone twice
    expect(pipeline.deleteMeeting(runId)).toBe(false);
  });

  it('a deleted draft can be uploaded again as a fresh review', async () => {
    const { pipeline, runId } = await setup('del-2');
    pipeline.requestChanges(runId, 'x', 'Sara');
    pipeline.deleteMeeting(runId);
    const again = await pipeline.draftMinutes(input('del-2'));
    expect(again.runId).toBe(runId);
    expect(again.status).toBe('needs_review');
  });
});

describe('reopenMinutes (editing reviewed minutes)', () => {
  it('withdraws the approval: back to Needs review, email draft and approval record removed; transcript and addresses kept', async () => {
    const { pipeline, stores, runId } = await setup('ro-1');
    await pipeline.approveMinutes(runId, 'Sara');
    await pipeline.approveEmailsAndSend(runId, 'Sara');
    const transcript = pipeline.getRun(runId).transcript;
    stores.speakers.delete(runId); // as after a restart: only the saved approval record has the transcript
    expect(pipeline.reopenMinutes(runId, 'Sara')).toBe(true);
    const run = pipeline.getRun(runId);
    expect(run).toMatchObject({ stage: 'minutes_pending_approval', status: 'needs_review' });
    expect(run.finalApproval).toBeUndefined();
    expect(run.emails).toBeUndefined();
    expect(run.transcript).toEqual(transcript);
    expect(run.recipients).toMatchObject({ 'Sara Lee': 'sara@x.io' });
    expect(pipeline.listActionItems().some((a) => a.runId === runId)).toBe(false);
    // Editing afterwards keeps it at Needs review (not In progress) until approved again.
    pipeline.replaceDraft(runId, { ...run.minutes, decisions: [] }, 'Sara');
    expect(pipeline.getRun(runId).status).toBe('needs_review');
    expect(pipeline.reopenMinutes(runId, 'Sara')).toBe(false); // idempotent
    await pipeline.approveMinutes(runId, 'Sara');
    expect(pipeline.getRun(runId).status).toBe('emails_drafted');
  });

  it('reopens minutes reviewed with the email still waiting, and refuses unknown meetings', async () => {
    const { pipeline, runId } = await setup('ro-2');
    await pipeline.approveMinutes(runId, 'Sara');
    expect(pipeline.getRun(runId).stage).toBe('emails_pending_approval');
    pipeline.reopenMinutes(runId, 'Sara');
    expect(pipeline.getRun(runId).stage).toBe('minutes_pending_approval');
    await expect(pipeline.approveEmailsAndSend(runId, 'Sara')).rejects.toThrow(StageOrderError);
    expect(() => pipeline.reopenMinutes('nope')).toThrow(RunNotFoundError);
  });
});

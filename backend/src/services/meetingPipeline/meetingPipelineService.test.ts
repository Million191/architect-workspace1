import { createMeetingPipeline, createPipelineStores } from './meetingPipelineService';
import { createDemoProviders } from './demoProviders';
import { PipelineStageFailedError, RunNotFoundError, StageOrderError } from './errors';
import { DraftMinutesInput } from './types';

/** Minimal RIFF/WAVE bytes that pass the ingestion sniffer; `salt` makes each test's audio (and run id) unique. */
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

function input(salt: string, attendeeNames = ['Alice', 'Bob']): DraftMinutesInput {
  return { originalFilename: 'meeting.wav', buffer: wavBuffer(salt), source: 'room_mic', attendeeNames, meetingContext: { title: 'Launch sync' } };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('meeting pipeline', () => {
  it('runs audio → transcript → speakers → summary → decisions → action items, and stops at a draft', async () => {
    const providers = createDemoProviders();
    const pipeline = createMeetingPipeline(providers, createPipelineStores());

    const run = await pipeline.draftMinutes(input('happy'));

    expect(run.stage).toBe('minutes_pending_approval');
    expect(run.providerMode).toBe('demo');
    expect(run.transcript.map((s) => s.speakerLabel)).toEqual(['Alice', 'Bob', 'Alice', 'Bob', 'Bob', 'Alice']);
    expect(run.minutes.meetingSummary.title).toBe('Launch sync');
    expect(run.minutes.discussionTopics).toHaveLength(2);
    expect(run.minutes.decisions[0]).toMatchObject({ decision: 'Move the launch to the end of the month', approver: 'Alice' });
    expect(run.minutes.actionItems.map((a) => a.owner)).toEqual(['Bob', 'Alice']);
    // No due date was ever stated as a date, so none is invented — the items are flagged instead.
    expect(run.minutes.actionItems.every((a) => a.flaggedForReview && a.missingFields.includes('dueDate'))).toBe(true);
    expect(run.emails).toBeUndefined();
    expect(providers.outbox).toHaveLength(0);
  });

  it('drafts emails only after the first approval, and sends only after the second', async () => {
    const providers = createDemoProviders();
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const { runId } = await pipeline.draftMinutes(input('gates'));

    await expect(pipeline.approveEmailsAndSend(runId, 'Reviewer')).rejects.toBeInstanceOf(StageOrderError);
    expect(providers.outbox).toHaveLength(0);

    const afterMinutes = await pipeline.approveMinutes(runId, 'Reviewer');
    expect(afterMinutes.stage).toBe('emails_pending_approval');
    expect(afterMinutes.emails?.emails.map((e) => e.participantName)).toEqual(['Alice', 'Bob']);
    expect(afterMinutes.emails?.emails[1].actionItems.map((a) => a.owner)).toEqual(['Bob']);
    expect(providers.outbox).toHaveLength(0);

    const sent = await pipeline.approveEmailsAndSend(runId, 'Reviewer');
    expect(sent.stage).toBe('sent');
    expect(providers.outbox.map((e) => e.participantName)).toEqual(['Alice', 'Bob']);
    expect(sent.trackedActionItems?.map((t) => t.status)).toEqual(['Not Started', 'Not Started']);
    expect(providers.trackerLog).toHaveLength(2);
  });

  it('is idempotent: re-uploading, re-approving, and re-sending never duplicate side effects', async () => {
    const providers = createDemoProviders();
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const first = await pipeline.draftMinutes(input('replay'));
    const again = await pipeline.draftMinutes(input('replay'));
    expect(again.runId).toBe(first.runId);

    await pipeline.approveMinutes(first.runId, 'Reviewer');
    await pipeline.approveMinutes(first.runId, 'Reviewer');
    await Promise.all([pipeline.approveEmailsAndSend(first.runId, 'Reviewer'), pipeline.approveEmailsAndSend(first.runId, 'Reviewer')]);
    await pipeline.approveEmailsAndSend(first.runId, 'Reviewer');
    const reuploadAfterSend = await pipeline.draftMinutes(input('replay'));

    expect(providers.outbox).toHaveLength(2);
    expect(providers.trackerLog).toHaveLength(2);
    expect(reuploadAfterSend.stage).toBe('sent');
  });

  it('a failed send stops the run; approving again sends only to the remaining recipients', async () => {
    const providers = createDemoProviders();
    const realSend = providers.emailDeliveryClient.send;
    let failBob = true;
    providers.emailDeliveryClient.send = async (email, meta) => {
      if (email.participantName === 'Bob' && failBob) throw new Error('mail provider down');
      return realSend(email, meta);
    };
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const { runId } = await pipeline.draftMinutes(input('partial'));
    await pipeline.approveMinutes(runId, 'Reviewer');

    await expect(pipeline.approveEmailsAndSend(runId, 'Reviewer')).rejects.toMatchObject({ stage: 'email delivery to Bob' });
    expect(pipeline.getRun(runId).stage).toBe('emails_pending_approval');
    expect(providers.trackerLog).toHaveLength(0);

    failBob = false;
    const run = await pipeline.approveEmailsAndSend(runId, 'Reviewer');
    expect(run.stage).toBe('sent');
    expect(providers.outbox.map((e) => e.participantName)).toEqual(['Alice', 'Bob']);
  });

  it('reports which stage failed when a provider breaks, and opens no review', async () => {
    const providers = createDemoProviders();
    providers.diarizationClient.diarize = async () => {
      throw new Error('diarizer unavailable');
    };
    const stores = createPipelineStores();
    const pipeline = createMeetingPipeline(providers, stores);

    const failure = pipeline.draftMinutes(input('broken'));
    await expect(failure).rejects.toBeInstanceOf(PipelineStageFailedError);
    await expect(failure).rejects.toMatchObject({ stage: 'speaker identification' });
    expect(stores.minutesGate.size).toBe(0);
  });

  it('rejects unknown run ids', async () => {
    const pipeline = createMeetingPipeline(createDemoProviders(), createPipelineStores());
    expect(() => pipeline.getRun('nope')).toThrow(RunNotFoundError);
    await expect(pipeline.approveMinutes('nope', 'Reviewer')).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(pipeline.approveEmailsAndSend('nope', 'Reviewer')).rejects.toBeInstanceOf(RunNotFoundError);
  });
});

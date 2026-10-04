import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { createMeetingPipeline, createPipelineStores } from './meetingPipelineService';
import { createDemoProviders } from './demoProviders';
import { createRealProviders } from './providers/realProviders';
import { StageOrderError } from './errors';
import { DraftMinutesInput } from './types';

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
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 3) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

const input = (salt: string): DraftMinutesInput => ({
  originalFilename: 'm.wav',
  buffer: wav(salt),
  source: 'room_mic',
  attendeeNames: ['Alice', 'Bob'],
  attendeeEmails: { Alice: 'alice@example.com' }, // Bob deliberately has no address
});

/** Demo providers switched to draft-only, with a delivery client that fails the test if it is ever called. */
function draftOnlyProviders() {
  const providers = createDemoProviders();
  const send = jest.fn(async () => {
    throw new Error('delivery must never be called in draft-only mode');
  });
  providers.emailDeliveryClient.send = send;
  return { providers: Object.assign(providers, { emailMode: 'draft-only' as const, requiresRecipientAddresses: true }), send };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('draft-only email mode', () => {
  it('keeps both approvals, shows the drafts, records the final approval and action items, and sends nothing', async () => {
    const { providers, send } = draftOnlyProviders();
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const { runId } = await pipeline.draftMinutes(input('draft-only'));

    await expect(pipeline.approveEmailsAndSend(runId, 'Reviewer')).rejects.toBeInstanceOf(StageOrderError);

    const drafted = await pipeline.approveMinutes(runId, 'Reviewer');
    expect(drafted.stage).toBe('emails_pending_approval');
    expect(drafted.emailMode).toBe('draft-only');
    expect(drafted.emails?.emails.map((e) => e.participantName)).toEqual(['Alice', 'Bob']);
    expect(drafted.recipients).toEqual({ Alice: 'alice@example.com' });

    // A missing address does not block: nothing is going to be sent.
    const approved = await pipeline.approveEmailsAndSend(runId, 'Reviewer');
    expect(approved.stage).toBe('approved_not_sent');
    expect(approved.finalApproval).toMatchObject({ approvedBy: 'Reviewer', emailMode: 'draft-only' });
    expect(approved.sentTo).toEqual([]);
    expect(approved.trackedActionItems?.map((t) => t.status)).toEqual(['Not Started', 'Not Started']);
    expect(providers.trackerLog).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('is idempotent: approving again records nothing twice', async () => {
    const { providers, send } = draftOnlyProviders();
    const pipeline = createMeetingPipeline(providers, createPipelineStores({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'draft-only-')) }));
    const { runId } = await pipeline.draftMinutes(input('draft-only-replay'));
    await pipeline.approveMinutes(runId, 'Reviewer');
    await Promise.all([pipeline.approveEmailsAndSend(runId, 'Reviewer'), pipeline.approveEmailsAndSend(runId, 'Reviewer')]);
    const again = await pipeline.approveEmailsAndSend(runId, 'Someone else');
    expect(again.finalApproval?.approvedBy).toBe('Reviewer');
    expect(providers.trackerLog).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('real providers email mode', () => {
  const whisperless = { WHISPER_PROJECT_DIR: path.join(__dirname, 'nowhere') };

  it('is draft-only by default and needs no SMTP settings', () => {
    const providers = createRealProviders(whisperless);
    expect(providers.emailMode).toBe('draft-only');
    expect(providers.readiness?.send).toEqual([]);
    expect(providers.description?.email).toBe('Email sending disabled — draft only');
  });

  it('ignores SMTP variables unless EMAIL_MODE=smtp, and then requires all of them', () => {
    expect(createRealProviders({ ...whisperless, SMTP_HOST: 'smtp.gmail.com' }).emailMode).toBe('draft-only');
    const sending = createRealProviders({ ...whisperless, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com' });
    expect(sending.emailMode).toBe('send');
    expect(sending.readiness?.send.join(' ')).toMatch(/SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM/);
  });
});

describe('draft email after final approval', () => {
  it('stays in the run — with zero decisions/action items — and survives a server restart', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'draft-kept-'));
    const providers = draftOnlyProviders().providers;
    // A meeting where nothing was decided or assigned.
    providers.decisionExtractionClient.extractDecisions = async () => [];
    providers.actionItemExtractionClient.extractActionItems = async () => [];
    const first = createMeetingPipeline(providers, createPipelineStores({ dataDir }));
    const { runId } = await first.draftMinutes(input('kept-after-approval'));
    const drafted = await first.approveMinutes(runId, 'Reviewer');
    const approved = await first.approveEmailsAndSend(runId, 'Reviewer');

    expect(approved.stage).toBe('approved_not_sent');
    expect(approved.minutes.decisions).toEqual([]);
    expect(approved.minutes.actionItems).toEqual([]);
    expect(approved.emails).toEqual(drafted.emails);
    expect(approved.recipients).toEqual({ Alice: 'alice@example.com' });

    // Restart: new pipeline, same data folder; the recording is uploaded again.
    const second = createMeetingPipeline(draftOnlyProviders().providers, createPipelineStores({ dataDir }));
    const reloaded = await second.draftMinutes(input('kept-after-approval'));
    expect(reloaded.stage).toBe('approved_not_sent');
    expect(reloaded.emails?.emails.map((e) => [e.participantName, e.subject, e.body])).toEqual(
      drafted.emails?.emails.map((e) => [e.participantName, e.subject, e.body])
    );
    expect(reloaded.finalApproval).toMatchObject({ approvedBy: 'Reviewer', emailMode: 'draft-only' });
  });
});

describe('approved meeting record', () => {
  it('reloads after a restart without re-uploading, and re-uploading reopens it without transcribing again', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-record-'));
    const first = createMeetingPipeline(draftOnlyProviders().providers, createPipelineStores({ dataDir }));
    const { runId } = await first.draftMinutes(input('saved-record'));
    await first.approveMinutes(runId, 'Reviewer');
    const approved = await first.approveEmailsAndSend(runId, 'Reviewer');

    // Restart: nothing in memory, only backend/data.
    const { providers, send } = draftOnlyProviders();
    const transcribe = jest.spyOn(providers.transcriptionClient, 'transcribe');
    const second = createMeetingPipeline(providers, createPipelineStores({ dataDir }));

    const reloaded = second.getRun(runId);
    expect(reloaded.stage).toBe('approved_not_sent');
    expect(reloaded.minutes).toEqual(approved.minutes);
    expect(reloaded.transcript).toEqual(approved.transcript);
    expect(reloaded.transcript.length).toBeGreaterThan(0);
    expect(reloaded.emails).toEqual(approved.emails);
    expect(reloaded.recipients).toEqual(approved.recipients);
    expect(reloaded.finalApproval).toEqual(approved.finalApproval);

    const reuploaded = await second.draftMinutes(input('saved-record'));
    expect(reuploaded.emails).toEqual(approved.emails);
    expect(transcribe).not.toHaveBeenCalled();

    // Approving again is a harmless no-op on a saved record; nothing is ever sent.
    expect((await second.approveMinutes(runId, 'Someone')).stage).toBe('approved_not_sent');
    expect((await second.approveEmailsAndSend(runId, 'Someone')).finalApproval?.approvedBy).toBe('Reviewer');
    expect(send).not.toHaveBeenCalled();
  });
});

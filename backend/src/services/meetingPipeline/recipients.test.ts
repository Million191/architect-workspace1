import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { createMeetingPipeline, createPipelineStores } from './meetingPipelineService';
import { createDemoProviders, DemoProviders } from './demoProviders';
import { RecipientProblemError } from './errors';
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
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 5) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

/** Demo providers acting like real SMTP: addresses required, optional allowlist, and every `to` recorded. */
function liveLike(allowed?: string[]): DemoProviders & { sentTo: Array<string | undefined> } {
  const providers = createDemoProviders();
  const sentTo: Array<string | undefined> = [];
  const send = providers.emailDeliveryClient.send;
  providers.emailDeliveryClient.send = async (email, meta) => {
    sentTo.push(meta.to);
    return send(email, meta);
  };
  return Object.assign(providers, {
    sentTo,
    requiresRecipientAddresses: true,
    checkRecipients: (addresses: string[]) => {
      const blocked = allowed ? addresses.filter((a) => !allowed.includes(a)) : [];
      return blocked.length ? [`Not allowed: ${blocked.join(', ')}`] : [];
    },
  });
}

const input = (salt: string, emails?: Record<string, string>): DraftMinutesInput => ({
  originalFilename: 'm.wav',
  buffer: wav(salt),
  source: 'room_mic',
  attendeeNames: ['Alice', 'Bob'],
  attendeeEmails: emails,
});

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('recipients and the final approval', () => {
  it('refuses to approve or send when an attendee has no address, and sends nothing', async () => {
    const providers = liveLike();
    const stores = createPipelineStores();
    const pipeline = createMeetingPipeline(providers, stores);
    const { runId } = await pipeline.draftMinutes(input('no-address', { Alice: 'alice@example.com' }));
    await pipeline.approveMinutes(runId, 'Reviewer');

    await expect(pipeline.approveEmailsAndSend(runId, 'Reviewer')).rejects.toBeInstanceOf(RecipientProblemError);
    expect(providers.outbox).toHaveLength(0);
    expect(stores.emailGate.get(runId)?.status).toBe('pending_review');

    // Re-uploading with the missing address fixes it; the same run continues.
    await pipeline.draftMinutes(input('no-address', { Bob: 'bob@example.com' }));
    const sent = await pipeline.approveEmailsAndSend(runId, 'Reviewer');
    expect(sent.stage).toBe('sent');
    expect(providers.sentTo).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('honours the allowlist before anything is approved or sent', async () => {
    const providers = liveLike(['alice@example.com']);
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const { runId } = await pipeline.draftMinutes(input('allowlist', { Alice: 'alice@example.com', Bob: 'bob@example.com' }));
    await pipeline.approveMinutes(runId, 'Reviewer');
    await expect(pipeline.approveEmailsAndSend(runId, 'Reviewer')).rejects.toMatchObject({ problems: ['Not allowed: bob@example.com'] });
    expect(providers.outbox).toHaveLength(0);
  });

  it('never re-sends after a server restart: the sent log and tracker log are on disk', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pipeline-data-'));
    const emails = { Alice: 'alice@example.com', Bob: 'bob@example.com' };

    const firstProviders = liveLike();
    const first = createMeetingPipeline(firstProviders, createPipelineStores({ dataDir }));
    const { runId } = await first.draftMinutes(input('restart', emails));
    await first.approveMinutes(runId, 'Reviewer');
    await first.approveEmailsAndSend(runId, 'Reviewer');
    expect(firstProviders.outbox).toHaveLength(2);
    expect(firstProviders.trackerLog).toHaveLength(2);

    // "Restart": fresh pipeline and providers, same data folder, same recording uploaded and approved again.
    const secondProviders = liveLike();
    const second = createMeetingPipeline(secondProviders, createPipelineStores({ dataDir }));
    await second.draftMinutes(input('restart', emails));
    await second.approveMinutes(runId, 'Reviewer');
    const again = await second.approveEmailsAndSend(runId, 'Reviewer');
    expect(secondProviders.outbox).toHaveLength(0);
    expect(secondProviders.trackerLog).toHaveLength(0);
    expect(again.stage).toBe('sent');
  });
});

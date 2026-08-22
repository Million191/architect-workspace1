import { ingestVirtualMeetingRecording, AudioIngestionLogger } from './audioIngestionService';
import { CorruptedAudioError, TaggingError, UnsupportedFormatError } from './errors';
import { IngestedAudio, PlatformClient, PlatformRecording, VirtualMeetingPlatform } from './types';

function fakeClient(recording: PlatformRecording): PlatformClient {
  return { fetchRecording: jest.fn().mockResolvedValue(recording) };
}

function fakeLogger(): AudioIngestionLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('ingestVirtualMeetingRecording', () => {
  it('happy path: valid m4a recording becomes available for transcription and logs its source', async () => {
    const client = fakeClient({
      files: [{ id: 'file-1', fileExtension: 'M4A', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/file-1' }],
    });
    const logger = fakeLogger();
    const idempotencyStore = new Map<string, IngestedAudio>();

    const result = await ingestVirtualMeetingRecording('zoom', 'meeting-1', { client, logger, idempotencyStore });

    expect(result.status).toBe('available_for_transcription');
    expect(result.source).toBe('zoom');
    expect(result.format).toBe('m4a');
    expect(result.sourceRecordingId).toBe('file-1');
    expect(result.downloadUrl).toBe('https://zoom.example/file-1');

    const [event, context] = logger.calls[0];
    expect(event).toBe('audio_ingested');
    expect(context).toMatchObject({ platform: 'zoom', meetingRef: 'meeting-1', sourceRecordingId: 'file-1' });

    const [tagEvent, tagContext] = logger.calls[1];
    expect(tagEvent).toBe('output_tagged');
    expect(tagContext).toMatchObject({
      platform: 'zoom',
      meetingType: 'Virtual',
      header: '[Virtual — Zoom]',
      locationUnknown: false,
    });
  });

  it('happy path: an mp4 recording (Teams\' only format) is accepted, not rejected as unsupported', async () => {
    const client = fakeClient({
      files: [{ id: 'file-teams-1', fileExtension: 'mp4', fileSizeBytes: 8192, downloadUrl: 'https://graph.example/file-teams-1' }],
    });

    const result = await ingestVirtualMeetingRecording('teams', 'online-meeting-1', { client, idempotencyStore: new Map() });

    expect(result.status).toBe('available_for_transcription');
    expect(result.source).toBe('teams');
    expect(result.format).toBe('mp4');
  });

  it('failure path: rejects an unsupported format with a clear error', async () => {
    const client = fakeClient({
      files: [{ id: 'file-2', fileExtension: 'MOV', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/file-2' }],
    });

    await expect(
      ingestVirtualMeetingRecording('zoom', 'meeting-2', { client, idempotencyStore: new Map() })
    ).rejects.toThrow(UnsupportedFormatError);
  });

  it('failure path: rejects a recording file with no download URL as corrupted', async () => {
    const client = fakeClient({
      files: [{ id: 'file-3', fileExtension: 'M4A', fileSizeBytes: 4096, downloadUrl: null }],
    });

    await expect(
      ingestVirtualMeetingRecording('zoom', 'meeting-3', { client, idempotencyStore: new Map() })
    ).rejects.toThrow(CorruptedAudioError);
  });

  it('failure path: rejects a zero-byte recording file as corrupted', async () => {
    const client = fakeClient({
      files: [{ id: 'file-4', fileExtension: 'M4A', fileSizeBytes: 0, downloadUrl: 'https://zoom.example/file-4' }],
    });

    await expect(
      ingestVirtualMeetingRecording('zoom', 'meeting-4', { client, idempotencyStore: new Map() })
    ).rejects.toThrow(CorruptedAudioError);
  });

  it('idempotency: ingesting the same recording twice does not create a duplicate record', async () => {
    const client = fakeClient({
      files: [{ id: 'file-5', fileExtension: 'M4A', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/file-5' }],
    });
    const logger = fakeLogger();
    const idempotencyStore = new Map<string, IngestedAudio>();

    const first = await ingestVirtualMeetingRecording('zoom', 'meeting-5', { client, logger, idempotencyStore });
    const second = await ingestVirtualMeetingRecording('zoom', 'meeting-5', { client, logger, idempotencyStore });

    expect(second).toEqual(first);
    expect(idempotencyStore.size).toBe(1);
    expect(logger.calls.map(([event]) => event)).toEqual(['audio_ingested', 'output_tagged', 'audio_ingestion_deduplicated']);
  });

  it('audit trail: a dedup hit gets its own auditEventId even though it shares the resourceId with the original ingest', async () => {
    const client = fakeClient({
      files: [{ id: 'file-audit-1', fileExtension: 'm4a', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/file-audit-1' }],
    });
    const idempotencyStore = new Map<string, IngestedAudio>();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await ingestVirtualMeetingRecording('zoom', 'meeting-audit', { client, idempotencyStore });
      await ingestVirtualMeetingRecording('zoom', 'meeting-audit', { client, idempotencyStore });

      const auditEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      const ingestedEntry = auditEntries.find((entry) => entry.event === 'audio_ingested');
      const dedupEntry = auditEntries.find((entry) => entry.event === 'audio_ingestion_deduplicated');

      expect(ingestedEntry).toBeDefined();
      expect(dedupEntry).toBeDefined();
      expect(dedupEntry.resourceId).toBe(ingestedEntry.resourceId);
      expect(dedupEntry.auditEventId).not.toBe(ingestedEntry.auditEventId);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('concurrency: two simultaneous requests for the same meeting share one upstream call', async () => {
    let callCount = 0;
    const client: PlatformClient = {
      fetchRecording: jest.fn().mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10)); // simulate network latency
        return { files: [{ id: 'file-race', fileExtension: 'm4a', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/file-race' }] };
      }),
    };
    const idempotencyStore = new Map<string, IngestedAudio>();

    const [first, second] = await Promise.all([
      ingestVirtualMeetingRecording('zoom', 'concurrent-meeting', { client, idempotencyStore }),
      ingestVirtualMeetingRecording('zoom', 'concurrent-meeting', { client, idempotencyStore }),
    ]);

    expect(callCount).toBe(1); // not 2 — the second call coalesced onto the first instead of double-hitting Zoom
    expect(second).toEqual(first);
    expect(idempotencyStore.size).toBe(1);
  });

  it('idempotency keys are namespaced per platform: same file id on two platforms never collides', async () => {
    const zoomClient = fakeClient({
      files: [{ id: 'shared-id', fileExtension: 'm4a', fileSizeBytes: 4096, downloadUrl: 'https://zoom.example/shared-id' }],
    });
    const teamsClient = fakeClient({
      files: [{ id: 'shared-id', fileExtension: 'mp4', fileSizeBytes: 8192, downloadUrl: 'https://graph.example/shared-id' }],
    });
    const idempotencyStore = new Map<string, IngestedAudio>();

    const zoomResult = await ingestVirtualMeetingRecording('zoom', 'meeting-6', { client: zoomClient, idempotencyStore });
    const teamsResult = await ingestVirtualMeetingRecording('teams', 'online-meeting-6', { client: teamsClient, idempotencyStore });

    expect(idempotencyStore.size).toBe(2);
    expect(zoomResult.id).not.toBe(teamsResult.id);
  });

  it('failure path: an internal tagging failure propagates cleanly and leaves no partial state (tagging system failure)', async () => {
    const client = fakeClient({
      files: [{ id: 'file-bad-tag', fileExtension: 'm4a', fileSizeBytes: 4096, downloadUrl: 'https://example.com/f' }],
    });
    const logger = fakeLogger();
    const idempotencyStore = new Map<string, IngestedAudio>();
    const unrecognizedPlatform = 'carrier_pigeon' as unknown as VirtualMeetingPlatform;

    await expect(
      ingestVirtualMeetingRecording(unrecognizedPlatform, 'meeting-bad-tag', { client, logger, idempotencyStore })
    ).rejects.toThrow(TaggingError);

    expect(idempotencyStore.size).toBe(0);
    expect(logger.calls.map(([event]) => event)).not.toContain('audio_ingested');
  });
});

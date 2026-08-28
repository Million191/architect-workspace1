import { diarizeAndMapSpeakers, DiarizationLogger } from './diarizationService';
import { DiarizationFailedError } from './errors';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { Attendee, DiarizationClient, NameMappingClient, RawSpeakerSegment, SpeakerMapping, UNIDENTIFIED_SPEAKER_LABEL } from './types';
import { Transcript } from '../transcription/types';

const noBackoff = () => 1; // keep retry tests fast; still exercises the retry path

function fakeTranscript(id = 'transcript-1'): Transcript {
  return {
    id,
    audioId: 'audio-1',
    generatedAt: new Date().toISOString(),
    segments: [
      { startMs: 0, endMs: 1000, text: 'Hello everyone.' },
      { startMs: 1000, endMs: 2000, text: 'Thanks for joining.' },
    ],
  };
}

function fakeDiarizationClient(segments: RawSpeakerSegment[]): DiarizationClient {
  return { diarize: jest.fn().mockResolvedValue(segments) };
}

function fakeNameMappingClient(map: Record<string, string>): NameMappingClient {
  return { mapSpeakersToNames: jest.fn().mockResolvedValue(map) };
}

function hangingNameMappingClient(): NameMappingClient {
  return { mapSpeakersToNames: jest.fn().mockImplementation(() => new Promise(() => {})) };
}

function fakeLogger(): DiarizationLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

const twoSpeakerSegments: RawSpeakerSegment[] = [
  { startMs: 0, endMs: 1000, speakerTag: 'SPEAKER_00' },
  { startMs: 1000, endMs: 2000, speakerTag: 'SPEAKER_01' },
];

const attendees: Attendee[] = [{ name: 'Alice' }, { name: 'Bob' }];

describe('diarizeAndMapSpeakers', () => {
  it('happy path: given an attendee list, speakers are mapped to real names', async () => {
    const diarizationClient = fakeDiarizationClient(twoSpeakerSegments);
    const nameMappingClient = fakeNameMappingClient({ SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' });

    const mapping = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
      diarizationClient,
      nameMappingClient,
      idempotencyStore: new Map<string, SpeakerMapping>(),
    });

    expect(mapping.segments[0].speakerLabel).toBe('Alice');
    expect(mapping.segments[0].rawSpeakerTag).toBe('SPEAKER_00');
    expect(mapping.segments[1].speakerLabel).toBe('Bob');
  });

  it("given no attendee list, speakers are labeled 'Unidentified Speaker' without ever calling the name-mapping provider", async () => {
    const diarizationClient = fakeDiarizationClient(twoSpeakerSegments);
    const nameMappingClient = fakeNameMappingClient({});

    const mapping = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), [], {
      diarizationClient,
      nameMappingClient,
      idempotencyStore: new Map<string, SpeakerMapping>(),
    });

    expect(mapping.segments.every((segment) => segment.speakerLabel === UNIDENTIFIED_SPEAKER_LABEL)).toBe(true);
    expect(nameMappingClient.mapSpeakersToNames).not.toHaveBeenCalled();
  });

  it('failure path: a diarization provider that hangs past its timeout fails with DiarizationFailedError after exhausting retries, without ever calling the name-mapping provider', async () => {
    const diarizationClient: DiarizationClient = {
      diarize: jest.fn().mockImplementation(() => new Promise(() => {})), // never settles
    };
    const nameMappingClient = fakeNameMappingClient({});

    await expect(
      diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
        diarizationClient,
        nameMappingClient,
        idempotencyStore: new Map<string, SpeakerMapping>(),
        timeoutMs: 10,
        maxAttempts: 2,
        backoffMs: noBackoff,
      })
    ).rejects.toBeInstanceOf(DiarizationFailedError);

    expect(diarizationClient.diarize).toHaveBeenCalledTimes(2);
    expect(nameMappingClient.mapSpeakersToNames).not.toHaveBeenCalled();
  });

  it("failure path: a name-mapping service that times out degrades every speaker to 'Unidentified Speaker' rather than failing the whole result", async () => {
    const diarizationClient = fakeDiarizationClient(twoSpeakerSegments);
    const nameMappingClient = hangingNameMappingClient();

    const mapping = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
      diarizationClient,
      nameMappingClient,
      idempotencyStore: new Map<string, SpeakerMapping>(),
      timeoutMs: 10,
      maxAttempts: 2,
      backoffMs: noBackoff,
    });

    expect(mapping.segments.every((segment) => segment.speakerLabel === UNIDENTIFIED_SPEAKER_LABEL)).toBe(true);
  });

  it('failure path: a name mapped to someone not on the attendee list is dropped, not trusted', async () => {
    const diarizationClient = fakeDiarizationClient(twoSpeakerSegments);
    const nameMappingClient = fakeNameMappingClient({ SPEAKER_00: 'Charlie', SPEAKER_01: 'Bob' });

    const mapping = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
      diarizationClient,
      nameMappingClient,
      idempotencyStore: new Map<string, SpeakerMapping>(),
    });

    expect(mapping.segments[0].speakerLabel).toBe(UNIDENTIFIED_SPEAKER_LABEL);
    expect(mapping.segments[1].speakerLabel).toBe('Bob');
  });

  it('idempotency: diarizing the same transcript twice does not call either provider a second time', async () => {
    const diarizationClient = fakeDiarizationClient(twoSpeakerSegments);
    const nameMappingClient = fakeNameMappingClient({ SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' });
    const idempotencyStore = new Map<string, SpeakerMapping>();
    const logger = fakeLogger();

    const first = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
      diarizationClient,
      nameMappingClient,
      idempotencyStore,
      logger,
    });
    const second = await diarizeAndMapSpeakers(fakeTranscript(), Buffer.from('audio'), attendees, {
      diarizationClient,
      nameMappingClient,
      idempotencyStore,
      logger,
    });

    expect(second).toEqual(first);
    expect(diarizationClient.diarize).toHaveBeenCalledTimes(1);
    expect(nameMappingClient.mapSpeakersToNames).toHaveBeenCalledTimes(1);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'diarization_attempted',
      'diarization_completed',
      'diarization_deduplicated',
    ]);
  });

  it('trust: speaker-mapping attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const okClient = fakeDiarizationClient(twoSpeakerSegments);
      const okNameClient = fakeNameMappingClient({ SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' });
      await diarizeAndMapSpeakers(fakeTranscript('transcript-ok'), Buffer.from('audio'), attendees, {
        diarizationClient: okClient,
        nameMappingClient: okNameClient,
        idempotencyStore: new Map<string, SpeakerMapping>(),
      });

      const failingClient: DiarizationClient = { diarize: jest.fn().mockImplementation(() => new Promise(() => {})) };
      await expect(
        diarizeAndMapSpeakers(fakeTranscript('transcript-fail'), Buffer.from('audio'), attendees, {
          diarizationClient: failingClient,
          nameMappingClient: fakeNameMappingClient({}),
          idempotencyStore: new Map<string, SpeakerMapping>(),
          timeoutMs: 10,
          maxAttempts: 1,
          backoffMs: noBackoff,
        })
      ).rejects.toBeInstanceOf(DiarizationFailedError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'diarization_attempted' && e.service === 'diarization')).toBe(true);
      expect(successEntries.some((e) => e.event === 'diarization_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'diarization_failed');
      expect(failureEntry).toBeDefined();
      expect(failureEntry.outcome).toBe('failure');
      expect(failureEntry.error_class).toBe('DiarizationFailedError');

      const allIds = [...successEntries, ...failureEntries].map((e) => e.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

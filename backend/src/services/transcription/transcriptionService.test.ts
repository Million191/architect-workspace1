import { transcribeAudio, TranscriptionLogger } from './transcriptionService';
import { AudioDecodingError, ContractViolationError, TimestampMisalignmentError } from './errors';
import { UpstreamTimeoutError } from '../audioIngestion/errors';
import { RawTranscriptSegment, Transcript, TranscriptionClient } from './types';

const noBackoff = () => 1; // keep retry tests fast; still exercises the retry path

function wavBuffer(): Buffer {
  return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
}

function fakeClient(segments: RawTranscriptSegment[]): TranscriptionClient {
  return { transcribe: jest.fn().mockResolvedValue(segments) };
}

function fakeLogger(): TranscriptionLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('transcribeAudio', () => {
  it('happy path: every segment in the resulting transcript carries a start and end timestamp', async () => {
    const client = fakeClient([
      { startMs: 0, endMs: 1500, text: 'Welcome everyone.' },
      { startMs: 1500, endMs: 4200, text: "Let's get started on the roadmap." },
    ]);
    const logger = fakeLogger();

    const transcript = await transcribeAudio('audio-1', 'wav', wavBuffer(), {
      client,
      logger,
      idempotencyStore: new Map<string, Transcript>(),
    });

    expect(transcript.audioId).toBe('audio-1');
    expect(transcript.segments).toHaveLength(2);
    for (const segment of transcript.segments) {
      expect(typeof segment.startMs).toBe('number');
      expect(typeof segment.endMs).toBe('number');
      expect(segment.endMs).toBeGreaterThan(segment.startMs);
      expect(segment.text.length).toBeGreaterThan(0);
    }
    expect(logger.calls.map(([event]) => event)).toEqual(['transcription_attempted', 'transcription_completed']);
  });

  it('failure path: a corrupted audio file fails gracefully with AudioDecodingError, without ever calling the provider', async () => {
    const client = fakeClient([]);
    const corrupted = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]); // matches no known format signature

    await expect(
      transcribeAudio('audio-2', 'wav', corrupted, { client, idempotencyStore: new Map<string, Transcript>() })
    ).rejects.toThrow(AudioDecodingError);

    expect(client.transcribe).not.toHaveBeenCalled();
  });

  it('failure path: a provider that hangs past its timeout fails with UpstreamTimeoutError after exhausting retries', async () => {
    const client: TranscriptionClient = {
      transcribe: jest.fn().mockImplementation(() => new Promise(() => {})), // never settles
    };

    await expect(
      transcribeAudio('audio-3', 'wav', wavBuffer(), {
        client,
        idempotencyStore: new Map<string, Transcript>(),
        timeoutMs: 10,
        maxAttempts: 2,
        backoffMs: noBackoff,
      })
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);

    expect(client.transcribe).toHaveBeenCalledTimes(2);
  });

  it('failure path: out-of-order timestamps are rejected rather than shipped as a misleading timeline', async () => {
    const client = fakeClient([
      { startMs: 2000, endMs: 3000, text: 'Second thing said.' },
      { startMs: 0, endMs: 1000, text: 'First thing said, but returned second.' },
    ]);

    await expect(
      transcribeAudio('audio-4', 'wav', wavBuffer(), { client, idempotencyStore: new Map<string, Transcript>() })
    ).rejects.toThrow(TimestampMisalignmentError);
  });

  it('failure path: a zero-length or reversed segment is rejected', async () => {
    const client = fakeClient([{ startMs: 1000, endMs: 1000, text: 'Instant, impossible segment.' }]);

    await expect(
      transcribeAudio('audio-5', 'wav', wavBuffer(), { client, idempotencyStore: new Map<string, Transcript>() })
    ).rejects.toThrow(TimestampMisalignmentError);
  });

  it('failure path: a non-array provider response is rejected as a contract violation', async () => {
    const client: TranscriptionClient = { transcribe: jest.fn().mockResolvedValue('not an array' as never) };

    await expect(
      transcribeAudio('audio-6', 'wav', wavBuffer(), { client, idempotencyStore: new Map<string, Transcript>() })
    ).rejects.toThrow(ContractViolationError);
  });

  it('idempotency: transcribing the same audio twice does not call the provider a second time', async () => {
    const client = fakeClient([{ startMs: 0, endMs: 1000, text: 'Once.' }]);
    const logger = fakeLogger();
    const idempotencyStore = new Map<string, Transcript>();

    const first = await transcribeAudio('audio-7', 'wav', wavBuffer(), { client, logger, idempotencyStore });
    const second = await transcribeAudio('audio-7', 'wav', wavBuffer(), { client, logger, idempotencyStore });

    expect(second).toEqual(first);
    expect(client.transcribe).toHaveBeenCalledTimes(1);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'transcription_attempted',
      'transcription_completed',
      'transcription_deduplicated',
    ]);
  });

  it('trust: attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const idempotencyStore = new Map<string, Transcript>();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const okClient = fakeClient([{ startMs: 0, endMs: 1000, text: 'Fine.' }]);
      await transcribeAudio('audio-8', 'wav', wavBuffer(), { client: okClient, idempotencyStore });

      const failingClient = fakeClient([{ startMs: 1000, endMs: 1000, text: 'Broken.' }]);
      await expect(
        transcribeAudio('audio-9', 'wav', wavBuffer(), { client: failingClient, idempotencyStore: new Map<string, Transcript>() })
      ).rejects.toThrow(TimestampMisalignmentError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'transcription_attempted' && e.service === 'transcription')).toBe(true);
      expect(successEntries.some((e) => e.event === 'transcription_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'transcription_failed');
      expect(failureEntry).toBeDefined();
      expect(failureEntry.outcome).toBe('failure');
      expect(failureEntry.error_class).toBe('TimestampMisalignmentError');

      const allIds = [...successEntries, ...failureEntries].map((e) => e.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

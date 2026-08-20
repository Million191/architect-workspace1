import { ingestPhysicalRecording } from './physicalAudioIngestionService';
import { CorruptedAudioError, UnsupportedFormatError } from './errors';
import { IngestedAudio } from './types';
import { AudioIngestionLogger } from './audioIngestionService';

function buildWav(samples: number[]): Buffer {
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * bitsPerSample) / 8;

  const dataBuffer = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => dataBuffer.writeInt16LE(s, i * 2));

  const fmtChunk = Buffer.alloc(24);
  fmtChunk.write('fmt ', 0, 'ascii');
  fmtChunk.writeUInt32LE(16, 4);
  fmtChunk.writeUInt16LE(1, 8); // PCM
  fmtChunk.writeUInt16LE(1, 10); // mono
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(byteRate, 16);
  fmtChunk.writeUInt16LE(2, 20); // block align
  fmtChunk.writeUInt16LE(bitsPerSample, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(dataBuffer.length, 4);

  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(4 + fmtChunk.length + dataHeader.length + dataBuffer.length, 4);
  riffHeader.write('WAVE', 8, 'ascii');

  return Buffer.concat([riffHeader, fmtChunk, dataHeader, dataBuffer]);
}

function repeat(values: number[], times: number): number[] {
  return Array.from({ length: times }, () => values).flat();
}

function cleanWav(): Buffer {
  return buildWav(repeat([8000, -8000], 500)); // steady, moderate amplitude — a "clean" recording
}

function noisyWav(): Buffer {
  return buildWav(repeat([100, -100], 500)); // near-silent relative to full scale — "noisy"/too quiet
}

function fakeLogger(): AudioIngestionLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('ingestPhysicalRecording', () => {
  it('happy path: a clean room-mic WAV recording becomes available for transcription, not flagged, and logs its source', () => {
    const logger = fakeLogger();
    const result = ingestPhysicalRecording('room_mic', 'meeting.wav', cleanWav(), {
      logger,
      idempotencyStore: new Map(),
    });

    expect(result.status).toBe('available_for_transcription');
    expect(result.source).toBe('room_mic');
    expect(result.format).toBe('wav');
    expect(result.lowConfidence).toBe(false);
    expect(result.lowConfidenceReason).toBeUndefined();

    const [event, context] = logger.calls[0];
    expect(event).toBe('audio_ingested');
    expect(context).toMatchObject({ source: 'room_mic', originalFilename: 'meeting.wav', lowConfidence: false });
  });

  it('happy path: a phone recording works the same way', () => {
    const result = ingestPhysicalRecording('phone', 'voicemail.wav', cleanWav(), { idempotencyStore: new Map() });
    expect(result.source).toBe('phone');
    expect(result.status).toBe('available_for_transcription');
  });

  it('acceptance: a noisy recording is flagged for low confidence, not silently accepted', () => {
    const result = ingestPhysicalRecording('room_mic', 'noisy.wav', noisyWav(), { idempotencyStore: new Map() });

    expect(result.status).toBe('available_for_transcription'); // still ingested — flagged, not rejected
    expect(result.lowConfidence).toBe(true);
    expect(result.lowConfidenceReason).toMatch(/quiet/i);
  });

  it('failure path: rejects an unsupported file extension with a clear error', () => {
    expect(() =>
      ingestPhysicalRecording('room_mic', 'meeting.mov', cleanWav(), { idempotencyStore: new Map() })
    ).toThrow(UnsupportedFormatError);
  });

  it('failure path: rejects an empty file as corrupted', () => {
    expect(() =>
      ingestPhysicalRecording('room_mic', 'meeting.wav', Buffer.alloc(0), { idempotencyStore: new Map() })
    ).toThrow(CorruptedAudioError);
  });

  it('failure path: rejects a file whose extension does not match its actual content', () => {
    // Named .wav but the bytes are really an MP3 frame — a mislabeled/corrupted upload.
    const mp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    expect(() =>
      ingestPhysicalRecording('room_mic', 'meeting.wav', mp3Bytes, { idempotencyStore: new Map() })
    ).toThrow(CorruptedAudioError);
  });

  it('idempotency: re-uploading the same bytes does not create a duplicate record', () => {
    const logger = fakeLogger();
    const idempotencyStore = new Map<string, IngestedAudio>();
    const bytes = cleanWav();

    const first = ingestPhysicalRecording('room_mic', 'meeting.wav', bytes, { logger, idempotencyStore });
    const second = ingestPhysicalRecording('room_mic', 'meeting-retry.wav', bytes, { logger, idempotencyStore });

    expect(second).toEqual(first);
    expect(idempotencyStore.size).toBe(1);
    expect(logger.calls.map(([event]) => event)).toEqual(['audio_ingested', 'audio_ingestion_deduplicated']);
  });
});

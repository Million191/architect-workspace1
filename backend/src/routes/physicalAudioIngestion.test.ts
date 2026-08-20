import express from 'express';
import request from 'supertest';
import { createPhysicalAudioIngestionRouter } from './physicalAudioIngestion';
import { IngestedAudio } from '../services/audioIngestion/types';

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

function wavBuffer(): Buffer {
  return buildWav(repeat([8000, -8000], 500)); // clean, moderate amplitude
}

function noisyWavBuffer(): Buffer {
  return buildWav(repeat([100, -100], 500)); // near-silent — should be flagged
}

function appWithFreshStore() {
  const app = express();
  app.use(express.json());
  app.use('/api/audio', createPhysicalAudioIngestionRouter({ idempotencyStore: new Map<string, IngestedAudio>() }));
  return app;
}

describe('POST /api/audio/ingest/physical', () => {
  it('acceptance: a physical meeting recording becomes available for transcription (201)', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'room_mic')
      .attach('audio', wavBuffer(), 'meeting.wav');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('available_for_transcription');
    expect(res.body.source).toBe('room_mic');
    expect(res.body.format).toBe('wav');
    expect(res.body.lowConfidence).toBe(false);
  });

  it('acceptance: a noisy recording is ingested but flagged for low confidence, over the real HTTP response', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'room_mic')
      .attach('audio', noisyWavBuffer(), 'noisy.wav');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('available_for_transcription');
    expect(res.body.lowConfidence).toBe(true);
    expect(typeof res.body.lowConfidenceReason).toBe('string');
  });

  it('acceptance: a phone recording is accepted the same way', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'phone')
      .attach('audio', wavBuffer(), 'voicemail.wav');

    expect(res.status).toBe(201);
    expect(res.body.source).toBe('phone');
  });

  it('acceptance: rejects a non-supported audio format with a clear error message (422)', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'room_mic')
      .attach('audio', Buffer.from('not audio at all'), 'meeting.mov');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('UnsupportedFormatError');
    expect(typeof res.body.message).toBe('string');
  });

  it('failure path: rejects an empty file as corrupted (422)', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'room_mic')
      .attach('audio', Buffer.alloc(0), 'meeting.wav');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('CorruptedAudioError');
  });

  it('failure path: rejects a file whose extension does not match its content (422)', async () => {
    const app = appWithFreshStore();
    const mp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]);

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'room_mic')
      .attach('audio', mp3Bytes, 'meeting.wav');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('CorruptedAudioError');
  });

  it('validation: rejects an invalid source value (400)', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .field('source', 'carrier_pigeon')
      .attach('audio', wavBuffer(), 'meeting.wav');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('validation: rejects a request with no file attached (400)', async () => {
    const app = appWithFreshStore();

    const res = await request(app).post('/api/audio/ingest/physical').field('source', 'room_mic');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('idempotency: re-uploading the same bytes twice does not create a duplicate record', async () => {
    const app = appWithFreshStore();
    const bytes = wavBuffer();

    const first = await request(app).post('/api/audio/ingest/physical').field('source', 'room_mic').attach('audio', bytes, 'a.wav');
    const second = await request(app).post('/api/audio/ingest/physical').field('source', 'room_mic').attach('audio', bytes, 'b.wav');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.ingestedAt).toBe(first.body.ingestedAt);
  });

  it('concurrency: two simultaneous identical uploads do not create a duplicate record', async () => {
    const idempotencyStore = new Map();
    const app = express();
    app.use(express.json());
    app.use('/api/audio', createPhysicalAudioIngestionRouter({ idempotencyStore }));
    const bytes = wavBuffer();

    const [r1, r2] = await Promise.all([
      request(app).post('/api/audio/ingest/physical').field('source', 'room_mic').attach('audio', bytes, 'a.wav'),
      request(app).post('/api/audio/ingest/physical').field('source', 'room_mic').attach('audio', bytes, 'b.wav'),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.id).toBe(r2.body.id);
    expect(idempotencyStore.size).toBe(1);
  });

  it('failure path: an oversized upload is rejected with a clear error, not a crash (413)', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/audio', createPhysicalAudioIngestionRouter({ idempotencyStore: new Map(), maxUploadBytes: 100 }));
    const oversized = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(200)]);

    const res = await request(app).post('/api/audio/ingest/physical').field('source', 'room_mic').attach('audio', oversized, 'big.wav');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('PayloadTooLarge');
  });

  it('failure path: a malformed multipart body is rejected, not a crash (400)', async () => {
    const app = appWithFreshStore();

    const res = await request(app)
      .post('/api/audio/ingest/physical')
      .set('Content-Type', 'multipart/form-data; boundary=----garbage')
      .send('this is not a valid multipart body at all');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});

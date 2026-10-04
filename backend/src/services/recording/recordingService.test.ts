import { existsSync, mkdtempSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { createRecordingService, RecordingError } from './recordingService';
import { RecordingStore } from './recordingStore';

function setup(start = Date.parse('2026-10-04T10:00:00Z')) {
  let t = start;
  const root = mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const store = new RecordingStore(root);
  const svc = createRecordingService({ store, now: () => new Date(t) });
  return { svc, store, root, advance: (ms: number) => { t += ms; } };
}
const base = { id: 'rec-00000001', mode: 'in_person' as const, attendees: [{ name: 'Sara', email: 'sara@x.io' }], mimeType: 'audio/webm;codecs=opus', consent: true };

describe('recording service', () => {
  it('create is idempotent on the page id; consent and a supported type are required', () => {
    const { svc } = setup();
    const a = svc.create(base);
    expect(a).toMatchObject({ status: 'recording', extension: 'webm', chunks: [], bytes: 0 });
    expect(svc.create({ ...base, title: 'changed' })).toEqual(a);
    expect(() => svc.create({ ...base, id: 'rec-00000002', consent: false })).toThrow('knows it is being recorded');
    expect(() => svc.create({ ...base, id: 'rec-00000003', mimeType: 'audio/flac' })).toThrow('aren’t supported');
    expect(svc.create({ ...base, id: 'rec-00000004', mimeType: 'audio/mp4' }).extension).toBe('mp4');
  });

  it('chunks may arrive out of order and be re-sent; finish joins them in order and runs the pipeline once', async () => {
    const { svc, store } = setup();
    svc.create(base);
    svc.putChunk(base.id, 2, Buffer.from('CC'));
    svc.putChunk(base.id, 0, Buffer.from('AA'));
    svc.putChunk(base.id, 0, Buffer.from('AA')); // retry after a dropped connection
    expect(svc.get(base.id)).toMatchObject({ chunks: [0, 2], bytes: 4 });

    const draft = jest.fn(async (_m: unknown, audio: Buffer) => ({ runId: `run-${audio.toString()}` }));
    await expect(svc.finish(base.id, { chunkCount: 3 }, draft)).rejects.toMatchObject({ errorClass: 'MissingChunksError', missing: [1] });
    expect(draft).not.toHaveBeenCalled();

    svc.putChunk(base.id, 1, Buffer.from('BB'));
    const done = await svc.finish(base.id, { chunkCount: 3, durationMs: 15000, markers: [{ atMs: 4000, note: 'Budget decision' }] }, draft);
    expect(done).toMatchObject({ status: 'ready', runId: 'run-AABBCC', durationMs: 15000, markers: [{ atMs: 4000, note: 'Budget decision' }] });
    expect(existsSync(store.audioPath(done))).toBe(true);

    // Finishing again returns the same meeting; no second pipeline run.
    expect((await svc.finish(base.id, { chunkCount: 3 }, draft)).runId).toBe('run-AABBCC');
    expect(draft).toHaveBeenCalledTimes(1);
    expect(svc.findByRun('run-AABBCC')!.id).toBe(base.id);
    expect(() => svc.putChunk(base.id, 3, Buffer.from('DD'))).toThrow(RecordingError);
  });

  it('two finishes at once: the second is refused while the first is processing', async () => {
    const { svc } = setup();
    svc.create(base);
    svc.putChunk(base.id, 0, Buffer.from('AA'));
    let release!: () => void;
    const draft = jest.fn(() => new Promise<{ runId: string }>((resolve) => { release = () => resolve({ runId: 'r1' }); }));
    const first = svc.finish(base.id, { chunkCount: 1 }, draft);
    while (!draft.mock.calls.length) await new Promise((r) => setTimeout(r, 5)); // chunks joined, pipeline running
    await expect(svc.finish(base.id, { chunkCount: 1 }, draft)).rejects.toMatchObject({ errorClass: 'RecordingStateError' });
    expect(() => svc.discard(base.id)).toThrow('being processed');
    release();
    expect((await first).status).toBe('ready');
  });

  it('a failed pipeline run leaves the recording safe to retry', async () => {
    const { svc } = setup();
    svc.create(base);
    svc.putChunk(base.id, 0, Buffer.from('AA'));
    const boom = Object.assign(new Error('Whisper timed out'), { errorClass: 'PipelineStageFailedError', stage: 'transcription' });
    await expect(svc.finish(base.id, { chunkCount: 1 }, async () => { throw boom; })).rejects.toBe(boom);
    expect(svc.get(base.id)).toMatchObject({ status: 'failed', error: { errorClass: 'PipelineStageFailedError', stage: 'transcription', message: 'Whisper timed out' } });
    expect((await svc.finish(base.id, { chunkCount: 1 }, async () => ({ runId: 'r2' }))).status).toBe('ready');
  });

  it('rejects empty, oversized, and out-of-range chunks, and finish with nothing recorded', async () => {
    const { svc } = setup();
    svc.create(base);
    expect(() => svc.putChunk(base.id, 0, Buffer.alloc(0))).toThrow('Empty chunk');
    expect(() => svc.putChunk(base.id, -1, Buffer.from('A'))).toThrow('out of range');
    expect(() => svc.putChunk(base.id, 0, Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow('too large');
    expect(() => svc.putChunk('rec-missing1', 0, Buffer.from('A'))).toThrow('isn’t on the server');
    await expect(svc.finish(base.id, { chunkCount: 0 }, async () => ({ runId: 'x' }))).rejects.toThrow('No audio was recorded');
  });

  it('retention: after approval or after 30 days deletes the audio (never the record); keep keeps it; idempotent', async () => {
    const { svc, store, root, advance } = setup();
    for (const id of ['rec-aaaaaaaa', 'rec-bbbbbbbb']) {
      svc.create({ ...base, id });
      svc.putChunk(id, 0, Buffer.from('AA'));
      await svc.finish(id, { chunkCount: 1 }, async () => ({ runId: `run-${id}` }));
    }
    expect(svc.applyRetention('keep', () => true)).toEqual([]);
    expect(svc.applyRetention('after_approval', (runId) => runId === 'run-rec-aaaaaaaa')).toEqual(['rec-aaaaaaaa']);
    expect(readdirSync(path.join(root, 'rec-aaaaaaaa'))).toEqual(['meta.json']);
    expect(svc.get('rec-aaaaaaaa').audioDeletedAt).toBeDefined();
    expect(svc.applyRetention('after_approval', () => true)).toEqual(['rec-bbbbbbbb']);
    expect(svc.applyRetention('after_approval', () => true)).toEqual([]); // nothing left to do

    svc.create({ ...base, id: 'rec-cccccccc' });
    svc.putChunk('rec-cccccccc', 0, Buffer.from('AA'));
    await svc.finish('rec-cccccccc', { chunkCount: 1 }, async () => ({ runId: 'run-c' }));
    expect(svc.applyRetention('30_days', () => false)).toEqual([]);
    advance(31 * 24 * 3600 * 1000);
    expect(svc.applyRetention('30_days', () => false)).toEqual(['rec-cccccccc']);
    expect(existsSync(store.audioPath(svc.get('rec-cccccccc')))).toBe(false);
  });

  it('discard removes everything for a recording that is not processing', () => {
    const { svc, root } = setup();
    svc.create(base);
    svc.putChunk(base.id, 0, Buffer.from('AA'));
    svc.discard(base.id);
    expect(existsSync(path.join(root, base.id))).toBe(false);
    expect(() => svc.get(base.id)).toThrow(RecordingError);
  });
});

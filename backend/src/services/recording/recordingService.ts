import { readFileSync } from 'fs';
import { RecordingStore } from './recordingStore';
import { RawAudioRetention, RecordingAttendee, RecordingMarker, RecordingMeta, RecordingMode } from './types';

export class RecordingError extends Error {
  constructor(readonly errorClass: 'RecordingNotFoundError' | 'RecordingStateError' | 'MissingChunksError' | 'RecordingValidationError', message: string, readonly missing?: number[]) {
    super(message);
  }
}

/** MediaRecorder types the server accepts, and the extension the joined file gets. */
export const RECORDING_TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/wav': 'wav' };
export const MAX_CHUNKS = 20000; // 5-second chunks: > 27 hours
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export interface CreateRecordingInput {
  id: string;
  mode: RecordingMode;
  title?: string;
  attendees: RecordingAttendee[];
  scheduledMeetingId?: string;
  mimeType: string;
  consent: boolean;
  confirmedBy?: string;
}

/** Turns joined audio into a meeting run (the same pipeline as an upload). Injected so tests need no Whisper. */
export type DraftFromRecording = (meta: RecordingMeta, audio: Buffer, filename: string) => Promise<{ runId: string }>;

export function createRecordingService(opts: { store: RecordingStore; now?: () => Date }) {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  const inFlight = new Set<string>();

  function get(id: string): RecordingMeta {
    const m = store.get(id);
    if (!m) throw new RecordingError('RecordingNotFoundError', 'That recording isn’t on the server.');
    return m;
  }
  function touch(meta: RecordingMeta, patch: Partial<RecordingMeta>): RecordingMeta {
    const next = { ...meta, ...patch, updatedAt: now().toISOString() };
    store.save(next);
    return next;
  }

  return {
    get,

    /** Idempotent on the page-generated id: creating the same recording twice returns the first one. */
    create(input: CreateRecordingInput): RecordingMeta {
      const existing = store.get(input.id);
      if (existing) return existing;
      if (!input.consent) throw RecordingValidation('Confirm that everyone in the meeting knows it is being recorded.');
      const base = input.mimeType.split(';')[0].trim().toLowerCase();
      const extension = RECORDING_TYPES[base];
      if (!extension) throw RecordingValidation(`Recordings in ${base || 'this format'} aren’t supported.`);
      const at = now().toISOString();
      const meta: RecordingMeta = {
        id: input.id, mode: input.mode, title: input.title, attendees: input.attendees, scheduledMeetingId: input.scheduledMeetingId,
        mimeType: input.mimeType, extension, consent: { confirmedAt: at, confirmedBy: input.confirmedBy },
        status: 'recording', chunks: [], bytes: 0, markers: [], createdAt: at, updatedAt: at,
      };
      store.save(meta);
      return meta;
    },

    /** Stores chunk `index`. Re-sending a chunk (a retry after a dropped connection) is harmless. */
    putChunk(id: string, index: number, data: Buffer): RecordingMeta {
      const meta = get(id);
      if (meta.status !== 'recording' && meta.status !== 'failed') throw new RecordingError('RecordingStateError', 'This recording is already being processed.');
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) throw RecordingValidation('Chunk number out of range.');
      if (!data.length) throw RecordingValidation('Empty chunk.');
      if (data.length > MAX_CHUNK_BYTES) throw RecordingValidation('Chunk too large.');
      const isNew = !meta.chunks.includes(index);
      store.writeChunk(id, index, data);
      if (!isNew) return meta;
      return touch(meta, { chunks: [...meta.chunks, index].sort((a, b) => a - b), bytes: meta.bytes + data.length });
    },

    /**
     * Joins chunks 0..chunkCount-1 and runs the pipeline. Missing chunks → MissingChunksError listing
     * them, so the page re-sends exactly those. Safe to call again: a ready recording returns its
     * meeting; one already processing is refused; a failed one is retried.
     */
    async finish(id: string, input: { chunkCount: number; durationMs?: number; markers?: RecordingMarker[] }, draft: DraftFromRecording): Promise<RecordingMeta> {
      let meta = get(id);
      if (meta.status === 'ready') return meta;
      if (meta.status === 'processing' || inFlight.has(id)) throw new RecordingError('RecordingStateError', 'This recording is already being processed.');
      if (meta.audioDeletedAt) throw new RecordingError('RecordingStateError', 'This recording’s audio was deleted.');
      const count = input.chunkCount;
      if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) throw RecordingValidation('No audio was recorded.');
      const missing: number[] = [];
      for (let i = 0; i < count && missing.length < 500; i++) if (!store.hasChunk(id, i)) missing.push(i);
      if (missing.length) throw new RecordingError('MissingChunksError', `${missing.length} part(s) of the recording haven’t reached the server yet.`, missing);

      inFlight.add(id);
      try {
        meta = touch(meta, { status: 'processing', error: undefined, durationMs: input.durationMs ?? meta.durationMs, markers: input.markers ?? meta.markers });
        const file = await store.joinChunks(meta, count);
        const result = await draft(meta, readFileSync(file), `recording-${meta.createdAt.slice(0, 16).replace(/[:T]/g, '-')}.${meta.extension}`);
        return touch(meta, { status: 'ready', runId: result.runId });
      } catch (error) {
        const e = error as Error & { errorClass?: string; stage?: string };
        touch(meta, { status: 'failed', error: { errorClass: e.errorClass ?? e.name ?? 'Error', message: e.message, stage: e.stage } });
        throw error;
      } finally {
        inFlight.delete(id);
      }
    },

    /** Recordings whose processing failed and that haven't become a meeting (shown as "Failed"). */
    listFailed(): RecordingMeta[] {
      return store.list().filter((m) => m.status === 'failed' && !m.runId);
    },

    findByRun(runId: string): RecordingMeta | undefined {
      return store.list().find((m) => m.runId === runId);
    },

    /** Discards a recording that hasn't become a meeting yet (or its leftovers after one has). */
    discard(id: string): void {
      const meta = get(id);
      if (meta.status === 'processing' || inFlight.has(id)) throw new RecordingError('RecordingStateError', 'This recording is being processed and can’t be discarded right now.');
      store.remove(id);
    },

    /**
     * Applies the raw-audio retention setting: deletes chunks/audio (never the meeting) for recordings
     * whose meeting is approved ('after_approval') or that are older than 30 days ('30_days').
     * Idempotent; returns the ids it cleaned.
     */
    applyRetention(policy: RawAudioRetention, isApproved: (runId: string) => boolean): string[] {
      if (policy === 'keep') return [];
      const cutoff = now().getTime() - 30 * 24 * 3600 * 1000;
      const cleaned: string[] = [];
      for (const m of store.list()) {
        if (m.audioDeletedAt || m.status !== 'ready' || !m.runId) continue;
        const due = policy === 'after_approval' ? isApproved(m.runId) : Date.parse(m.createdAt) < cutoff;
        if (!due) continue;
        store.deleteAudio(m.id);
        touch(m, { audioDeletedAt: now().toISOString() });
        cleaned.push(m.id);
      }
      return cleaned;
    },
  };
}

function RecordingValidation(message: string): RecordingError {
  return new RecordingError('RecordingValidationError', message);
}

export type RecordingService = ReturnType<typeof createRecordingService>;

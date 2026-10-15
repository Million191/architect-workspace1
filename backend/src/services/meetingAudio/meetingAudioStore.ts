import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { RawAudioRetention } from '../recording/types';

/**
 * The audio of uploaded meetings, so the Summary step can play it back (in-app recordings keep their
 * audio in the recording store). One file per meeting, named by a hash of the run id — never by the
 * uploaded file name — so nothing outside this folder can be reached. Saving the same meeting again
 * keeps the first file (idempotent). The "Keep raw meeting audio" setting applies (`applyRetention`).
 *
 * Failure modes: a failed write throws (the caller logs it; the meeting itself is already drafted and
 * is not affected). Not handled: disk full mid-write leaves a .tmp file, removed on the next save.
 */
const MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'audio/webm', ogg: 'audio/ogg' };

export interface MeetingAudio { path: string; mime: string }

export function audioExtension(filename: string): string | undefined {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return MIME[ext] ? ext : undefined;
}

export function createMeetingAudioStore(dir: string, now: () => Date = () => new Date()) {
  const base = (runId: string) => createHash('sha256').update(runId).digest('hex');
  function find(runId: string): MeetingAudio | undefined {
    if (!existsSync(dir)) return undefined;
    const name = readdirSync(dir).find((f) => f.startsWith(base(runId) + '.') && !f.endsWith('.tmp'));
    if (!name) return undefined;
    return { path: path.join(dir, name), mime: MIME[path.extname(name).slice(1)] ?? 'application/octet-stream' };
  }
  return {
    find,
    /** Keeps the uploaded audio for this meeting. Returns false when the type isn't playable or a file is already kept. */
    save(runId: string, buffer: Buffer, filename: string): boolean {
      const ext = audioExtension(filename);
      if (!ext || find(runId)) return false;
      mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${base(runId)}.${ext}`);
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, buffer);
      renameSync(temp, target);
      return true;
    },
    /** The meeting was deleted: its audio goes too. Idempotent. */
    remove(runId: string): void {
      const kept = find(runId);
      if (kept) rmSync(kept.path, { force: true });
    },
    /** Same policy as recordings: after the meeting is reviewed, or 30 days after upload. Returns the run ids cleaned. */
    applyRetention(policy: RawAudioRetention, runIds: string[], isReviewed: (runId: string) => boolean): string[] {
      if (policy === 'keep') return [];
      const cutoff = now().getTime() - 30 * 24 * 3600 * 1000;
      const cleaned: string[] = [];
      for (const runId of runIds) {
        const kept = find(runId);
        if (!kept) continue;
        const due = policy === 'after_approval' ? isReviewed(runId) : statSync(kept.path).mtimeMs < cutoff;
        if (!due) continue;
        rmSync(kept.path, { force: true });
        cleaned.push(runId);
      }
      return cleaned;
    },
  };
}

export type MeetingAudioStore = ReturnType<typeof createMeetingAudioStore>;

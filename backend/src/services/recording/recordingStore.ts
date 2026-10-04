import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { once } from 'events';
import path from 'path';
import { RecordingMeta } from './types';

const ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Recordings on disk: `<root>/<id>/meta.json` plus `chunk-<n>.part` files and, once finished, the
 * joined `audio.<ext>`. Disk (not memory) so a long meeting never sits in RAM and a server restart
 * loses nothing. Metadata writes are atomic (temp file + rename).
 */
export class RecordingStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private dir(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid recording id.');
    return path.join(this.root, id);
  }

  get(id: string): RecordingMeta | undefined {
    const file = path.join(this.dir(id), 'meta.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RecordingMeta) : undefined;
  }

  save(meta: RecordingMeta): void {
    const dir = this.dir(meta.id);
    mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `meta.json.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify(meta, null, 2), 'utf8');
    renameSync(temp, path.join(dir, 'meta.json'));
  }

  list(): RecordingMeta[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID.test(d.name))
      .map((d) => this.get(d.name))
      .filter((m): m is RecordingMeta => !!m);
  }

  chunkPath(id: string, index: number): string {
    return path.join(this.dir(id), `chunk-${String(index).padStart(6, '0')}.part`);
  }

  /** Writes one chunk. Returns false when the identical chunk was already stored (a retry). */
  writeChunk(id: string, index: number, data: Buffer): boolean {
    const file = this.chunkPath(id, index);
    if (existsSync(file) && statSync(file).size === data.length) return false;
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, file);
    return true;
  }

  hasChunk(id: string, index: number): boolean {
    return existsSync(this.chunkPath(id, index));
  }

  audioPath(meta: RecordingMeta): string {
    return path.join(this.dir(meta.id), `audio.${meta.extension}`);
  }

  /** Joins chunks 0..count-1 in order into the audio file (streamed, never all in memory at once). */
  async joinChunks(meta: RecordingMeta, count: number): Promise<string> {
    const target = this.audioPath(meta);
    const temp = `${target}.${process.pid}.tmp`;
    const out = createWriteStream(temp);
    for (let i = 0; i < count; i++) {
      if (!out.write(readFileSync(this.chunkPath(meta.id, i)))) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    renameSync(temp, target);
    return target;
  }

  /** Deletes chunks and the joined audio, keeping meta.json (the record that a meeting was recorded). */
  deleteAudio(id: string): void {
    const dir = this.dir(id);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) if (f !== 'meta.json') rmSync(path.join(dir, f), { force: true });
  }

  remove(id: string): void {
    rmSync(this.dir(id), { recursive: true, force: true });
  }
}

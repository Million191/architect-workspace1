import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * A Map that mirrors itself to a JSON file, so idempotency records (emails already sent, action
 * items already recorded) survive a server restart. Every `set`/`delete` rewrites the file
 * atomically (write to a temp file, then rename), so a crash never leaves half-written JSON.
 *
 * Writes are synchronous on purpose: the files are small, and a send must not be reported as
 * done before its record is on disk. Remaining gap (documented, not handled): a crash between a
 * provider call succeeding and this write completing can still repeat that one call on replay.
 */
export class JsonFileMap<V> extends Map<string, V> {
  private loaded = false;

  constructor(private readonly filePath: string) {
    super();
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, V>;
      for (const [key, value] of Object.entries(raw)) super.set(key, value);
    }
    this.loaded = true;
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    if (this.loaded) this.persist();
    return this;
  }

  override delete(key: string): boolean {
    const removed = super.delete(key);
    if (removed) this.persist();
    return removed;
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(this), null, 2), 'utf8');
    renameSync(temp, this.filePath);
  }
}

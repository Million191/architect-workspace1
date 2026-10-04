import { promises as fs } from 'fs';
import path from 'path';
import { ActionItemTrackerClient, TrackedActionItem } from '../../actionItemTracker/types';
import { ProviderCallError } from './providerErrors';

/** One row in backend/data/action-items.json. Flattened so the file is easy to read by hand. */
export interface TrackerRecord {
  task: string;
  owner: string | null;
  dueDate: string | null;
  priority: string | null;
  status: TrackedActionItem['status'];
  sourceTimestampMs: number | null;
  needsReview: boolean;
  loggedAt: string;
}

/**
 * Local action-item tracker: appends each confirmed-sent meeting's action items to a JSON file.
 * Duplicate protection is upstream: the tracker service only calls this once per approved send,
 * and the pipeline persists that fact (see `JsonFileMap`), so a replay or restart never re-appends.
 * Writes are atomic (temp file + rename); a write failure surfaces as `TrackerWriteError`.
 */
export function createJsonActionItemTracker(filePath: string): ActionItemTrackerClient & { readAll(): Promise<TrackerRecord[]> } {
  async function readAll(): Promise<TrackerRecord[]> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as TrackerRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ProviderCallError('TrackerReadError', `Could not read ${filePath}: ${(error as Error).message}`);
    }
  }

  return {
    readAll,
    async logActionItems(items) {
      const existing = await readAll();
      const added: TrackerRecord[] = items.map(({ actionItem, status, loggedAt }) => ({
        task: actionItem.task,
        owner: actionItem.owner ?? null,
        dueDate: actionItem.dueDate ?? null,
        priority: actionItem.priority ?? null,
        status,
        sourceTimestampMs: actionItem.sourceTimestampMs ?? null,
        needsReview: actionItem.flaggedForReview,
        loggedAt,
      }));
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temp = `${filePath}.${process.pid}.tmp`;
        await fs.writeFile(temp, JSON.stringify([...existing, ...added], null, 2), 'utf8');
        await fs.rename(temp, filePath);
      } catch (error) {
        throw new ProviderCallError('TrackerWriteError', `Could not write ${filePath}: ${(error as Error).message}`);
      }
    },
  };
}

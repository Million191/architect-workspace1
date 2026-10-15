import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { MeetingPipelineStores } from '../../meetingPipeline/types';
import { PersonRecord } from '../../people/types';
import { ScheduledMeeting } from '../../schedule/types';
import { MinutesDocument } from '../../minutesDoc/types';
import { RecordingMeta } from '../../recording/types';
import { BotSession } from '../../meetingBot/types';

type ValueOf<M> = M extends Map<string, infer V> ? V : never;

/**
 * Everything the app saves, as plain objects read straight from the JSON files in the data folder
 * (no constraints, no services) — what the one-time duplicate cleanup reads and rewrites.
 */
export interface DataSet {
  people: Record<string, PersonRecord>;
  schedule: Record<string, ScheduledMeeting>;
  minutesGate: Record<string, ValueOf<MeetingPipelineStores['minutesGate']>>;
  emailGate: Record<string, ValueOf<MeetingPipelineStores['emailGate']>>;
  finalApprovals: Record<string, ValueOf<MeetingPipelineStores['finalApprovals']>>;
  recipients: Record<string, Record<string, string>>;
  sentEmails: Record<string, string>;
  tracker: Record<string, ValueOf<MeetingPipelineStores['tracker']>>;
  transcripts: Record<string, unknown>;
  minutesDocs: Record<string, MinutesDocument>;
  botSessions: Record<string, BotSession>;
  /** recordings/<id>/meta.json, keyed by recording id. */
  recordings: Record<string, RecordingMeta>;
}

/** DataSet field → file name in the data folder (recordings are separate folders). */
export const FILES: Record<Exclude<keyof DataSet, 'recordings'>, string> = {
  people: 'people.json',
  schedule: 'schedule.json',
  minutesGate: 'minutes-drafts.json',
  emailGate: 'email-drafts.json',
  finalApprovals: 'final-approvals.json',
  recipients: 'recipients.json',
  sentEmails: 'sent-emails.json',
  tracker: 'tracker-log.json',
  transcripts: 'transcripts.json',
  minutesDocs: 'minutes-docs.json',
  botSessions: 'bot-sessions.json',
};

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);

export function loadDataSet(dataDir: string): DataSet {
  const d = {} as DataSet;
  for (const [key, file] of Object.entries(FILES)) (d as unknown as Record<string, unknown>)[key] = readJson(path.join(dataDir, file), {});
  d.recordings = {};
  const recDir = path.join(dataDir, 'recordings');
  if (existsSync(recDir)) {
    for (const id of readdirSync(recDir)) {
      const meta = path.join(recDir, id, 'meta.json');
      if (existsSync(meta)) d.recordings[id] = readJson<RecordingMeta>(meta, {} as RecordingMeta);
    }
  }
  return d;
}

/** Copies every file the cleanup may touch into `backupDir` (created). Returns the files copied. */
export function backupDataSet(dataDir: string, backupDir: string): string[] {
  mkdirSync(backupDir, { recursive: true });
  const copied: string[] = [];
  for (const file of Object.values(FILES)) {
    const from = path.join(dataDir, file);
    if (existsSync(from)) { copyFileSync(from, path.join(backupDir, file)); copied.push(file); }
  }
  const recDir = path.join(dataDir, 'recordings');
  if (existsSync(recDir)) {
    for (const id of readdirSync(recDir)) {
      const meta = path.join(recDir, id, 'meta.json');
      if (!existsSync(meta)) continue;
      mkdirSync(path.join(backupDir, 'recordings', id), { recursive: true });
      copyFileSync(meta, path.join(backupDir, 'recordings', id, 'meta.json'));
      copied.push(`recordings/${id}/meta.json`);
    }
  }
  return copied;
}

const writeAtomic = (file: string, value: unknown) => {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temp, file);
};

/** Writes back only the parts listed in `changed` (each file atomically). */
export function saveDataSet(dataDir: string, d: DataSet, changed: Set<keyof DataSet>): void {
  for (const key of changed) {
    if (key === 'recordings') {
      for (const [id, meta] of Object.entries(d.recordings)) {
        const file = path.join(dataDir, 'recordings', id, 'meta.json');
        if (existsSync(file)) writeAtomic(file, meta);
      }
      continue;
    }
    if (key === 'botSessions' && !existsSync(path.join(dataDir, FILES.botSessions)) && !Object.keys(d.botSessions).length) continue;
    writeAtomic(path.join(dataDir, FILES[key]), d[key]);
  }
}

/** How far along a meeting is — the merged duplicate keeps the furthest one. */
export function rankRun(d: DataSet, runId: string): number {
  if (Object.keys(d.sentEmails).some((k) => k.startsWith(`${runId}:`))) return 4;
  if (d.finalApprovals[runId]) return 3;
  if (d.emailGate[runId]) return 2;
  if (d.minutesGate[runId]?.status === 'approved') return 1;
  return 0;
}

export function runTitle(d: DataSet, runId: string): string {
  return d.finalApprovals[runId]?.minutes?.meetingSummary.title ?? d.minutesGate[runId]?.draft.meetingSummary.title ?? 'Untitled meeting';
}

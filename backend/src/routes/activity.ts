import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { MinutesDocService } from '../services/minutesDoc/minutesDocService';
import { RecordingService } from '../services/recording/recordingService';

/** One line of "Recent activity", already phrased for people. Newest first. */
export interface ActivityItem {
  at: string;
  kind: 'draft_ready' | 'minutes_approved' | 'final_approved' | 'emails_sent' | 'minutes_edited' | 'minutes_restored' | 'approved_minutes_edited' | 'transcript_corrected' | 'recording_failed';
  text: string;
  runId?: string;
  recordingId?: string;
  by?: string;
}

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });

export interface ActivityDeps {
  pipeline?: MeetingPipeline;
  minutes?: MinutesDocService;
  recordings?: RecordingService;
}

/** Everything that happened, from the records the app already keeps. Read-only; nothing is invented. */
export function buildActivity(deps: ActivityDeps): ActivityItem[] {
  const titles = new Map<string, string>();
  for (const m of deps.pipeline?.listMeetings() ?? []) titles.set(m.runId, m.title || 'Untitled meeting');
  const title = (runId: string, fallback?: string) => titles.get(runId) ?? fallback ?? 'a meeting';
  const items: ActivityItem[] = [];
  for (const a of deps.pipeline?.activity() ?? []) {
    const t = title(a.runId, a.title);
    const text = a.kind === 'draft_ready' ? `Draft minutes ready for ${t}`
      : a.kind === 'minutes_approved' ? `Minutes approved for ${t}`
      : a.kind === 'final_approved' ? `Emails approved for ${t} (not sent — draft-only mode)`
      : `Minutes emailed for ${t}${a.count ? ` to ${a.count} participant${a.count === 1 ? '' : 's'}` : ''}`;
    items.push({ at: a.at, kind: a.kind, text, runId: a.runId, by: a.by });
  }
  // Autosaved edits fold into one version per person per few minutes, so this stays readable.
  for (const v of deps.minutes?.activity() ?? []) {
    const t = title(v.runId);
    const kind: ActivityItem['kind'] = v.kind === 'restore' ? 'minutes_restored' : v.kind === 'amendment' ? 'approved_minutes_edited' : v.kind === 'transcript_correction' ? 'transcript_corrected' : 'minutes_edited';
    const text = kind === 'minutes_restored' ? `An earlier version of the minutes was restored for ${t}`
      : kind === 'approved_minutes_edited' ? `Approved minutes edited for ${t}${v.reason ? ` — ${v.reason}` : ''}`
      : kind === 'transcript_corrected' ? `Transcript corrected for ${t}${v.reason ? ` — ${v.reason}` : ''}`
      : `Minutes edited for ${t}`;
    items.push({ at: v.at, kind, text, runId: v.runId, by: v.by });
  }
  for (const r of deps.recordings?.listFailed() ?? []) {
    items.push({ at: r.updatedAt, kind: 'recording_failed', text: `Processing failed for ${r.title || 'a recording'}`, recordingId: r.id });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function createActivityRouter(deps: ActivityDeps): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    const q = querySchema.safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'ValidationError', message: 'limit must be 1–100.' }); return; }
    try {
      const all = buildActivity(deps);
      res.json({ items: all.slice(0, q.data.limit), total: all.length });
    } catch (error) {
      console.error(JSON.stringify({ event: 'activity_failed', error_class: error instanceof Error ? error.name : 'UnknownError', outcome: 'failure' }));
      res.status(500).json({ error: 'ActivityFailed', message: 'Couldn’t load recent activity.' });
    }
  });
  return router;
}

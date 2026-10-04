import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { attendeesSchema } from './meetingPipeline';
import { RecordingError, RecordingService, MAX_CHUNK_BYTES, DraftFromRecording } from '../services/recording/recordingService';
import { RawAudioRetention } from '../services/recording/types';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../services/schedule/scheduleService';
import { UploadProgressTracker } from '../services/meetingPipeline/uploadProgress';
import { PipelineStageFailedError, ProviderNotConfiguredError } from '../services/meetingPipeline/errors';
import { errorClassOf } from '../services/meetingPipeline/runStage';

const id = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Recording ids are 8-64 letters, digits, or dashes.');
const createSchema = z.object({
  id,
  mode: z.enum(['in_person', 'browser_capture']),
  title: z.string().trim().max(300).optional().transform((v) => v || undefined),
  attendees: z.string().max(10000).default('').transform((v, ctx) => {
    if (!v.trim()) return [];
    const parsed = attendeesSchema.safeParse(v);
    if (!parsed.success) { parsed.error.issues.forEach((i) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: i.message })); return z.NEVER; }
    return parsed.data;
  }),
  scheduledMeetingId: z.string().uuid().optional(),
  mimeType: z.string().max(100),
  consent: z.literal(true, { errorMap: () => ({ message: 'Confirm that everyone in the meeting knows it is being recorded.' }) }),
  confirmedBy: z.string().trim().max(200).optional(),
}).strict();
const finishSchema = z.object({
  chunkCount: z.number().int().min(1).max(20000),
  durationMs: z.number().int().min(0).max(48 * 3600 * 1000).optional(),
  markers: z.array(z.object({ atMs: z.number().int().min(0), note: z.string().trim().min(1).max(500) })).max(500).optional(),
}).strict();
const retentionSchema = z.object({ rawAudioRetention: z.enum(['after_approval', '30_days', 'keep']) }).strict();

const STATUS: Record<string, number> = { RecordingNotFoundError: 404, RecordingStateError: 409, MissingChunksError: 409, RecordingValidationError: 400 };

export interface RecordingsRouterDeps {
  recordings?: RecordingService;
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
  progress: UploadProgressTracker;
  /** Where the retention setting lives (a JsonFileMap in real mode). */
  settings: Map<string, string>;
}

export const DEFAULT_RETENTION: RawAudioRetention = '30_days';

/** Runs the raw-audio retention policy now (at startup, hourly, and whenever the setting changes). */
export function applyRetention(deps: Pick<RecordingsRouterDeps, 'recordings' | 'pipeline' | 'settings'>): string[] {
  if (!deps.recordings) return [];
  const policy = (deps.settings.get('rawAudioRetention') as RawAudioRetention) ?? DEFAULT_RETENTION;
  const approved = (runId: string) => {
    try { const stage = deps.pipeline?.getRun(runId).stage; return stage === 'sent' || stage === 'approved_not_sent'; } catch { return false; }
  };
  return deps.recordings.applyRetention(policy, approved);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof RecordingError) {
    res.status(STATUS[error.errorClass] ?? 400).json({ error: error.errorClass, message: error.message, missing: error.missing });
    return;
  }
  if (error instanceof ProviderNotConfiguredError) { res.status(503).json({ error: errorClassOf(error), problems: error.problems, message: error.message }); return; }
  if (error instanceof PipelineStageFailedError) { res.status(error.causeErrorClass === 'UpstreamTimeoutError' ? 504 : 502).json({ error: errorClassOf(error), stage: error.stage, message: error.message }); return; }
  const errorClass = errorClassOf(error);
  if (errorClass === 'UnsupportedFormatError' || errorClass === 'CorruptedAudioError') { res.status(422).json({ error: errorClass, message: (error as Error).message }); return; }
  res.status(500).json({ error: errorClass, message: 'The recording couldn’t be processed.' });
}

/**
 * Live recordings: create → PUT chunks (every few seconds, retried freely) → finish (join + the
 * normal pipeline). The page keeps unsent chunks on the device, so a dropped connection or a closed
 * tab only delays the upload.
 */
export function createRecordingsRouter(deps: RecordingsRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.recordings ? next() : res.status(503).json({ error: 'RecordingUnavailable', message: 'Recording isn’t set up on this server.' })));
  const svc = () => deps.recordings as RecordingService;
  const retention = (): RawAudioRetention => (deps.settings.get('rawAudioRetention') as RawAudioRetention) ?? DEFAULT_RETENTION;

  router.get('/settings/retention', (_req, res) => { res.json({ rawAudioRetention: retention() }); });
  router.put('/settings/retention', (req, res) => {
    const b = retentionSchema.safeParse(req.body ?? {});
    if (!b.success) { res.status(400).json({ error: 'ValidationError', message: 'Choose after_approval, 30_days, or keep.' }); return; }
    deps.settings.set('rawAudioRetention', b.data.rawAudioRetention);
    const cleaned = applyRetention(deps);
    res.json({ rawAudioRetention: retention(), audioDeleted: cleaned.length });
  });

  router.post('/', (req: Request, res: Response) => {
    const b = createSchema.safeParse(req.body ?? {});
    if (!b.success) { res.status(400).json({ error: 'ValidationError', message: b.error.issues.map((i) => i.message).join(' ') }); return; }
    try { res.status(201).json(svc().create(b.data)); } catch (e) { fail(res, e); }
  });

  router.get('/by-run/:runId', (req, res) => {
    const m = svc().findByRun(String(req.params.runId));
    if (!m) { res.status(404).json({ error: 'RecordingNotFoundError', message: 'No live recording for that meeting.' }); return; }
    res.json(m);
  });

  router.get('/:id', (req, res) => {
    const p = id.safeParse(req.params.id);
    if (!p.success) { res.status(400).json({ error: 'ValidationError', message: p.error.issues[0].message }); return; }
    try { res.json(svc().get(p.data)); } catch (e) { fail(res, e); }
  });

  router.put('/:id/chunks/:index', express.raw({ type: () => true, limit: MAX_CHUNK_BYTES }), (req: Request, res: Response) => {
    const p = id.safeParse(req.params.id);
    const index = Number(req.params.index);
    if (!p.success || !Number.isInteger(index)) { res.status(400).json({ error: 'ValidationError', message: 'Bad recording id or chunk number.' }); return; }
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'ValidationError', message: 'Send the chunk as the raw request body.' }); return; }
    try {
      const meta = svc().putChunk(p.data, index, req.body);
      res.json({ received: index, chunks: meta.chunks.length, bytes: meta.bytes });
    } catch (e) { fail(res, e); }
  });

  router.post('/:id/finish', async (req: Request, res: Response) => {
    const p = id.safeParse(req.params.id);
    const b = finishSchema.safeParse(req.body ?? {});
    if (!p.success || !b.success) { res.status(400).json({ error: 'ValidationError', message: b.success ? 'Bad recording id.' : b.error.issues.map((i) => i.message).join(' ') }); return; }
    if (!deps.pipeline) { res.status(503).json({ error: 'ProvidersNotConfigured', message: 'The meeting workflow is not wired into this server instance.' }); return; }
    const pipeline = deps.pipeline;
    const draft: DraftFromRecording = async (meta, audio, filename) => {
      if (meta.scheduledMeetingId && deps.schedule) deps.schedule.assertCanLinkRecording(meta.scheduledMeetingId);
      const run = await pipeline.draftMinutes({
        originalFilename: filename,
        buffer: audio,
        source: 'room_mic',
        location: meta.mode === 'in_person' ? 'In person' : 'Online meeting (captured on this computer)',
        attendeeNames: meta.attendees.map((a) => a.name),
        attendeeEmails: Object.fromEntries(meta.attendees.filter((a) => a.email).map((a) => [a.name, a.email as string])),
        meetingContext: { title: meta.title },
        onProgress: (stage) => deps.progress.stage(meta.id, stage),
      });
      if (meta.scheduledMeetingId && deps.schedule) {
        try { deps.schedule.linkRecording(meta.scheduledMeetingId, run.runId); } catch { /* the meeting exists either way; the link is best effort */ }
      }
      return run;
    };
    deps.progress.start(p.data);
    try {
      const meta = await svc().finish(p.data, b.data, draft);
      deps.progress.finish(p.data, 'done');
      res.status(200).json({ recording: meta, run: pipeline.getRun(meta.runId as string) });
    } catch (e) {
      deps.progress.finish(p.data, 'failed');
      fail(res, e);
    }
  });

  router.delete('/:id', (req, res) => {
    const p = id.safeParse(req.params.id);
    if (!p.success) { res.status(400).json({ error: 'ValidationError', message: p.error.issues[0].message }); return; }
    try { svc().discard(p.data); res.json({ discarded: true }); } catch (e) { fail(res, e); }
  });

  return router;
}

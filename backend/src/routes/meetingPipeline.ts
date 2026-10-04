import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { PipelineStageFailedError, ProviderNotConfiguredError, RecipientProblemError } from '../services/meetingPipeline/errors';
import { errorClassOf } from '../services/meetingPipeline/runStage';
import { UploadProgressTracker } from '../services/meetingPipeline/uploadProgress';
import { ScheduleService } from '../services/schedule/scheduleService';
import { ScheduleError } from '../services/schedule/errors';

const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

/**
 * One attendee entry: "Name <email@example.com>", a bare "email@example.com", or just "Name"
 * (allowed, but that person cannot be emailed). Names may not contain line breaks or angle
 * brackets, which keeps them safe to use in an email header.
 */
export function parseAttendee(entry: string): { name: string; email?: string } | string {
  const withAddress = /^(.*?)\s*<([^<>]+)>$/.exec(entry);
  if (withAddress) {
    const name = withAddress[1].trim().replace(/^"|"$/g, '');
    const email = withAddress[2].trim();
    if (!EMAIL.test(email)) return `"${entry}" does not contain a valid email address.`;
    return { name: name || email, email };
  }
  if (/[<>]/.test(entry)) return `"${entry}" should look like Name <email@example.com>.`;
  return EMAIL.test(entry) ? { name: entry, email: entry } : { name: entry };
}

/** Shared with live recordings so both accept attendees in exactly the same format. */
export const attendeesSchema = z
  .string()
  .transform((raw, ctx) => {
    const entries = raw.split(/[,;\n]/).map((e) => e.trim()).filter((e) => e.length > 0);
    const parsed = entries.map(parseAttendee);
    parsed.filter((p): p is string => typeof p === 'string').forEach((message) => ctx.addIssue({ code: z.ZodIssueCode.custom, message }));
    return parsed.filter((p): p is { name: string; email?: string } => typeof p !== 'string');
  })
  .pipe(
    z
      .array(z.object({ name: z.string().max(200).regex(/^[^\r\n<>]+$/,'Attendee names cannot contain line breaks or < >.'), email: z.string().max(320).optional() }))
      .min(1, 'List at least one attendee.')
      .max(100)
  );

const draftFieldsSchema = z.object({
  // Needed for speaker naming, for who gets an email, and (with an address) where it goes.
  attendees: attendeesSchema,
  title: z.string().trim().max(300).optional().transform((v) => (v ? v : undefined)),
  source: z.enum(['room_mic', 'phone']).default('room_mic'),
  location: z.string().trim().max(300).optional().transform((v) => (v ? v : undefined)),
  // Random id from the page, used only to report live progress for this upload.
  uploadId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'uploadId must be 8-64 letters, digits, or dashes.').optional(),
  // A calendar meeting this recording belongs to; the recording is attached to it once drafted.
  scheduledMeetingId: z.string().uuid().optional(),
});

const uploadIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => z.string().max(max).optional();
const editsSchema = z.object({
  editedBy: optionalText(200),
  discussionTopics: z.array(z.object({ topic: text(300), summary: text(5000) })).max(200),
  decisions: z.array(z.object({ decision: text(2000), rationale: optionalText(2000), approver: optionalText(200) })).max(200),
  actionItems: z
    .array(
      z.object({
        task: text(2000),
        owner: optionalText(200),
        dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Due dates must look like 2026-10-31.').optional(),
        done: z.boolean(),
      })
    )
    .max(500),
});

const approvalSchema = z.object({ approvedBy: z.string().trim().min(1, 'approvedBy is required.').max(200) });

const STATUS_BY_ERROR_CLASS: Record<string, number> = {
  RunNotFoundError: 404,
  StageOrderError: 409,
  UnsupportedFormatError: 422,
  CorruptedAudioError: 422,
};

/** Maps a pipeline failure to a status + a message safe to show (never a provider's raw response). */
function sendError(res: Response, error: unknown): void {
  const errorClass = errorClassOf(error);
  if (error instanceof RecipientProblemError) {
    res.status(422).json({ error: errorClass, problems: error.problems, message: error.message });
    return;
  }
  if (error instanceof ProviderNotConfiguredError) {
    res.status(503).json({ error: errorClass, problems: error.problems, message: error.message });
    return;
  }
  if (error instanceof PipelineStageFailedError) {
    const status = error.causeErrorClass === 'UpstreamTimeoutError' ? 504 : 502;
    res.status(status).json({ error: errorClass, stage: error.stage, message: error.message });
    return;
  }
  const status = STATUS_BY_ERROR_CLASS[errorClass];
  if (status) {
    res.status(status).json({ error: errorClass, message: error instanceof Error ? error.message : String(error) });
    return;
  }
  res.status(500).json({ error: errorClass, message: 'The meeting pipeline failed unexpectedly.' });
}

export interface MeetingPipelineRouterDeps {
  /** Undefined when no providers are configured — every route then answers 503 instead of pretending. */
  pipeline?: MeetingPipeline;
  maxUploadBytes?: number;
  /** Calendar meetings, so an upload can be attached to a scheduled meeting. */
  schedule?: ScheduleService;
  /** Shared with live recordings so one progress endpoint serves both. */
  progress?: UploadProgressTracker;
}

export function createMeetingPipelineRouter(deps: MeetingPipelineRouterDeps): Router {
  const router = Router();
  const maxUploadBytes = deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes } });
  const progress = deps.progress ?? new UploadProgressTracker();

  router.use((_req, res, next) => {
    if (!deps.pipeline) {
      res.status(503).json({
        error: 'ProvidersNotConfigured',
        message: 'The meeting workflow is not wired into this server instance.',
      });
      return;
    }
    next();
  });

  router.post('/draft', (req: Request, res: Response) => {
    upload.single('audio')(req, res, async (uploadError: unknown) => {
      if (uploadError) {
        const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({
          error: tooLarge ? 'PayloadTooLarge' : 'ValidationError',
          message: tooLarge ? `Uploaded file exceeds the ${maxUploadBytes}-byte limit.` : 'Could not parse the uploaded file.',
        });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'ValidationError', message: 'An "audio" file is required.' });
        return;
      }
      const fields = draftFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) {
        res.status(400).json({ error: 'ValidationError', message: fields.error.issues.map((i) => i.message).join(' ') });
        return;
      }
      const uploadId = fields.data.uploadId;
      const scheduledId = fields.data.scheduledMeetingId;
      if (scheduledId) {
        if (!deps.schedule) { res.status(503).json({ error: 'ScheduleUnavailable', message: 'The calendar isn’t set up on this server.' }); return; }
        try { deps.schedule.assertCanLinkRecording(scheduledId); } catch (error) {
          const e = error as ScheduleError;
          res.status(e.errorClass === 'MeetingNotFoundError' ? 404 : 409).json({ error: e.errorClass, message: e.message });
          return;
        }
      }
      if (uploadId) progress.start(uploadId);
      try {
        const run = await deps.pipeline!.draftMinutes({
          originalFilename: req.file.originalname,
          buffer: req.file.buffer,
          source: fields.data.source,
          location: fields.data.location,
          attendeeNames: fields.data.attendees.map((a) => a.name),
          attendeeEmails: Object.fromEntries(fields.data.attendees.filter((a) => a.email).map((a) => [a.name, a.email as string])),
          meetingContext: { title: fields.data.title },
          onProgress: uploadId ? (stage) => progress.stage(uploadId, stage) : undefined,
        });
        if (uploadId) progress.finish(uploadId, 'done');
        if (scheduledId && deps.schedule) {
          try { deps.schedule.linkRecording(scheduledId, run.runId); } catch (error) {
            // The draft exists either way; say why it isn't attached rather than failing the upload.
            res.status(201).json({ ...run, scheduleLinkError: (error as Error).message });
            return;
          }
        }
        res.status(201).json({ ...run, scheduledMeetingId: scheduledId });
      } catch (error) {
        if (uploadId) progress.finish(uploadId, 'failed');
        sendError(res, error);
      }
    });
  });

  // Which providers are wired and what is missing — the page shows this before any upload.
  router.get('/status', (_req: Request, res: Response) => {
    res.status(200).json(deps.pipeline!.getStatus());
  });

  // Live progress of one upload (see UploadProgressTracker).
  router.get('/progress/:uploadId', (req: Request, res: Response) => {
    const id = uploadIdSchema.safeParse(req.params.uploadId);
    const entry = id.success ? progress.get(id.data) : undefined;
    if (!entry) {
      res.status(404).json({ error: 'ProgressNotFound', message: 'No upload in progress with that id.' });
      return;
    }
    res.status(200).json(entry);
  });

  // Read-only list of meetings for the dashboard.
  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ meetings: deps.pipeline!.listMeetings() });
  });

  // Read-only list of tracked action items across meetings.
  router.get('/action-items/all', (_req: Request, res: Response) => {
    res.status(200).json({ actionItems: deps.pipeline!.listActionItems() });
  });

  // Reviewer edits to the draft minutes (autosave). Only before approval #1.
  router.post('/:runId/minutes', (req: Request, res: Response) => {
    const body = editsSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    try {
      const { editedBy, ...edits } = body.data;
      res.status(200).json(deps.pipeline!.reviseMinutes(req.params.runId, edits, editedBy));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:runId', (req: Request, res: Response) => {
    try {
      res.status(200).json(deps.pipeline!.getRun(req.params.runId));
    } catch (error) {
      sendError(res, error);
    }
  });

  const approvalRoute = (action: 'approveMinutes' | 'approveEmailsAndSend') => async (req: Request, res: Response) => {
    const body = approvalSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    try {
      res.status(200).json(await deps.pipeline![action](req.params.runId, body.data.approvedBy));
    } catch (error) {
      sendError(res, error);
    }
  };

  router.post('/:runId/approve-minutes', approvalRoute('approveMinutes'));
  router.post('/:runId/approve-emails', approvalRoute('approveEmailsAndSend'));

  return router;
}

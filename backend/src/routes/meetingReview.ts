import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { sendError } from './meetingPipeline';

/** Names and short free text from the page: no line breaks or angle brackets (they end up in emails). */
const name = z.string().trim().min(1, 'Names can’t be empty.').max(200).regex(/^[^\r\n<>]+$/, 'Names can’t contain line breaks or < >.');
const by = z.string().trim().max(200).regex(/^[^\r\n<>]*$/).optional();
const changesSchema = z.object({ note: z.string().trim().min(1, 'Say what needs to change.').max(2000), requestedBy: by }).strict();
const emailsSchema = z.object({
  emails: z.array(z.object({
    participantName: name,
    subject: z.string().trim().min(1, 'The subject can’t be empty.').max(300).regex(/^[^\r\n]+$/, 'The subject must be one line.'),
    body: z.string().trim().min(1, 'The email can’t be empty.').max(20000),
  }).strict()).min(1).max(100),
  editedBy: by,
}).strict();
const participantsSchema = z.object({
  participants: z.array(z.object({
    from: name.optional(),
    name,
    email: z.string().trim().max(320).regex(/^([^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+)?$/, 'That isn’t a valid email address.').optional(),
  }).strict()).min(1, 'Keep at least one participant.').max(100),
  editedBy: by,
}).strict().refine((b) => new Set(b.participants.map((p) => p.name.toLowerCase())).size === b.participants.length, { message: 'Two participants have the same name.' });

const recipientEmail = z.string().trim().min(3).max(320).regex(/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/, 'That isn’t a valid email address.');
/** One person ({ name, email }) or several ({ people: [...] }); every row is checked before anyone is added. */
const recipientSchema = z.union([
  z.object({ name, email: recipientEmail, editedBy: by }).strict(),
  z.object({ people: z.array(z.object({ name: name.optional(), email: recipientEmail }).strict()).min(1, 'Add at least one email address.').max(50), editedBy: by }).strict()
    .refine((b) => new Set(b.people.map((p) => p.email.toLowerCase())).size === b.people.length, { message: 'The same email address is listed twice.' }),
]);

export interface MeetingReviewRouterDeps {
  pipeline?: MeetingPipeline;
  /** Cleans up what lives outside the pipeline (minutes document, calendar link, recording, search). */
  onDeleted?: (runId: string) => void;
}

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | undefined {
  const r = schema.safeParse(body ?? {});
  if (!r.success) { res.status(400).json({ error: 'ValidationError', message: r.error.issues.map((i) => i.message).join(' ') }); return undefined; }
  return r.data;
}

/**
 * Human-in-the-loop actions on one meeting (mounted under /api/meetings):
 * POST /:runId/request-changes, PUT /:runId/emails, PUT /:runId/participants, DELETE /:runId.
 */
export function createMeetingReviewRouter(deps: MeetingReviewRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.pipeline ? next() : res.status(503).json({ error: 'ProvidersNotConfigured', message: 'The meeting workflow is not wired into this server instance.' })));
  const pipeline = () => deps.pipeline as MeetingPipeline;

  router.post('/:runId/request-changes', (req: Request, res: Response) => {
    const b = parse(changesSchema, req.body, res);
    if (!b) return;
    try { res.json(pipeline().requestChanges(req.params.runId, b.note, b.requestedBy)); } catch (e) { sendError(res, e); }
  });

  router.put('/:runId/emails', (req: Request, res: Response) => {
    const b = parse(emailsSchema, req.body, res);
    if (!b) return;
    try { res.json(pipeline().reviseEmails(req.params.runId, b.emails, b.editedBy)); } catch (e) { sendError(res, e); }
  });

  router.put('/:runId/participants', (req: Request, res: Response) => {
    const b = parse(participantsSchema, req.body, res);
    if (!b) return;
    try { res.json(pipeline().updateParticipants(req.params.runId, b.participants, b.editedBy)); } catch (e) { sendError(res, e); }
  });

  /** Email step: add a recipient, or give a participant an email address. */
  router.post('/:runId/recipients', (req: Request, res: Response) => {
    const b = parse(recipientSchema, req.body, res);
    if (!b) return;
    try {
      res.json('people' in b ? pipeline().addRecipients(req.params.runId, b.people, b.editedBy) : pipeline().addRecipient(req.params.runId, { name: b.name, email: b.email }, b.editedBy));
    } catch (e) { sendError(res, e); }
  });

  /** Idempotent: deleting a meeting that's already gone answers 204 too. */
  router.delete('/:runId', (req: Request, res: Response) => {
    try {
      const runId = req.params.runId;
      const existed = pipeline().deleteMeeting(runId);
      try { deps.onDeleted?.(runId); } catch (error) {
        console.error(JSON.stringify({ event: 'meeting_delete_cleanup_failed', run_id: runId, error_class: (error as Error).name, outcome: 'partial' }));
      }
      console.log(JSON.stringify({ event: 'meeting_deleted', run_id: runId, existed, outcome: 'success' }));
      res.status(204).end();
    } catch (e) { sendError(res, e); }
  });

  return router;
}

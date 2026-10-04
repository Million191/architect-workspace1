import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MinutesDocService, MinutesError } from '../services/minutesDoc/minutesDocService';
import { MinutesContent } from '../services/minutesDoc/types';
import { errorClassOf } from '../services/meetingPipeline/runStage';
import { AssistError, MinutesAssistant } from '../services/minutesDoc/assistant';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';

const by = z.string().trim().min(1, 'Add your name in Settings first — it’s recorded on every edit.').max(200);
const saveSchema = z.object({ content: z.object({ sections: z.array(z.unknown()).max(100), actionItems: z.array(z.unknown()).max(300) }), baseRevision: z.number().int().min(1), editedBy: by }).strict();
const restoreSchema = z.object({ baseRevision: z.number().int().min(1), editedBy: by }).strict();
const amendSchema = z.object({ reason: z.string().trim().min(3, 'Say briefly why the approved minutes are being changed.').max(500), editedBy: by }).strict();
const sendSchema = z.object({ sentBy: by }).strict();
const assistSchema = z.object({ mode: z.enum(['regenerate', 'shorter', 'formal']), title: z.string().max(200).default(''), html: z.string().max(60000).default(''), startMs: z.number().int().min(0).optional(), endMs: z.number().int().min(0).optional() }).strict();
const transcriptSchema = z.object({
  lines: z.array(z.object({ index: z.number().int().min(0), text: z.string().max(2000).optional(), speakerLabel: z.string().max(200).optional() }).strict()).max(2000).optional(),
  rename: z.object({ from: z.string().min(1).max(200), to: z.string().trim().min(1, 'Type the participant’s name.').max(200) }).strict().optional(),
  editedBy: by,
}).strict();
const presenceSchema = z.object({ viewerId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), name: z.string().trim().max(200).default('') }).strict();
const PRESENCE_TTL_MS = 45000;

const STATUS: Record<string, number> = { AssistUnavailable: 503, AssistFailed: 502, ModelRefused: 422, MinutesConflict: 409, MinutesLocked: 409, MinutesValidationError: 400, VersionNotFound: 404, RunNotFoundError: 404, StageOrderError: 409 };

function fail(res: Response, error: unknown): void {
  if (error instanceof MinutesError) { res.status(STATUS[error.errorClass]).json({ error: error.errorClass, message: error.message, ...error.details }); return; }
  if (error instanceof AssistError) { res.status(STATUS[error.errorClass]).json({ error: error.errorClass, message: error.message }); return; }
  const errorClass = errorClassOf(error);
  if (STATUS[errorClass]) { res.status(STATUS[errorClass]).json({ error: errorClass, message: (error as Error).message }); return; }
  console.error(JSON.stringify({ event: 'minutes_route_failed', error_class: errorClass, outcome: 'failure' }));
  res.status(500).json({ error: errorClass, message: 'Couldn’t save the minutes. Try again.' });
}
function parse<S extends z.ZodTypeAny>(schema: S, req: Request, res: Response): z.infer<S> | undefined {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) { res.status(400).json({ error: 'ValidationError', message: r.error.issues.map((i) => i.message).join(' ') }); return undefined; }
  return r.data;
}

/** Editable minutes: sections + action items, autosaved with a revision check, full version history. */
export function createMinutesRouter(deps: { minutes?: MinutesDocService; assistant?: MinutesAssistant; pipeline?: MeetingPipeline; now?: () => number }): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  /** Who has each draft open: runId → viewerId → { name, seen }. In memory; entries expire after 45 s. */
  const presence = new Map<string, Map<string, { name: string; seen: number }>>();
  router.use((_req, res, next) => (deps.minutes ? next() : res.status(503).json({ error: 'MinutesUnavailable', message: 'The minutes editor isn’t set up on this server.' })));
  const svc = () => deps.minutes as MinutesDocService;

  router.get('/:runId', (req, res) => { try { res.json(svc().get(req.params.runId)); } catch (e) { fail(res, e); } });

  router.put('/:runId', (req, res) => {
    const b = parse(saveSchema, req, res);
    if (!b) return;
    try { res.json(svc().save(req.params.runId, b.content as unknown as MinutesContent, b.baseRevision, b.editedBy)); } catch (e) { fail(res, e); }
  });

  router.get('/:runId/versions', (req, res) => { try { res.json({ versions: svc().versions(req.params.runId) }); } catch (e) { fail(res, e); } });
  router.get('/:runId/versions/:n', (req, res) => { try { res.json(svc().version(req.params.runId, Number(req.params.n))); } catch (e) { fail(res, e); } });
  router.post('/:runId/versions/:n/restore', (req, res) => {
    const b = parse(restoreSchema, req, res);
    if (!b) return;
    try { res.json(svc().restore(req.params.runId, Number(req.params.n), b.baseRevision, b.editedBy)); } catch (e) { fail(res, e); }
  });

  router.post('/:runId/amendments', (req, res) => {
    const b = parse(amendSchema, req, res);
    if (!b) return;
    try { res.json(svc().startAmendment(req.params.runId, b.reason, b.editedBy)); } catch (e) { fail(res, e); }
  });
  router.post('/:runId/amendments/finish', (req, res) => { try { res.json(svc().finishAmendment(req.params.runId)); } catch (e) { fail(res, e); } });
  router.post('/:runId/updates/send', async (req, res) => {
    const b = parse(sendSchema, req, res);
    if (!b) return;
    try { res.json(await svc().sendUpdate(req.params.runId, b.sentBy)); } catch (e) { fail(res, e); }
  });

  // "AI help": a suggestion for one section. Never saved — the page shows it with Replace / Keep mine.
  router.post('/:runId/assist', async (req, res) => {
    const b = parse(assistSchema, req, res);
    if (!b) return;
    if (!deps.assistant) { res.status(503).json({ error: 'AssistUnavailable', message: 'AI help needs ANTHROPIC_API_KEY on the server.' }); return; }
    try {
      const run = deps.pipeline?.getRun(req.params.runId);
      const lines = (run?.transcript ?? []).filter((s) => (b.startMs === undefined || s.startMs >= b.startMs) && (b.endMs === undefined || s.startMs < b.endMs))
        .map((s) => `${Math.floor(s.startMs / 60000)}:${String(Math.floor(s.startMs / 1000) % 60).padStart(2, '0')} ${s.speakerLabel}: ${s.text}`);
      const started = Date.now();
      const html = await deps.assistant.suggest({ mode: b.mode, title: b.title, html: b.html, transcript: lines.slice(0, 400) });
      console.log(JSON.stringify({ event: 'minutes_assist', mode: b.mode, provider: deps.assistant.kind, duration_ms: Date.now() - started, outcome: 'success' }));
      res.json({ html, provider: deps.assistant.kind });
    } catch (e) {
      if (!(e instanceof AssistError)) console.error(JSON.stringify({ event: 'minutes_assist', mode: b.mode, error_class: errorClassOf(e), outcome: 'failure' }));
      fail(res, e instanceof AssistError ? e : new AssistError('AssistFailed', 'AI help isn’t available right now. Try again in a moment.'));
    }
  });

  // Transcript corrections: words and speaker names. The original is kept in version history.
  router.put('/:runId/transcript', (req, res) => {
    const b = parse(transcriptSchema, req, res);
    if (!b) return;
    try { res.json(svc().correctTranscript(req.params.runId, { lines: b.lines, rename: b.rename }, b.editedBy)); } catch (e) { fail(res, e); }
  });

  // Who else has this draft open (pinged every 15 s by the page). Returns the others, not the caller.
  router.post('/:runId/presence', (req, res) => {
    const b = parse(presenceSchema, req, res);
    if (!b) return;
    const t = now(), viewers = presence.get(req.params.runId) ?? new Map<string, { name: string; seen: number }>();
    viewers.set(b.viewerId, { name: b.name || 'Someone', seen: t });
    for (const [id, v] of viewers) if (t - v.seen > PRESENCE_TTL_MS) viewers.delete(id);
    presence.set(req.params.runId, viewers);
    if (presence.size > 1000) { const oldest = presence.keys().next().value as string; presence.delete(oldest); }
    res.json({ viewers: [...viewers].filter(([id]) => id !== b.viewerId).map(([, v]) => ({ name: v.name })) });
  });

  return router;
}

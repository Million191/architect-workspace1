import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ScheduleService } from '../services/schedule/scheduleService';
import { ScheduleError } from '../services/schedule/errors';
import { buildNotices, NoticeKind, sendNotices } from '../services/schedule/notifications';
import { ScheduledMeeting } from '../services/schedule/types';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { EmailDeliveryClient, EmailMode } from '../services/meetingPipeline/types';
import { platformOf } from '../services/calendarSync/meetingLinks';

const iso = z.string().max(64).refine((v) => !Number.isNaN(Date.parse(v)), 'Use a valid date and time.');
const name = z.string().max(200).regex(/^[^<>\r\n]*$/, 'Names can’t contain < > or line breaks.');
const participant = z.object({ name: name.optional(), email: z.string().max(320) });
const by = z.string().max(200).optional();
const meetingBody = z.object({
  title: z.string().max(200),
  start: iso,
  end: iso,
  participants: z.array(participant).max(100).default([]),
  link: z.string().max(2000).regex(/^(https?:\/\/\S+)?$/, 'Meeting links must start with http:// or https://').optional(),
  agenda: z.string().max(5000).optional(),
  by,
  expectedVersion: z.number().int().positive().optional(),
});
const postponeBody = z.object({ start: iso.optional(), end: iso.optional(), dateTbd: z.boolean().default(false), reason: z.string().max(1000).optional(), by, expectedVersion: z.number().int().positive().optional() });
const cancelBody = z.object({ reason: z.string().max(1000).optional(), by, expectedVersion: z.number().int().positive().optional() });
const noticeKind = z.enum(['postponed', 'cancelled']);
const timeZone = z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone.');

const STATUS: Record<string, number> = { MeetingNotFoundError: 404, InvalidTransitionError: 409, StaleVersionError: 409, ScheduleValidationError: 400 };

export type DisplayStatus = 'upcoming' | 'postponed' | 'cancelled' | 'needs_review' | 'emails_drafted' | 'approved' | 'sent';

export interface ScheduleRouterDeps {
  schedule?: ScheduleService;
  pipeline?: MeetingPipeline;
  emailMode: EmailMode;
  deliver?: EmailDeliveryClient;
  noticeLog: Map<string, string>;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof ScheduleError) {
    res.status(STATUS[error.errorClass] ?? 400).json({ error: error.errorClass, message: error.message });
    return;
  }
  res.status(500).json({ error: 'UnknownError', message: 'Something went wrong. Try again.' });
}
function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: Response): z.infer<S> | undefined {
  const r = schema.safeParse(body ?? {});
  if (!r.success) { res.status(400).json({ error: 'ValidationError', message: r.error.issues.map((i) => i.message).join(' ') }); return undefined; }
  return r.data;
}

export function createScheduleRouter(deps: ScheduleRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.schedule ? next() : res.status(503).json({ error: 'ScheduleUnavailable', message: 'The calendar isn’t set up on this server.' })));
  const svc = () => deps.schedule as ScheduleService;

  /** Status as shown in the app: the schedule's own, or — once a recording is attached — the minutes workflow's. */
  function view(m: ScheduledMeeting) {
    let display: DisplayStatus = m.status === 'scheduled' ? 'upcoming' : m.status;
    if (m.runId && deps.pipeline) {
      try {
        const stage = deps.pipeline.getRun(m.runId).stage;
        display = stage === 'sent' ? 'sent' : stage === 'approved_not_sent' ? 'approved' : stage === 'emails_pending_approval' ? 'emails_drafted' : 'needs_review';
      } catch { /* recording draft no longer in memory: show the schedule status */ }
    }
    const { previous: _p, ...rest } = m;
    return { ...rest, display, platform: platformOf(m.link), canUndo: !!m.previous && !m.runId && !m.external };
  }

  router.get('/', (req: Request, res: Response) => {
    const q = parse(z.object({ from: iso, to: iso }), req.query, res);
    if (!q) return;
    const linked = new Set<string>();
    const meetings = svc().listRange(q.from, q.to).map((m) => { if (m.runId) linked.add(m.runId); return view(m); });
    const f = Date.parse(q.from), t = Date.parse(q.to);
    // Processed recordings with no schedule entry, shown as all-day items on their date.
    const processed = (deps.pipeline?.listMeetings() ?? []).filter((m) => {
      if (linked.has(m.runId) || !m.date) return false;
      const d = new Date(`${m.date}T12:00:00`).getTime();
      return d >= f && d < t;
    });
    res.json({ meetings, processed });
  });

  router.get('/:id', (req, res) => { try { res.json(view(svc().get(req.params.id))); } catch (e) { fail(res, e); } });

  router.post('/', (req, res) => {
    const b = parse(meetingBody, req.body, res);
    if (!b) return;
    try { const r = svc().create(b, { by: b.by }); res.status(201).json({ meeting: view(r.meeting), warnings: r.warnings }); } catch (e) { fail(res, e); }
  });

  router.put('/:id', (req, res) => {
    const b = parse(meetingBody, req.body, res);
    if (!b) return;
    try { const r = svc().update(req.params.id, b, { by: b.by, expectedVersion: b.expectedVersion }); res.json({ meeting: view(r.meeting), warnings: r.warnings }); } catch (e) { fail(res, e); }
  });

  router.post('/:id/postpone', (req, res) => {
    const b = parse(postponeBody, req.body, res);
    if (!b) return;
    if (!b.dateTbd && (!b.start || !b.end)) { res.status(400).json({ error: 'ValidationError', message: 'Pick a new date and time, or choose “Date to be decided”.' }); return; }
    try {
      const r = svc().postpone(req.params.id, b.dateTbd ? null : { start: b.start as string, end: b.end as string }, { by: b.by, reason: b.reason, expectedVersion: b.expectedVersion });
      res.json({ meeting: view(r.meeting), warnings: r.warnings });
    } catch (e) { fail(res, e); }
  });

  router.post('/:id/cancel', (req, res) => {
    const b = parse(cancelBody, req.body, res);
    if (!b) return;
    try { res.json({ meeting: view(svc().cancel(req.params.id, { by: b.by, reason: b.reason, expectedVersion: b.expectedVersion })) }); } catch (e) { fail(res, e); }
  });

  router.post('/:id/restore', (req, res) => {
    const b = parse(z.object({ by }), req.body, res);
    if (!b) return;
    try { res.json({ meeting: view(svc().restore(req.params.id, { by: b.by })) }); } catch (e) { fail(res, e); }
  });

  router.post('/:id/undo', (req, res) => {
    const b = parse(z.object({ version: z.number().int().positive(), by }), req.body, res);
    if (!b) return;
    try { res.json({ meeting: view(svc().undo(req.params.id, b.version, { by: b.by })) }); } catch (e) { fail(res, e); }
  });

  router.delete('/:id', (req, res) => { try { svc().remove(req.params.id); res.status(204).end(); } catch (e) { fail(res, e); } });

  // Notice preview — exactly what would be sent, before anything is sent.
  router.get('/:id/notices', (req, res) => {
    const q = parse(z.object({ kind: noticeKind, tz: timeZone }), req.query, res);
    if (!q) return;
    try { res.json({ emailMode: deps.emailMode, emails: buildNotices(svc().get(req.params.id), q.kind as NoticeKind, q.tz) }); } catch (e) { fail(res, e); }
  });

  router.post('/:id/notify', async (req, res) => {
    const b = parse(z.object({ kind: noticeKind, tz: timeZone, by }), req.body, res);
    if (!b) return;
    try {
      const m = svc().get(req.params.id);
      const result = await sendNotices(m, b.kind as NoticeKind, { emailMode: deps.emailMode, deliver: deps.deliver, sentLog: deps.noticeLog, timeZone: b.tz });
      const note = result.outcome === 'draft_only' ? `Notice prepared for ${m.participants.length} participant(s) — not sent (draft-only mode)`
        : result.outcome === 'sent' ? `Notified ${result.sentTo.length} participant(s)` : `Couldn’t notify ${result.failedTo.join(', ')}: ${result.message}`;
      const saved = svc().recordNote(m.id, result.outcome === 'failed' ? 'notify_failed' : 'notified', note, b.by);
      res.status(result.outcome === 'failed' ? 502 : 200).json({ ...result, meeting: view(saved) });
    } catch (e) { fail(res, e); }
  });

  return router;
}

import express, { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { BotError, MeetingBotService } from '../services/meetingBot/meetingBotService';
import { BotApiError } from '../services/meetingBot/recallClient';
import { parseWebhookEvent, verifyWebhook } from '../services/meetingBot/recallEvents';
import { readBotSettings, writeBotSettings } from '../services/meetingBot/botAutomation';
import { BotSession } from '../services/meetingBot/types';
import { ScheduleError } from '../services/schedule/errors';

const sessionId = z.string().uuid();
const sendSchema = z.object({
  scheduledMeetingId: z.string().uuid(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Confirm that everyone in this meeting knows it is being recorded.' }) }),
  confirmedBy: z.string().trim().max(200).regex(/^[^<>\r\n]*$/).optional(),
}).strict();
const settingsSchema = z.object({
  autoSendToSynced: z.boolean(),
  consent: z.boolean().optional(),
  confirmedBy: z.string().trim().max(200).regex(/^[^<>\r\n]*$/).optional(),
}).strict().refine((b) => !b.autoSendToSynced || b.consent === true, { message: 'Confirm that participants will be told their meetings are recorded.' });
const listQuery = z.object({ meetingIds: z.string().max(4000).optional() });

const STATUS: Record<string, number> = { BotNotConfigured: 503, BotNotFound: 404, BotValidationError: 400, BotStateError: 409, MeetingNotFoundError: 404, CircuitOpenError: 503 };

/** What the page sees: no provider ids or internal bookkeeping. */
export function sessionView(s: BotSession) {
  return {
    id: s.id, scheduledMeetingId: s.scheduledMeetingId, platform: s.platform, title: s.title, status: s.status, joinAt: s.joinAt,
    error: s.error, runId: s.runId, automatic: s.consent.automatic, recorded: !!s.recordedAt, canRetry: s.status === 'failed' && !!s.recordedAt,
    history: s.history, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

function fail(res: Response, error: unknown): void {
  if (error instanceof BotError || error instanceof ScheduleError) {
    res.status(STATUS[error.errorClass] ?? 409).json({ error: error.errorClass, message: error.message });
    return;
  }
  if (error instanceof BotApiError) {
    res.status(STATUS[error.errorClass] ?? 502).json({ error: error.errorClass, message: error.message });
    return;
  }
  console.error(JSON.stringify({ event: 'notetaker_route_failed', error_class: (error as Error)?.name ?? 'UnknownError', outcome: 'failure' }));
  res.status(500).json({ error: 'UnknownError', message: 'Something went wrong with the notetaker. Try again.' });
}

export interface NotetakerRouterDeps {
  bots?: MeetingBotService;
  settings: Map<string, string>;
  /** Called after a send or stop so the polling loop speeds up while a bot is active. */
  onActivity?: () => void;
}

/** /api/notetaker — send / stop / follow the meeting bot, and its settings. */
export function createNotetakerRouter(deps: NotetakerRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.bots ? next() : res.status(503).json({ error: 'NotetakerUnavailable', message: 'The notetaker isn’t set up on this server.' })));
  const bots = () => deps.bots as MeetingBotService;

  router.get('/status', (_req, res) => {
    res.json({ configured: bots().configured(), provider: bots().providerName() ?? null, settings: { autoSendToSynced: readBotSettings(deps.settings).autoSendToSynced } });
  });

  router.get('/settings', (_req, res) => { res.json({ autoSendToSynced: readBotSettings(deps.settings).autoSendToSynced }); });
  router.put('/settings', (req, res) => {
    const b = settingsSchema.safeParse(req.body ?? {});
    if (!b.success) { res.status(400).json({ error: 'ValidationError', message: b.error.issues.map((i) => i.message).join(' ') }); return; }
    if (b.data.autoSendToSynced && !bots().configured()) { res.status(503).json({ error: 'BotNotConfigured', message: 'The notetaker isn’t set up on this server. Add RECALL_API_KEY first.' }); return; }
    res.json({ autoSendToSynced: writeBotSettings(deps.settings, b.data).autoSendToSynced });
    deps.onActivity?.();
  });

  router.get('/sessions', (req, res) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'ValidationError', message: 'Bad meetingIds.' }); return; }
    const ids = q.data.meetingIds ? new Set(q.data.meetingIds.split(',').filter(Boolean)) : undefined;
    // Newest session per meeting: that's the one the page shows.
    const seen = new Set<string>();
    const sessions = bots().list().filter((s) => (!ids || ids.has(s.scheduledMeetingId)) && !seen.has(s.scheduledMeetingId) && seen.add(s.scheduledMeetingId));
    res.json({ sessions: sessions.map(sessionView), active: bots().hasActiveWork() });
  });

  router.post('/sessions', async (req: Request, res: Response) => {
    const b = sendSchema.safeParse(req.body ?? {});
    if (!b.success) { res.status(400).json({ error: 'ValidationError', message: b.error.issues.map((i) => i.message).join(' ') }); return; }
    try {
      const s = await bots().send({ ...b.data, automatic: false });
      deps.onActivity?.();
      res.status(201).json(sessionView(s));
    } catch (e) { fail(res, e); }
  });

  for (const action of ['stop', 'retry'] as const) {
    router.post(`/sessions/:id/${action}`, async (req, res) => {
      const p = sessionId.safeParse(req.params.id);
      if (!p.success) { res.status(400).json({ error: 'ValidationError', message: 'Bad session id.' }); return; }
      try {
        const s = action === 'stop' ? await bots().stop(p.data) : await bots().retry(p.data);
        deps.onActivity?.();
        res.json(sessionView(s));
      } catch (e) { fail(res, e); }
    });
  }

  return router;
}

/**
 * POST /api/notetaker/webhook — Recall.ai status events. Mounted BEFORE express.json() because the
 * signature covers the exact raw bytes. Unsigned or badly signed requests are refused; accepted events
 * are acknowledged at once and handled in the background (processing can take minutes, and Recall
 * retries slow webhooks — handling is idempotent, so a retry is harmless).
 */
export function notetakerWebhook(deps: { bots?: MeetingBotService; secret?: string; now?: () => number }): RequestHandler[] {
  return [express.raw({ type: () => true, limit: '1mb' }), (req: Request, res: Response) => {
    if (!deps.bots) { res.status(503).json({ error: 'NotetakerUnavailable', message: 'The notetaker isn’t set up on this server.' }); return; }
    if (!deps.secret) { res.status(503).json({ error: 'WebhookNotConfigured', message: 'Set RECALL_WEBHOOK_SECRET to accept Recall.ai webhooks.' }); return; }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyWebhook(raw, req.headers, deps.secret, deps.now?.())) {
      console.error(JSON.stringify({ event: 'notetaker_webhook_rejected', error_class: 'AuthError', outcome: 'failure' }));
      res.status(401).json({ error: 'AuthError', message: 'Invalid webhook signature.' });
      return;
    }
    let body: unknown;
    try { body = JSON.parse(raw.toString('utf8')); } catch { res.status(400).json({ error: 'ValidationError', message: 'Webhook body is not valid JSON.' }); return; }
    const evt = parseWebhookEvent(body);
    if (!evt) { res.status(200).json({ ignored: true }); return; }
    res.status(200).json({ received: true });
    deps.bots.handleEvent(evt).catch((error) => console.error(JSON.stringify({ event: 'notetaker_webhook_failed', error_class: (error as Error).name, outcome: 'failure' })));
  }];
}

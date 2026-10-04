import express, { Router, Request, Response } from 'express';
import path from 'path';
import { z } from 'zod';
import { CalendarSyncError, CalendarSyncService } from '../services/calendarSync/calendarSyncService';
import { CalendarApiError } from '../services/calendarSync/http';
import { TokenKeyError } from '../services/calendarSync/tokenCrypto';

const provider = z.enum(['google', 'microsoft']);
const settingsSchema = z.object({
  selectedCalendarIds: z.array(z.string().min(1).max(500)).max(100).optional(),
  options: z.object({ skipSolo: z.boolean().optional() }).strict().optional(),
}).strict();
const callbackSchema = z.object({ code: z.string().min(1).max(4000).optional(), state: z.string().min(1).max(200).optional(), error: z.string().max(200).optional(), error_description: z.string().max(1000).optional() });

const STATUS: Record<string, number> = { NotConfigured: 503, NotConnected: 404, InvalidState: 400, ValidationError: 400, TokenKeyError: 503, AuthError: 401, RateLimitError: 429, UpstreamUnavailable: 502, TimeoutError: 504, ContractViolation: 502 };

function fail(res: Response, error: unknown): void {
  if (error instanceof CalendarSyncError || error instanceof CalendarApiError || error instanceof TokenKeyError) {
    res.status(STATUS[error.errorClass] ?? 400).json({ error: error.errorClass, message: error.message });
    return;
  }
  console.error(JSON.stringify({ event: 'calendar_route_failed', error_class: error instanceof Error ? error.name : 'UnknownError', outcome: 'failure' }));
  res.status(500).json({ error: 'CalendarSyncFailed', message: 'Calendar sync failed unexpectedly.' });
}

/**
 * Calendar sync. OAuth runs entirely on the server: the page only ever sees whether a calendar is
 * connected, never a token. Read-only access; events for the next 4 weeks.
 */
export function createCalendarSyncRouter(deps: { calendar?: CalendarSyncService }): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.calendar ? next() : res.status(503).json({ error: 'CalendarSyncUnavailable', message: 'Calendar sync isn’t set up on this server.' })));
  const svc = () => deps.calendar as CalendarSyncService;

  router.get('/connections', (_req, res) => { res.json(svc().status()); });

  // "Connect": the browser comes here and is sent on to Google's/Microsoft's consent screen.
  router.get('/oauth/:provider/start', (req: Request, res: Response) => {
    const p = provider.safeParse(req.params.provider);
    if (!p.success) { res.status(404).json({ error: 'UnknownProvider', message: 'Unknown calendar provider.' }); return; }
    try { res.redirect(302, svc().beginAuth(p.data)); } catch (e) {
      res.redirect(302, `/?page=settings&calendarError=${encodeURIComponent(e instanceof Error ? e.message : 'Calendar sync isn’t set up.')}`);
    }
  });

  // The provider sends the browser back with ?code&state (or ?error when the user declined).
  router.get('/oauth/:provider/callback', async (req: Request, res: Response) => {
    const p = provider.safeParse(req.params.provider);
    const q = callbackSchema.safeParse(req.query);
    const back = (params: string) => res.redirect(302, `/?page=settings&${params}`);
    if (!p.success || !q.success) { back(`calendarError=${encodeURIComponent('The sign-in response wasn’t valid. Try connecting again.')}`); return; }
    if (q.data.error || !q.data.code || !q.data.state) {
      back(`calendarError=${encodeURIComponent(q.data.error === 'access_denied' ? 'Calendar access wasn’t granted, so nothing was connected.' : 'The calendar sign-in didn’t finish. Try connecting again.')}`);
      return;
    }
    try {
      await svc().completeAuth(p.data, q.data.code, q.data.state);
      back(`calendarConnected=${p.data}`);
    } catch (e) {
      back(`calendarError=${encodeURIComponent(e instanceof Error ? e.message : 'Connecting the calendar failed.')}`);
    }
  });

  router.put('/connections/:provider', async (req: Request, res: Response) => {
    const p = provider.safeParse(req.params.provider);
    const b = settingsSchema.safeParse(req.body ?? {});
    if (!p.success || !b.success) { res.status(400).json({ error: 'ValidationError', message: 'Unknown provider or settings.' }); return; }
    try { res.json({ connection: await svc().updateSettings(p.data, b.data) }); } catch (e) { fail(res, e); }
  });

  router.post('/sync', async (req: Request, res: Response) => {
    const p = req.body && req.body.provider !== undefined ? provider.safeParse(req.body.provider) : undefined;
    if (p && !p.success) { res.status(400).json({ error: 'ValidationError', message: 'Unknown provider.' }); return; }
    try { res.json({ results: await svc().sync(p?.data), status: svc().status() }); } catch (e) { fail(res, e); }
  });

  router.delete('/connections/:provider', async (req: Request, res: Response) => {
    const p = provider.safeParse(req.params.provider);
    if (!p.success) { res.status(400).json({ error: 'ValidationError', message: 'Unknown provider.' }); return; }
    try { res.json(await svc().disconnect(p.data)); } catch (e) { fail(res, e); }
  });

  return router;
}

/** Attendee photos fetched from Outlook. File names are hashes; nothing else in the folder is reachable. */
export function photoRoute(photoDir?: string) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    if (!photoDir || !/^[a-f0-9]{40}\.jpg$/.test(req.params.file)) { res.status(404).end(); return; }
    res.sendFile(path.join(photoDir, req.params.file), { headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => { if (err) next(); });
  };
}

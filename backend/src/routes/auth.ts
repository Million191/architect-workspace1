import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { AuthError, AuthService, SESSION_DAYS } from '../services/auth/authService';

/**
 * Sign-in for the dashboard (routes) and the guard in front of everything else (requireAuth).
 * Cookie: HttpOnly, SameSite=Lax (not sent on cross-site POSTs), Secure on https, 7 days.
 * First-run "Create your login" is accepted only from this computer (loopback), so someone else on the
 * network can't claim the account. Failed sign-ins: 5 per 15 minutes per address, then 429.
 */
export const COOKIE = 'ma_session';
const credentials = z.object({ email: z.string().trim().min(3).max(320), password: z.string().min(1).max(200) }).strict();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 5;

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } }
  }
  return undefined;
}
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function setCookie(req: Request, res: Response, token: string): void {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: SESSION_DAYS * 24 * 3600 * 1000 });
}

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();
  const fails = new Map<string, number[]>();
  const recentFails = (ip: string) => (fails.get(ip) ?? []).filter((t) => Date.now() - t < WINDOW_MS);

  router.get('/status', (req, res) => {
    res.json({ signedIn: auth.check(readCookie(req, COOKIE)), setupNeeded: !auth.hasAccount(), canSetUp: !auth.hasAccount() && isLoopback(req.socket.remoteAddress) });
  });

  router.post('/setup', (req, res) => {
    const body = credentials.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: 'Type your email and a password.' }); return; }
    if (!isLoopback(req.socket.remoteAddress)) { res.status(403).json({ error: 'SetupNotAllowed', message: 'Create the login on the computer that runs Meeting Assistant.' }); return; }
    try {
      setCookie(req, res, auth.createAccount(body.data.email, body.data.password));
      console.log(JSON.stringify({ event: 'auth_account_created', outcome: 'success' }));
      res.status(201).json({ signedIn: true });
    } catch (e) {
      if (e instanceof AuthError) { res.status(e.errorClass === 'AccountExists' ? 409 : 400).json({ error: e.errorClass, message: e.message }); return; }
      throw e;
    }
  });

  router.post('/login', (req, res) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (recentFails(ip).length >= MAX_FAILS) { res.status(429).json({ error: 'TooManyAttempts', message: 'Too many attempts. Wait 15 minutes and try again.' }); return; }
    const body = credentials.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: 'Type your email and password.' }); return; }
    const token = auth.signIn(body.data.email, body.data.password);
    if (!token) {
      fails.set(ip, [...recentFails(ip), Date.now()]);
      console.log(JSON.stringify({ event: 'auth_sign_in_failed', outcome: 'failure', error_class: 'AuthError' }));
      res.status(401).json({ error: 'AuthError', message: 'Email or password is incorrect.' });
      return;
    }
    fails.delete(ip);
    setCookie(req, res, token);
    res.json({ signedIn: true });
  });

  // Change password: signed in, with the current password; other browsers are signed out.
  router.post('/password', (req, res) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!auth.check(readCookie(req, COOKIE))) { res.status(401).json({ error: 'AuthRequired', message: 'Sign in to continue.' }); return; }
    if (recentFails(ip).length >= MAX_FAILS) { res.status(429).json({ error: 'TooManyAttempts', message: 'Too many attempts. Wait 15 minutes and try again.' }); return; }
    const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict().safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: 'Type your current password and a new one.' }); return; }
    try {
      const token = auth.changePassword(body.data.current, body.data.next);
      if (!token) {
        fails.set(ip, [...recentFails(ip), Date.now()]);
        res.status(401).json({ error: 'AuthError', message: 'Your current password is incorrect.' });
        return;
      }
      fails.delete(ip);
      setCookie(req, res, token);
      console.log(JSON.stringify({ event: 'auth_password_changed', outcome: 'success' }));
      res.json({ changed: true });
    } catch (e) {
      if (e instanceof AuthError) { res.status(400).json({ error: e.errorClass, message: e.message }); return; }
      throw e;
    }
  });

  router.post('/logout', (req, res) => {
    auth.signOut(readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ signedIn: false });
  });
  return router;
}

/** Paths that work without signing in: the sign-in page and its assets, health, and signed provider webhooks. */
const OPEN = [/^\/health$/, /^\/login(\.html)?$/, /^\/api\/auth\//, /^\/api\/notetaker\/webhook$/, /^\/styles\//, /^\/fonts\//, /^\/favicon/];

export function requireAuth(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (OPEN.some((r) => r.test(req.path)) || auth.check(readCookie(req, COOKIE))) { next(); return; }
    if (req.path.startsWith('/api/')) { res.status(401).json({ error: 'AuthRequired', message: 'Sign in to continue.' }); return; }
    const back = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
    res.redirect(302, `/login${back}`);
  };
}

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Login for the dashboard: one account (email + password), sessions by cookie.
 * - Passwords are stored only as scrypt hashes (random salt per password); never logged or returned.
 * - Session tokens are random 32 bytes; only their SHA-256 is stored, so a copied sessions file can't be used.
 * - Sessions last 7 days and are refreshed while in use; signing out removes the session.
 * Failure modes: a wrong password returns false (the route answers with one generic message);
 * repeated failures are rate-limited by the route. Not handled: password recovery by email — reset
 * the login with `npm run auth:reset` on the server (then "Create your login" appears again).
 */
export interface AuthAccount { email: string; passwordHash: string; createdAt: string }
export interface AuthSession { createdAt: string; expiresAt: string }

export const SESSION_DAYS = 7;
export const MIN_PASSWORD = 6;
const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export class AuthError extends Error {
  constructor(readonly errorClass: 'AuthValidationError' | 'AccountExists' | 'NoAccount', message: string) { super(message); }
}

function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAuthService(deps: { accounts: Map<string, AuthAccount>; sessions: Map<string, AuthSession>; now?: () => Date }) {
  const now = () => (deps.now ?? (() => new Date()))();
  const account = () => deps.accounts.get('owner');
  const expiry = () => new Date(now().getTime() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  function newSession(): string {
    const token = randomBytes(32).toString('base64url');
    deps.sessions.set(tokenKey(token), { createdAt: now().toISOString(), expiresAt: expiry() });
    return token;
  }
  return {
    hasAccount: () => !!account(),
    email: () => account()?.email,
    /** First run only: creates the one account and signs in. */
    createAccount(email: string, password: string): string {
      if (account()) throw new AuthError('AccountExists', 'A login already exists. Sign in instead.');
      if (!EMAIL.test(email.trim())) throw new AuthError('AuthValidationError', 'Type a valid email address, like name@example.com.');
      if (password.length < MIN_PASSWORD) throw new AuthError('AuthValidationError', `Use at least ${MIN_PASSWORD} characters for the password.`);
      deps.accounts.set('owner', { email: email.trim().toLowerCase(), passwordHash: hashPassword(password), createdAt: now().toISOString() });
      return newSession();
    },
    /** A session token when the email and password are right; undefined otherwise. */
    signIn(email: string, password: string): string | undefined {
      const a = account();
      // Always run the hash, so a wrong email takes as long as a wrong password.
      const ok = passwordMatches(password, a?.passwordHash ?? hashPassword('not-the-password'));
      return a && ok && a.email === email.trim().toLowerCase() ? newSession() : undefined;
    },
    /** Valid session → refreshed and true. Expired or unknown → false (expired ones are removed). */
    check(token: string | undefined): boolean {
      if (!token) return false;
      const key = tokenKey(token), s = deps.sessions.get(key);
      if (!s) return false;
      if (Date.parse(s.expiresAt) <= now().getTime()) { deps.sessions.delete(key); return false; }
      // Refresh at most once an hour (each write rewrites the sessions file).
      if (Date.parse(s.expiresAt) - now().getTime() < SESSION_DAYS * 24 * 3600 * 1000 - 3600 * 1000) deps.sessions.set(key, { ...s, expiresAt: expiry() });
      return true;
    },
    signOut(token: string | undefined): void { if (token) deps.sessions.delete(tokenKey(token)); },
    /**
     * New password after checking the current one. Every session ends (other browsers are signed out);
     * returns a fresh session token for this browser, or undefined when the current password is wrong.
     */
    changePassword(current: string, next: string): string | undefined {
      const a = account();
      if (!a) throw new AuthError('NoAccount', 'There is no login yet.');
      if (!passwordMatches(current, a.passwordHash)) return undefined;
      if (next.length < MIN_PASSWORD) throw new AuthError('AuthValidationError', `Use at least ${MIN_PASSWORD} characters for the new password.`);
      if (next === current) throw new AuthError('AuthValidationError', 'Choose a password that is different from the current one.');
      deps.accounts.set('owner', { ...a, passwordHash: hashPassword(next) });
      for (const key of [...deps.sessions.keys()]) deps.sessions.delete(key);
      return newSession();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

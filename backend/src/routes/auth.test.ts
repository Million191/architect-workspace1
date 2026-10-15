import request from 'supertest';
import { createApp } from '../server';
import { AuthAccount, AuthSession, createAuthService } from '../services/auth/authService';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { isLoopback } from './auth';

/** Dashboard login: first-run setup (this computer only), sign in / out, everything else guarded, rate limit. */
function setup() {
  const accounts = new Map<string, AuthAccount>(), sessions = new Map<string, AuthSession>();
  const auth = createAuthService({ accounts, sessions });
  const pipeline = createMeetingPipeline(Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const }), createPipelineStores());
  return { accounts, sessions, auth, app: createApp({ auth, meetingPipeline: pipeline }) };
}
const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('ma_session=')) ?? '';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('dashboard login', () => {
  it('signed out: pages go to /login, the API answers 401; the sign-in page, health and webhook stay open', async () => {
    const { app } = setup();
    const page = await request(app).get('/?page=people');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/login?next=%2F%3Fpage%3Dpeople');
    expect((await request(app).get('/')).headers.location).toBe('/login');
    expect((await request(app).get('/api/meetings')).body).toEqual({ error: 'AuthRequired', message: 'Sign in to continue.' });
    expect((await request(app).get('/api/meetings')).status).toBe(401);
    expect((await request(app).get('/login')).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/api/auth/status')).body).toEqual({ signedIn: false, setupNeeded: true, canSetUp: true });
  });

  it('first run: create the login (once); the password is stored only as a hash; then the app opens', async () => {
    const { app, accounts, sessions } = setup();
    expect((await request(app).post('/api/auth/setup').send({ email: 'me@x.io', password: 'short' })).status).toBe(400);
    const made = await request(app).post('/api/auth/setup').send({ email: 'Me@X.io', password: 'correct horse battery' });
    expect(made.status).toBe(201);
    const cookie = cookieOf(made);
    expect(made.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(made.headers['set-cookie'][0]).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify([...accounts.values()])).not.toContain('correct horse battery');
    expect(accounts.get('owner')).toMatchObject({ email: 'me@x.io', passwordHash: expect.stringMatching(/^scrypt\$/) });
    expect([...sessions.keys()][0]).not.toBe(cookie.split('=')[1]); // only a hash of the token is stored
    expect((await request(app).get('/api/meetings').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post('/api/auth/setup').send({ email: 'other@x.io', password: 'another long one' })).status).toBe(409);
  });

  it('sign in with the right password, not the wrong one; sign out ends the session', async () => {
    const { app, auth } = setup();
    auth.createAccount('me@x.io', 'correct horse battery');
    const wrong = await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Email or password is incorrect.');
    expect((await request(app).post('/api/auth/login').send({ email: 'someone@x.io', password: 'correct horse battery' })).body.message).toBe('Email or password is incorrect.');
    const ok = await request(app).post('/api/auth/login').send({ email: ' ME@x.io ', password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    const cookie = cookieOf(ok);
    expect((await request(app).get('/api/auth/status').set('Cookie', cookie)).body.signedIn).toBe(true);
    expect((await request(app).get('/').set('Cookie', cookie)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect((await request(app).get('/api/meetings').set('Cookie', cookie)).status).toBe(401);
  });

  it('too many wrong passwords: 429 for a while, even with the right one', async () => {
    const { app, auth } = setup();
    auth.createAccount('me@x.io', 'correct horse battery');
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: `wrong ${i} password` });
    const blocked = await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'correct horse battery' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Too many attempts. Wait 15 minutes and try again.');
  });

  it('change password: needs the current one; signs out other browsers; the new one works, the old one doesn’t', async () => {
    const { app, auth } = setup();
    auth.createAccount('me@x.io', 'correct horse battery');
    const here = cookieOf(await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'correct horse battery' }));
    const elsewhere = cookieOf(await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'correct horse battery' }));
    expect((await request(app).post('/api/auth/password').send({ current: 'correct horse battery', next: 'brand new password' })).status).toBe(401); // signed out
    const wrong = await request(app).post('/api/auth/password').set('Cookie', here).send({ current: 'not it at all', next: 'brand new password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Your current password is incorrect.');
    expect((await request(app).post('/api/auth/password').set('Cookie', here).send({ current: 'correct horse battery', next: 'short' })).body.message).toBe('Use at least 6 characters for the new password.');
    expect((await request(app).post('/api/auth/password').set('Cookie', here).send({ current: 'correct horse battery', next: 'correct horse battery' })).status).toBe(400);
    const changed = await request(app).post('/api/auth/password').set('Cookie', here).send({ current: 'correct horse battery', next: 'brand new password' });
    expect(changed.status).toBe(200);
    const fresh = cookieOf(changed);
    expect((await request(app).get('/api/meetings').set('Cookie', fresh)).status).toBe(200); // this browser stays signed in
    expect((await request(app).get('/api/meetings').set('Cookie', elsewhere)).status).toBe(401); // the other one is signed out
    expect((await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'correct horse battery' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'me@x.io', password: 'brand new password' })).status).toBe(200);
  });

  it('passwords need at least 6 characters (5 is refused, 6 is fine)', () => {
    const auth = createAuthService({ accounts: new Map(), sessions: new Map() });
    expect(() => auth.createAccount('me@x.io', '12345')).toThrow('Use at least 6 characters for the password.');
    expect(auth.createAccount('me@x.io', '123456')).toEqual(expect.any(String));
  });

  it('sessions expire after 7 days', () => {
    let now = new Date('2026-10-12T10:00:00Z');
    const auth = createAuthService({ accounts: new Map(), sessions: new Map(), now: () => now });
    const token = auth.createAccount('me@x.io', 'correct horse battery');
    expect(auth.check(token)).toBe(true);
    now = new Date('2026-10-20T10:00:00Z');
    expect(auth.check(token)).toBe(false);
    expect(auth.check(undefined)).toBe(false);
  });

  it('the login can only be created from this computer', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

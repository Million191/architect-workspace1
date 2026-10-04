import { FetchLike } from '../http';

/**
 * In-memory stand-ins for Google Calendar and Microsoft Graph, answering the same URLs the real
 * clients call. Tests change `events` between syncs to simulate edits, cancellations, deletions.
 */
export interface FakeApis {
  fetch: FetchLike;
  calls: string[];
  google: { events: Record<string, unknown[]>; calendars: unknown[]; failNext?: number; tokenRequests: Array<Record<string, string>> };
  microsoft: { events: Record<string, unknown[]>; calendars: unknown[]; photos: Record<string, Buffer>; tokenRequests: Array<Record<string, string>> };
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('binary') : JSON.stringify(body);
  return {
    ok: status < 400, status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
    arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(text); return Uint8Array.from(b).buffer as ArrayBuffer; },
  };
}

export function fakeCalendarApis(): FakeApis {
  let counter = 0;
  const apis: FakeApis = {
    calls: [],
    google: { events: {}, calendars: [{ id: 'primary-cal', summary: 'Sara Lee', primary: true }, { id: 'team-cal', summary: 'Team' }], tokenRequests: [] },
    microsoft: { events: {}, calendars: [{ id: 'ms-cal', name: 'Calendar', isDefaultCalendar: true }], photos: {}, tokenRequests: [] },
    fetch: async (url, init = {}) => {
      apis.calls.push(`${init.method ?? 'GET'} ${url.split('?')[0]}`);
      const auth = init.headers?.Authorization ?? '';
      if (url === 'https://oauth2.googleapis.com/token' || url.endsWith('/oauth2/v2.0/token')) {
        const body = Object.fromEntries(new URLSearchParams(init.body ?? ''));
        (url.includes('google') ? apis.google : apis.microsoft).tokenRequests.push(body);
        if (body.grant_type === 'authorization_code' && !body.code_verifier) return res(400, { error: 'invalid_request' });
        if (body.refresh_token === 'revoked') return res(400, { error: 'invalid_grant' });
        counter++;
        return res(200, { access_token: `access-${counter}`, refresh_token: body.grant_type === 'authorization_code' ? 'refresh-1' : undefined, expires_in: 3600, scope: 'calendar' });
      }
      if (url === 'https://oauth2.googleapis.com/revoke') return res(200, {});
      if (!auth.startsWith('Bearer access-')) return res(401, { error: 'unauthenticated' });
      if (apis.google.failNext) { apis.google.failNext--; return res(503, { error: 'backend' }); }
      if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return res(200, { email: 'sara.lee@acme.com', name: 'Sara Lee' });
      if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) return res(200, { items: apis.google.calendars });
      const g = /calendars\/([^/]+)\/events/.exec(url);
      if (g && url.includes('googleapis')) return res(200, { items: apis.google.events[decodeURIComponent(g[1])] ?? [] });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return res(200, { mail: 'sara.lee@acme.com', displayName: 'Sara Lee' });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me/calendars?')) return res(200, { value: apis.microsoft.calendars });
      const m = /me\/calendars\/([^/]+)\/calendarView/.exec(url);
      if (m) return res(200, { value: apis.microsoft.events[decodeURIComponent(m[1])] ?? [] });
      const p = /users\/([^/]+)\/photos/.exec(url);
      if (p) { const photo = apis.microsoft.photos[decodeURIComponent(p[1])]; return photo ? res(200, photo, { 'content-type': 'image/jpeg' }) : res(404, { error: 'ImageNotFound' }); }
      return res(404, { error: `no fake for ${url}` });
    },
  };
  return apis;
}

/** A Google event `hours` from now, `mins` long. */
export function gEvent(id: string, hours: number, extra: Record<string, unknown> = {}, mins = 60) {
  const start = new Date(Date.now() + hours * 3600000);
  return {
    id, status: 'confirmed', summary: `Event ${id}`, updated: '2026-10-01T00:00:00Z',
    start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + mins * 60000).toISOString() },
    attendees: [{ email: 'sara.lee@acme.com', self: true }, { email: 'tom.ward@acme.com', displayName: 'Tom Ward' }, { email: 'room-4@resource.calendar.google.com', resource: true }],
    ...extra,
  };
}

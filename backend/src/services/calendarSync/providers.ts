import { call, callJson, CalendarApiError, FetchLike, form } from './http';
import { pickMeetingLink, platformOf } from './meetingLinks';
import { CalendarInfo, CalendarProvider, ExternalAttendee, ExternalEvent, OAuthTokens } from './types';

/** Client ids/secrets from the environment, plus the public base URL the redirect comes back to. */
export interface OAuthConfig {
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string; tenant: string };
  baseUrl: string;
}

export function oauthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  return {
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    microsoft: env.MS_CLIENT_ID && env.MS_CLIENT_SECRET ? { clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET, tenant: env.MS_TENANT || 'common' } : undefined,
    baseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  };
}

export function redirectUri(cfg: OAuthConfig, provider: CalendarProvider): string {
  return `${cfg.baseUrl}/api/calendar/oauth/${provider}/callback`;
}

/** Read-only calendar access plus who the account is. Nothing that can change a calendar. */
export const SCOPES: Record<CalendarProvider, string> = {
  google: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
  microsoft: 'openid email profile offline_access Calendars.Read User.Read User.ReadBasic.All',
};

export interface CalendarClient {
  authUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  refresh(tokens: OAuthTokens): Promise<OAuthTokens>;
  account(tokens: OAuthTokens): Promise<{ email: string; name?: string }>;
  calendars(tokens: OAuthTokens): Promise<CalendarInfo[]>;
  events(tokens: OAuthTokens, calendarId: string, from: Date, to: Date): Promise<ExternalEvent[]>;
  /** Profile photo bytes for an attendee, when the provider exposes one. */
  photo?(tokens: OAuthTokens, email: string): Promise<{ contentType: string; bytes: Buffer } | null>;
  revoke?(tokens: OAuthTokens): Promise<void>;
}

function tokensFrom(body: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }, previous?: OAuthTokens, now = Date.now()): OAuthTokens {
  if (!body.access_token) throw new CalendarApiError('ContractViolation', 'The sign-in response had no access token.');
  // Refresh responses often omit the refresh token: keep the one we have.
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? previous?.refreshToken, expiresAt: now + (body.expires_in ?? 3600) * 1000 - 60000, scope: body.scope ?? previous?.scope };
}
const bearer = (t: OAuthTokens) => ({ Authorization: `Bearer ${t.accessToken}` });

// ---- Google Calendar (REST v3) --------------------------------------------------------------------
interface GEvent {
  id: string; status?: string; summary?: string; updated?: string; description?: string; location?: string; hangoutLink?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean; organizer?: boolean; responseStatus?: string }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

export function mapGoogleEvent(e: GEvent, calendarId: string): ExternalEvent | null {
  const start = e.start?.dateTime ?? e.start?.date, end = e.end?.dateTime ?? e.end?.date;
  if (!e.id || !start || !end) return null;
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const link = pickMeetingLink([video, e.hangoutLink], [e.location, e.description]);
  const attendees: ExternalAttendee[] = (e.attendees ?? []).filter((a) => a.email).map((a) => ({ email: a.email as string, name: a.displayName, self: a.self, resource: a.resource, organizer: a.organizer }));
  return { id: e.id, calendarId, title: e.summary?.trim() || '(No title)', start, end, allDay: !e.start?.dateTime, cancelled: e.status === 'cancelled', attendees, link, platform: platformOf(link), description: e.description, updated: e.updated };
}

export function googleClient(cfg: NonNullable<OAuthConfig['google']>, base: OAuthConfig, fetchImpl: FetchLike): CalendarClient {
  const token = (body: Record<string, string>) => callJson<Record<string, never>>(fetchImpl, 'https://oauth2.googleapis.com/token', { method: 'POST', label: 'google.token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  return {
    authUrl(state, challenge) {
      const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri(base, 'google'), response_type: 'code', scope: SCOPES.google, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode(code, verifier) {
      return tokensFrom(await token({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(base, 'google'), grant_type: 'authorization_code', code_verifier: verifier }));
    },
    async refresh(t) {
      if (!t.refreshToken) throw new CalendarApiError('AuthError', 'The Google sign-in has no refresh token. Reconnect the calendar.');
      return tokensFrom(await token({ refresh_token: t.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }), t);
    },
    async account(t) {
      const me = await callJson<{ email?: string; name?: string }>(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', { label: 'google.userinfo', headers: bearer(t) });
      if (!me.email) throw new CalendarApiError('ContractViolation', 'Google didn’t say which account signed in.');
      return { email: me.email, name: me.name };
    },
    async calendars(t) {
      const out: CalendarInfo[] = [];
      let page: string | undefined;
      do {
        const res = await callJson<{ items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean }>; nextPageToken?: string }>(fetchImpl,
          `https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { label: 'google.calendarList', headers: bearer(t) });
        for (const c of res.items ?? []) out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary });
        page = res.nextPageToken;
      } while (page);
      return out;
    },
    async events(t, calendarId, from, to) {
      const out: ExternalEvent[] = [];
      let page: string | undefined;
      do {
        const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', showDeleted: 'true', maxResults: '250', timeMin: from.toISOString(), timeMax: to.toISOString() });
        if (page) q.set('pageToken', page);
        const res = await callJson<{ items?: GEvent[]; nextPageToken?: string }>(fetchImpl, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`, { label: 'google.events', headers: bearer(t) });
        for (const e of res.items ?? []) { const m = mapGoogleEvent(e, calendarId); if (m) out.push(m); }
        page = res.nextPageToken;
      } while (page);
      return out;
    },
    async revoke(t) {
      await call(fetchImpl, 'https://oauth2.googleapis.com/revoke', { method: 'POST', label: 'google.revoke', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: t.refreshToken ?? t.accessToken }) });
    },
  };
}

// ---- Microsoft Graph (Outlook / Microsoft 365) --------------------------------------------------
interface MEvent {
  id: string; subject?: string; isAllDay?: boolean; isCancelled?: boolean; lastModifiedDateTime?: string; bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string }; onlineMeeting?: { joinUrl?: string } | null; onlineMeetingUrl?: string | null;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{ type?: string; emailAddress?: { address?: string; name?: string } }>;
}

/** Graph returns local date-times without an offset; we ask for UTC, so append Z. */
function graphTime(t?: { dateTime?: string }): string | undefined {
  if (!t?.dateTime) return undefined;
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(t.dateTime) ? t.dateTime : `${t.dateTime.replace(/\.\d+$/, '')}Z`;
}

export function mapGraphEvent(e: MEvent, calendarId: string, selfEmail: string): ExternalEvent | null {
  const start = graphTime(e.start), end = graphTime(e.end);
  if (!e.id || !start || !end) return null;
  const link = pickMeetingLink([e.onlineMeeting?.joinUrl, e.onlineMeetingUrl], [e.location?.displayName, e.bodyPreview]);
  const self = selfEmail.toLowerCase();
  const organizer = e.organizer?.emailAddress?.address;
  const attendees: ExternalAttendee[] = (e.attendees ?? []).filter((a) => a.emailAddress?.address).map((a) => ({
    email: a.emailAddress!.address as string, name: a.emailAddress!.name, resource: a.type === 'resource', self: a.emailAddress!.address!.toLowerCase() === self,
  }));
  if (organizer && !attendees.some((a) => a.email.toLowerCase() === organizer.toLowerCase())) {
    attendees.unshift({ email: organizer, name: e.organizer?.emailAddress?.name, organizer: true, self: organizer.toLowerCase() === self });
  }
  const allDay = !!e.isAllDay;
  return { id: e.id, calendarId, title: e.subject?.trim() || '(No title)', start: allDay ? start.slice(0, 10) : start, end: allDay ? end.slice(0, 10) : end, allDay, cancelled: !!e.isCancelled, attendees, link, platform: platformOf(link), description: e.bodyPreview, updated: e.lastModifiedDateTime };
}

export function microsoftClient(cfg: NonNullable<OAuthConfig['microsoft']>, base: OAuthConfig, fetchImpl: FetchLike): CalendarClient {
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0`;
  const token = (body: Record<string, string>) => callJson<Record<string, never>>(fetchImpl, `${authority}/token`, { method: 'POST', label: 'microsoft.token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ ...body, client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: SCOPES.microsoft }) });
  let selfEmail = '';
  return {
    authUrl(state, challenge) {
      const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri(base, 'microsoft'), response_type: 'code', response_mode: 'query', scope: SCOPES.microsoft, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
      return `${authority}/authorize?${q}`;
    },
    async exchangeCode(code, verifier) {
      return tokensFrom(await token({ code, redirect_uri: redirectUri(base, 'microsoft'), grant_type: 'authorization_code', code_verifier: verifier }));
    },
    async refresh(t) {
      if (!t.refreshToken) throw new CalendarApiError('AuthError', 'The Outlook sign-in has no refresh token. Reconnect the calendar.');
      return tokensFrom(await token({ refresh_token: t.refreshToken, grant_type: 'refresh_token' }), t);
    },
    async account(t) {
      const me = await callJson<{ mail?: string; userPrincipalName?: string; displayName?: string }>(fetchImpl, 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { label: 'graph.me', headers: bearer(t) });
      const email = me.mail || me.userPrincipalName;
      if (!email) throw new CalendarApiError('ContractViolation', 'Microsoft didn’t say which account signed in.');
      selfEmail = email;
      return { email, name: me.displayName };
    },
    async calendars(t) {
      const res = await callJson<{ value?: Array<{ id: string; name?: string; isDefaultCalendar?: boolean }> }>(fetchImpl, 'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar&$top=100', { label: 'graph.calendars', headers: bearer(t) });
      return (res.value ?? []).map((c) => ({ id: c.id, name: c.name || 'Calendar', primary: !!c.isDefaultCalendar }));
    },
    async events(t, calendarId, from, to) {
      if (!selfEmail) await this.account(t);
      const out: ExternalEvent[] = [];
      const select = 'id,subject,isAllDay,isCancelled,lastModifiedDateTime,bodyPreview,start,end,location,onlineMeeting,onlineMeetingUrl,organizer,attendees';
      let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=100&$select=${select}`;
      while (url) {
        const res: { value?: MEvent[]; '@odata.nextLink'?: string } = await callJson(fetchImpl, url, { label: 'graph.calendarView', headers: { ...bearer(t), Prefer: 'outlook.timezone="UTC"' } });
        for (const e of res.value ?? []) { const m = mapGraphEvent(e, calendarId, selfEmail); if (m) out.push(m); }
        url = res['@odata.nextLink'];
      }
      return out;
    },
    async photo(t, email) {
      try {
        const res = await call(fetchImpl, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photos/48x48/$value`, { label: 'graph.photo', headers: bearer(t) });
        return { contentType: res.headers.get('content-type') || 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) };
      } catch (error) {
        if (error instanceof CalendarApiError && error.status === 404) return null; // no photo set (or not in the organisation)
        throw error;
      }
    },
  };
}

export function clientFor(provider: CalendarProvider, cfg: OAuthConfig, fetchImpl: FetchLike): CalendarClient | undefined {
  if (provider === 'google') return cfg.google ? googleClient(cfg.google, cfg, fetchImpl) : undefined;
  return cfg.microsoft ? microsoftClient(cfg.microsoft, cfg, fetchImpl) : undefined;
}

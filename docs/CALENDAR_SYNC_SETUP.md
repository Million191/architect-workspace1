# Calendar sync setup (Google Calendar and Outlook)

Meeting Assistant reads calendar events (read-only) for the next 4 weeks: title, time, attendees,
and Zoom/Teams/Meet links. Sign-in happens on the server; tokens are encrypted with
`TOKEN_ENCRYPTION_KEY` and stored in `backend/data/calendar-connections.json`. They never reach
the browser.

## 1. Encryption key (required for both)

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the output in `backend/.env` as `TOKEN_ENCRYPTION_KEY=...`. Changing it later means everyone
reconnects their calendars (old tokens can't be decrypted).

Set `PUBLIC_BASE_URL` to the address people use to open the app (default `http://localhost:3000`).
The redirect URIs below are built from it and must match exactly.

## 2. Google Calendar

1. In Google Cloud Console, create (or pick) a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **OAuth consent screen**: User type *External* (or *Internal* for a Workspace-only app).
   Add scopes `openid`, `email`, `profile`, `.../auth/calendar.readonly`.
   While the app is in *Testing*, add each person who will connect as a **test user** (up to 100).
   `calendar.readonly` is a *sensitive* scope: publishing for everyone requires Google's verification.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `http://localhost:3000/api/calendar/oauth/google/callback`
   (or `<PUBLIC_BASE_URL>/api/calendar/oauth/google/callback`).
5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Google doesn't share attendee photos with calendar access, so Google attendees show initials
(or a photo you set in People).

## 3. Microsoft Outlook / Microsoft 365

1. In the Microsoft Entra admin center: **App registrations → New registration**.
   Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*
   (or single tenant for your organisation only — then set `MS_TENANT` to your tenant id).
2. Redirect URI: platform **Web**, `http://localhost:3000/api/calendar/oauth/microsoft/callback`.
3. **Certificates & secrets → New client secret**. Copy the *value* (shown once).
4. **API permissions → Microsoft Graph → Delegated**: `Calendars.Read`, `User.Read`,
   `User.ReadBasic.All` (attendee photos), `offline_access`, `openid`, `email`, `profile`.
   Some organisations require an admin to grant consent.
5. Set `MS_CLIENT_ID` (Application ID), `MS_CLIENT_SECRET`, and `MS_TENANT` (`common` by default).

## 4. Restart and connect

Restart the backend, open **Settings → Integrations**, and press **Connect**. After signing in you
come back to Settings; the first sync runs straight away and then every 15 minutes while the app is
open. Choose which calendars to sync there. All-day events are always skipped; events with no one
else invited are skipped unless you turn that off.

## Verifying

- `GET /api/calendar/connections` shows `configured: true` for the provider once the env vars and key are set.
- After connecting, synced meetings show a small **Google** / **Outlook** label in the calendar.
- Cancel or move a test event in the calendar, press **Sync now**: the meeting shows as Cancelled or moves.

## What's stored, and removing it

- `calendar-connections.json`: account email, chosen calendars, filters, last sync, encrypted tokens.
- Synced meetings live in `schedule.json` (marked with their calendar event id).
- **Disconnect** revokes the Google token (best effort), deletes the stored tokens, and removes
  synced meetings that have no recording. The calendar itself is never changed.

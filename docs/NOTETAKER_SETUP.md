# Notetaker (Recall.ai) — setup and operation

The notetaker is a bot that joins Zoom, Microsoft Teams, and Google Meet calls as
**"Meeting Assistant Notetaker"**. When it joins, it posts a chat message saying the call is being
recorded. When the call ends, the recording goes through the same pipeline as an upload:
transcription → draft minutes → human review → approved emails. Nothing is shared without approval.

The bots come from [Recall.ai](https://www.recall.ai). We don't build platform bots ourselves.

## Cost

As of October 2026, Recall.ai charges **$0.50 per recording hour**, with no monthly fee and 5 free
hours. We don't use Recall's own transcription (an extra $0.15/hour): local Whisper transcribes the
audio. For example, 50 recorded hours a month costs about **$25**.

## Setup (about 10 minutes)

1. Create a Recall.ai account and workspace. Note its region (for example `us-east-1`).
2. In the Recall dashboard, create an **API key**.
3. Optional, but recommended for live status: add a **webhook endpoint** in the Recall dashboard.
   - URL: `<PUBLIC_BASE_URL>/api/notetaker/webhook`. It must be reachable from the internet. For
     local testing, use a tunnel such as `cloudflared` or `ngrok`.
   - Subscribe to the bot status events (`bot.*`).
   - Copy the endpoint's **signing secret** (`whsec_...`).
4. Add these lines to `backend/.env` on the server, never in the frontend:
   ```
   RECALL_API_KEY=...
   RECALL_REGION=us-east-1
   RECALL_WEBHOOK_SECRET=whsec_...
   ```
5. Restart the backend. **Settings → Meeting notetaker** should no longer say "Not set up".

Without `RECALL_WEBHOOK_SECRET`, the webhook refuses every request. The server still follows each bot
by polling Recall every 20 seconds while a bot is active, so status updates arrive a little later.

## Using it

- **Calendar entries with a Zoom, Teams, or Meet link** show the platform logo. They also have a
  **Send notetaker** switch in the details popover and in the "Happening now" banner.
- **Consent:** turning the switch on asks you to confirm "Everyone in this meeting knows it is being
  recorded." The bot is not sent until you check the box.
- **Future calls:** the bot is scheduled to join at the start time.
- **Live status:** Notetaker scheduled → Joining → Waiting to be admitted → (Waiting for permission
  to record) → Recording → Processing → Ready for review.
  - Each status is shown with an icon and text, and status changes are announced to screen readers.
  - While a bot is recording, a "Notetaker recording" pill stays in the top bar on every page.
- **Stop recording:** turning the switch off removes the bot. Anything already recorded is still
  turned into minutes for review. A bot stopped before it recorded anything just leaves.
- **Errors are explained in words.** Examples: "The host didn't admit the notetaker from the waiting
  room." or "Only signed-in users can join this meeting." If processing fails after recording,
  **Retry processing** runs it again.
- **Speaker names:** names from Recall's speaker timeline label the transcript, including guests who
  weren't on the invite. If no timeline is available, the normal speaker identification runs.
- **Automatic sending:** Settings → Meeting notetaker → "Send the notetaker to synced meetings
  automatically". Turning it on asks for the same consent.
  - It applies to calendar entries synced from Google Calendar or Outlook that have a Zoom, Teams,
    or Meet link. A bot is sent 10 minutes before the start and joins at the start time.
  - A calendar entry that already had a notetaker, including one you stopped, is never sent another
    automatically.
- **Retention:** the "Keep raw meeting audio" setting also deletes Recall's stored copy of the
  recording, either after approval or after 30 days. The minutes are never deleted.

## How it works (for developers)

| Piece | File |
|---|---|
| Recall HTTP client: 15 s timeout, 3 attempts on 429/5xx, circuit breaker | `backend/src/services/meetingBot/recallClient.ts` |
| Webhook signature check, status mapping, error messages, speaker timeline | `backend/src/services/meetingBot/recallEvents.ts` |
| Send / stop / events / processing, plus idempotency rules | `backend/src/services/meetingBot/meetingBotService.ts` |
| Automatic sending and retention | `backend/src/services/meetingBot/botAutomation.ts` |
| Simulated bot (demo mode and tests) | `backend/src/services/meetingBot/demoBotClient.ts` |
| HTTP routes (`/api/notetaker/*`) and the signed webhook | `backend/src/routes/notetaker.ts` |
| Page: switch, status, consent, polling, pill | `backend/public/js/notetaker/*.js`, `backend/public/styles/notetaker.css` |

Sessions are stored in `backend/data/bot-sessions.json`. After a restart, polling picks up every
unfinished bot, including one that was being processed.

**Failure handling:**

- A bot creation that Recall refuses is saved as a failed session with the reason. You can send
  again by hand.
- Webhook replays and out-of-order events never move a bot backwards or out of a final state.
- If downloading the recording fails, the session is marked failed and can be retried.
- If the speaker timeline is missing, processing continues without names.

**Not handled yet:**

- Per-person visibility of recordings: the app has no user accounts yet.
- Live transcription during the call.
- Showing failed notetaker sessions in the dashboard table. They appear on the calendar and in the
  banner.

**Check against a real Recall key before relying on it** (written from Recall's docs, not yet run
against the live API):

- the `recording_config.audio_mixed_mp3` option;
- the `participant_events.data.speaker_timeline_download_url` field;
- the `POST /bot/{id}/delete_media/` endpoint.

The parser falls back to the mixed video file when there is no audio-only file.

## Demo

Run `npm run dev:demo` (or `--demo-providers`) to use a simulated notetaker. It joins in 3 s, waits
in the waiting room for 3 s, then records until it's stopped (at most 2 minutes). No Recall account
is needed.

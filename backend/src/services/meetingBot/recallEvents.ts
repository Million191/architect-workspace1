import { createHmac, timingSafeEqual } from 'crypto';
import { BotStatus, SpeakerTurn } from './types';

/**
 * Recall.ai webhooks and artifacts: signature check, status mapping, readable errors, and the
 * speaker timeline. Pure functions — no I/O — so every case is unit-tested.
 */

const TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Recall webhook (Svix / Standard Webhooks signing: HMAC-SHA256 over
 * "<id>.<timestamp>.<raw body>" with the base64 secret after "whsec_"). Accepts both the svix-* and
 * webhook-* header names. Rejects stale timestamps (> 5 minutes) to stop replays of old requests.
 */
export function verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, secret: string, nowMs = Date.now()): boolean {
  const h = (name: string) => { const v = headers[`svix-${name}`] ?? headers[`webhook-${name}`]; return Array.isArray(v) ? v[0] : v; };
  const id = h('id'), timestamp = h('timestamp'), signatures = h('signature');
  if (!id || !timestamp || !signatures || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  return signatures.split(' ').some((entry) => {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** A bot status event, whichever of Recall's payload shapes it came in. */
export interface BotEvent {
  providerBotId: string;
  sessionId?: string;
  code: string;
  subCode?: string;
}

/** Reads `bot.<code>` events (current shape) and `bot.status_change` (older shape). Other events → null. */
export function parseWebhookEvent(body: unknown): BotEvent | null {
  const b = (body ?? {}) as { event?: unknown; data?: Record<string, unknown> };
  if (typeof b.event !== 'string' || !b.data || typeof b.data !== 'object') return null;
  if (b.event === 'bot.status_change') {
    const status = (b.data.status ?? {}) as { code?: unknown; sub_code?: unknown };
    const botId = b.data.bot_id;
    if (typeof botId !== 'string' || typeof status.code !== 'string') return null;
    return { providerBotId: botId, code: status.code, subCode: typeof status.sub_code === 'string' ? status.sub_code : undefined };
  }
  if (!b.event.startsWith('bot.')) return null;
  const inner = (b.data.data ?? {}) as { code?: unknown; sub_code?: unknown };
  const bot = (b.data.bot ?? {}) as { id?: unknown; metadata?: { session_id?: unknown } };
  if (typeof bot.id !== 'string') return null;
  return {
    providerBotId: bot.id,
    sessionId: typeof bot.metadata?.session_id === 'string' ? bot.metadata.session_id : undefined,
    code: typeof inner.code === 'string' ? inner.code : b.event.slice(4),
    subCode: typeof inner.sub_code === 'string' ? inner.sub_code : undefined,
  };
}

/** What a provider status code means for us. 'call_ended' / 'done' / 'fatal' need the session's context. */
export type CodeMeaning = BotStatus | 'call_ended' | 'done' | 'fatal' | 'ignore';

export function meaningOf(code: string): CodeMeaning {
  switch (code) {
    case 'ready': return 'scheduled';
    case 'joining_call': return 'joining';
    case 'in_waiting_room': return 'waiting_room';
    case 'in_call_not_recording':
    case 'recording_permission_allowed': return 'awaiting_permission';
    case 'in_call_recording': return 'recording';
    case 'recording_permission_denied': return 'fatal';
    case 'call_ended': return 'call_ended';
    case 'done': return 'done';
    case 'fatal': return 'fatal';
    default: return 'ignore';
  }
}

const MESSAGES: Record<string, string> = {
  bot_kicked_from_waiting_room: 'The host didn’t admit the notetaker from the waiting room.',
  timeout_exceeded_waiting_room: 'Nobody admitted the notetaker from the waiting room in time.',
  timeout_exceeded_noone_joined: 'Nobody joined the meeting, so the notetaker left.',
  timeout_exceeded_everyone_left: 'Everyone left before anything was recorded.',
  bot_kicked_from_call: 'Someone removed the notetaker from the meeting.',
  recording_permission_denied: 'The host didn’t allow the notetaker to record.',
  meeting_not_found: 'The meeting link doesn’t work. Check the link in the calendar invite.',
  meeting_link_invalid: 'The meeting link doesn’t work. Check the link in the calendar invite.',
  meeting_link_expired: 'The meeting link has expired.',
  meeting_requires_sign_in: 'Only signed-in users can join this meeting, so the notetaker can’t get in.',
  meeting_password_incorrect: 'The meeting password is wrong or missing from the link.',
  meeting_full: 'The meeting is full.',
  meeting_locked: 'The meeting is locked, so the notetaker can’t join.',
  call_ended_by_host: 'The host ended the meeting before anything was recorded.',
};

/** A sentence a person can act on, for a provider sub-code (never a raw code alone). */
export function errorMessageFor(subCode: string | undefined, fallback = 'The notetaker couldn’t join the meeting.'): string {
  if (subCode && MESSAGES[subCode]) return MESSAGES[subCode];
  return subCode ? `${fallback} (${subCode.replace(/_/g, ' ')})` : fallback;
}

interface RawTurn {
  participant?: { name?: unknown } | null;
  name?: unknown;
  start_timestamp?: { relative?: unknown } | null;
  end_timestamp?: { relative?: unknown } | null;
  timestamp?: unknown;
}

/**
 * Turns Recall's speaker timeline into speaker turns (ms from recording start). Understands entries
 * with start/end timestamps, and the older "speaker changed at <seconds>" list (each turn runs to the
 * next change). Unnamed or malformed entries are skipped — speaker names are a bonus, never required.
 */
export function parseSpeakerTimeline(raw: unknown): SpeakerTurn[] {
  if (!Array.isArray(raw)) return [];
  const sec = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : undefined);
  const entries = (raw as RawTurn[]).map((e) => {
    const name = typeof e?.participant?.name === 'string' ? e.participant.name : typeof e?.name === 'string' ? e.name : '';
    return { name: name.trim().slice(0, 200), start: sec(e?.start_timestamp?.relative) ?? sec(e?.timestamp), end: sec(e?.end_timestamp?.relative) };
  }).filter((e): e is { name: string; start: number; end: number | undefined } => !!e.name && e.start !== undefined)
    .sort((a, b) => a.start - b.start);
  return entries.map((e, i) => ({ name: e.name, startMs: e.start, endMs: e.end ?? entries[i + 1]?.start ?? e.start + 60 * 60 * 1000 }))
    .filter((t) => t.endMs > t.startMs);
}

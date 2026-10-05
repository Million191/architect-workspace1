import { createHmac } from 'crypto';
import { errorMessageFor, meaningOf, parseSpeakerTimeline, parseWebhookEvent, verifyWebhook } from './recallEvents';

const SECRET = 'whsec_' + Buffer.from('a-very-secret-signing-key-123456').toString('base64');
const NOW = Date.parse('2026-10-05T12:00:00Z');

function sign(body: string, opts: { id?: string; ts?: number; secret?: string; prefix?: 'svix' | 'webhook' } = {}) {
  const id = opts.id ?? 'msg_1', ts = String(opts.ts ?? NOW / 1000);
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  const p = opts.prefix ?? 'svix';
  return { [`${p}-id`]: id, [`${p}-timestamp`]: ts, [`${p}-signature`]: `v1,${sig}` } as Record<string, string>;
}

describe('verifyWebhook', () => {
  const body = JSON.stringify({ event: 'bot.done' });

  it('accepts a correctly signed request, with svix-* or webhook-* headers', () => {
    expect(verifyWebhook(Buffer.from(body), sign(body), SECRET, NOW)).toBe(true);
    expect(verifyWebhook(Buffer.from(body), sign(body, { prefix: 'webhook' }), SECRET, NOW)).toBe(true);
  });

  it('accepts when any one of several signatures matches (key rotation)', () => {
    const h = sign(body);
    h['svix-signature'] = `v1,${Buffer.alloc(32).toString('base64')} ${h['svix-signature']}`;
    expect(verifyWebhook(Buffer.from(body), h, SECRET, NOW)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, missing headers, a missing secret, and stale timestamps', () => {
    expect(verifyWebhook(Buffer.from(body + ' '), sign(body), SECRET, NOW)).toBe(false);
    expect(verifyWebhook(Buffer.from(body), sign(body, { secret: 'whsec_' + Buffer.from('other-key').toString('base64') }), SECRET, NOW)).toBe(false);
    expect(verifyWebhook(Buffer.from(body), {}, SECRET, NOW)).toBe(false);
    expect(verifyWebhook(Buffer.from(body), sign(body), '', NOW)).toBe(false);
    expect(verifyWebhook(Buffer.from(body), sign(body, { ts: NOW / 1000 - 301 }), SECRET, NOW)).toBe(false);
    expect(verifyWebhook(Buffer.from(body), sign(body, { ts: NOW / 1000 + 301 }), SECRET, NOW)).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('reads the current bot.<code> shape with our session id', () => {
    expect(parseWebhookEvent({ event: 'bot.in_waiting_room', data: { data: { code: 'in_waiting_room', sub_code: null }, bot: { id: 'b1', metadata: { session_id: 's1' } } } }))
      .toEqual({ providerBotId: 'b1', sessionId: 's1', code: 'in_waiting_room', subCode: undefined });
  });

  it('reads the older bot.status_change shape', () => {
    expect(parseWebhookEvent({ event: 'bot.status_change', data: { bot_id: 'b2', status: { code: 'call_ended', sub_code: 'bot_kicked_from_waiting_room' } } }))
      .toEqual({ providerBotId: 'b2', code: 'call_ended', subCode: 'bot_kicked_from_waiting_room' });
  });

  it('ignores other events and malformed bodies', () => {
    expect(parseWebhookEvent({ event: 'recording.done', data: {} })).toBeNull();
    expect(parseWebhookEvent({ event: 'bot.done', data: { bot: {} } })).toBeNull();
    expect(parseWebhookEvent(null)).toBeNull();
    expect(parseWebhookEvent('x')).toBeNull();
  });
});

describe('meaningOf / errorMessageFor', () => {
  it('maps Recall codes to our statuses', () => {
    expect(meaningOf('ready')).toBe('scheduled');
    expect(meaningOf('joining_call')).toBe('joining');
    expect(meaningOf('in_waiting_room')).toBe('waiting_room');
    expect(meaningOf('in_call_not_recording')).toBe('awaiting_permission');
    expect(meaningOf('in_call_recording')).toBe('recording');
    expect(meaningOf('call_ended')).toBe('call_ended');
    expect(meaningOf('done')).toBe('done');
    expect(meaningOf('fatal')).toBe('fatal');
    expect(meaningOf('recording_permission_denied')).toBe('fatal');
    expect(meaningOf('analysis_done')).toBe('ignore');
  });

  it('gives readable sentences, never a bare code', () => {
    expect(errorMessageFor('bot_kicked_from_waiting_room')).toBe('The host didn’t admit the notetaker from the waiting room.');
    expect(errorMessageFor('meeting_requires_sign_in')).toMatch(/signed-in users/);
    expect(errorMessageFor('weird_new_code')).toBe('The notetaker couldn’t join the meeting. (weird new code)');
    expect(errorMessageFor(undefined)).toBe('The notetaker couldn’t join the meeting.');
  });
});

describe('parseSpeakerTimeline', () => {
  it('reads turns with start and end timestamps', () => {
    expect(parseSpeakerTimeline([
      { participant: { name: 'Bob' }, start_timestamp: { relative: 8 }, end_timestamp: { relative: 17.5 } },
      { participant: { name: 'Alice' }, start_timestamp: { relative: 0 }, end_timestamp: { relative: 8 } },
    ])).toEqual([{ name: 'Alice', startMs: 0, endMs: 8000 }, { name: 'Bob', startMs: 8000, endMs: 17500 }]);
  });

  it('reads the older "speaker changed at" list; each turn runs to the next change', () => {
    const turns = parseSpeakerTimeline([{ name: 'Alice', timestamp: 0 }, { name: 'Bob', timestamp: 10 }]);
    expect(turns[0]).toEqual({ name: 'Alice', startMs: 0, endMs: 10000 });
    expect(turns[1].startMs).toBe(10000);
  });

  it('skips unnamed and malformed entries; non-arrays give nothing', () => {
    expect(parseSpeakerTimeline([{ participant: { name: '' }, start_timestamp: { relative: 1 } }, { participant: { name: 'X' }, start_timestamp: { relative: -1 } }, null])).toEqual([]);
    expect(parseSpeakerTimeline({})).toEqual([]);
  });
});

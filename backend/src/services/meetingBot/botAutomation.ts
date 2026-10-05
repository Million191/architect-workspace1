import { ScheduleService } from '../schedule/scheduleService';
import { platformOf } from '../calendarSync/meetingLinks';
import { RawAudioRetention } from '../recording/types';
import { MeetingBotService } from './meetingBotService';
import { BotSession, BotSettings } from './types';

const SETTINGS_KEY = 'notetaker';
/** Synced meetings get the notetaker this long before they start (it joins at the start time). */
export const AUTO_SEND_LEAD_MS = 10 * 60 * 1000;
const log = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ event, service: 'meeting-bot', ...fields }));

export function readBotSettings(settings: Map<string, string>): BotSettings {
  try {
    const raw = settings.get(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<BotSettings>) : {};
    return { autoSendToSynced: parsed.autoSendToSynced === true && !!parsed.autoConsent, autoConsent: parsed.autoConsent };
  } catch {
    return { autoSendToSynced: false };
  }
}

/** Turning automatic sending on records who confirmed participants will be told; turning it off clears that. */
export function writeBotSettings(settings: Map<string, string>, input: { autoSendToSynced: boolean; consent?: boolean; confirmedBy?: string }, now = new Date()): BotSettings {
  const next: BotSettings = input.autoSendToSynced
    ? { autoSendToSynced: true, autoConsent: { confirmedAt: now.toISOString(), confirmedBy: input.confirmedBy } }
    : { autoSendToSynced: false };
  settings.set(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Sends the notetaker to synced calendar meetings with a Zoom/Teams/Meet link that start within the
 * next 10 minutes (or are under way). A meeting that already had any notetaker — including one the
 * user stopped, or one that failed — is never sent another automatically, so this never loops.
 */
export async function autoSendDue(deps: { bots: MeetingBotService; schedule: ScheduleService; settings: Map<string, string>; now?: () => Date }): Promise<BotSession[]> {
  const cfg = readBotSettings(deps.settings);
  if (!cfg.autoSendToSynced || !deps.bots.configured()) return [];
  const t = (deps.now ?? (() => new Date()))().getTime();
  const due = deps.schedule.listRange(new Date(t - 24 * 3600 * 1000).toISOString(), new Date(t + AUTO_SEND_LEAD_MS).toISOString()).filter((m) =>
    m.external && m.status === 'scheduled' && !m.runId && m.start && m.end && platformOf(m.link) !== 'none' &&
    Date.parse(m.start) <= t + AUTO_SEND_LEAD_MS && Date.parse(m.end) > t && !deps.bots.latestFor(m.id));
  const sent: BotSession[] = [];
  for (const m of due) {
    try {
      sent.push(await deps.bots.send({ scheduledMeetingId: m.id, consent: true, confirmedBy: cfg.autoConsent?.confirmedBy, automatic: true }));
    } catch (error) {
      log('bot_auto_send_failed', { scheduled_meeting_id: m.id, error_class: (error as Error).name, outcome: 'failure' });
    }
  }
  return sent;
}

/**
 * Raw-audio retention for notetaker recordings: deletes Recall's stored copy (never the meeting or
 * its minutes) under the same setting as in-app recordings. A failed delete is retried next hour.
 */
export async function applyBotRetention(bots: MeetingBotService, policy: RawAudioRetention, isApproved: (runId: string) => boolean, now = new Date()): Promise<string[]> {
  const client = bots.client();
  if (policy === 'keep' || !client) return [];
  const cutoff = now.getTime() - 30 * 24 * 3600 * 1000;
  const cleaned: string[] = [];
  for (const s of bots.list()) {
    if (s.status !== 'ready' || !s.runId || !s.providerBotId || s.mediaDeletedAt) continue;
    const due = policy === 'after_approval' ? isApproved(s.runId) : Date.parse(s.createdAt) < cutoff;
    if (!due) continue;
    try {
      await client.deleteMedia(s.providerBotId);
      bots.save(s, { mediaDeletedAt: now.toISOString() });
      cleaned.push(s.id);
    } catch (error) {
      log('bot_media_delete_failed', { session_id: s.id, error_class: (error as Error).name, outcome: 'failure' });
    }
  }
  return cleaned;
}

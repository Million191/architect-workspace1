import { DraftedEmail } from '../emailDrafting/types';
import { EmailDeliveryClient, EmailMode } from '../meetingPipeline/types';
import { InvalidTransitionError } from './errors';
import { HistoryEntry, ScheduledMeeting, TimeRange } from './types';

export type NoticeKind = 'postponed' | 'cancelled';

export interface NoticeEmail {
  to: string;
  name?: string;
  subject: string;
  body: string;
}

export interface NoticeOutcome {
  /** 'sent' — every email went out; 'draft_only' — previewed, nothing sent by design; 'failed' — at least one failed. */
  outcome: 'sent' | 'draft_only' | 'failed';
  sentTo: string[];
  failedTo: string[];
  /** Plain, non-sensitive reason when something failed. */
  message?: string;
}

function formatRange(r: TimeRange | undefined, timeZone: string): string {
  if (!r || !r.start || !r.end) return 'a new date to be confirmed';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(new Date(r.start));
  const time = (iso: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
  return `${day}, ${time(r.start)} – ${time(r.end)}`;
}

/** The change this notice is about: the meeting's latest postponed/cancelled history entry. */
function latestChange(m: ScheduledMeeting, kind: NoticeKind): { entry: HistoryEntry; index: number } {
  for (let i = m.history.length - 1; i >= 0; i--) {
    if (m.history[i].action === kind) return { entry: m.history[i], index: i };
  }
  throw new InvalidTransitionError(`This meeting hasn’t been ${kind}, so there’s nothing to notify about.`, { id: m.id });
}

/** Deterministic notice text (no AI): same meeting + change → same emails, every time. */
export function buildNotices(m: ScheduledMeeting, kind: NoticeKind, timeZone: string): NoticeEmail[] {
  const { entry } = latestChange(m, kind);
  return m.participants.map((p) => {
    const greeting = `Hi ${p.name ?? 'there'},`;
    const reason = entry.reason ? [``, `Reason: ${entry.reason}`] : [];
    const lines = kind === 'postponed'
      ? [greeting, '', `“${m.title}” has been postponed.`, '', `Was: ${formatRange(entry.from, timeZone)}`, `Now: ${formatRange(entry.to, timeZone)}`, ...reason]
      : [greeting, '', `“${m.title}” has been cancelled.`, '', `It was scheduled for ${formatRange(entry.from ?? { start: m.start, end: m.end }, timeZone)}.`, ...reason];
    return { to: p.email, name: p.name, subject: `${kind === 'postponed' ? 'Postponed' : 'Cancelled'}: ${m.title}`, body: [...lines, '', 'Sent by Meeting Assistant'].join('\n') };
  });
}

export interface SendNoticesDeps {
  emailMode: EmailMode;
  deliver?: EmailDeliveryClient;
  /** Persisted record of notices already sent (key → sentAt), so a retry never re-sends. */
  sentLog: Map<string, string>;
  timeZone: string;
  timeoutMs?: number;
}

/**
 * Sends (or, in draft-only mode, only previews) a postponed/cancelled notice to each participant.
 * Each email is keyed by (meeting, change, recipient) and checked against the sent log first, so a
 * retry sends only what didn't go out. One attempt per email — a timed-out send may have gone out.
 */
export async function sendNotices(m: ScheduledMeeting, kind: NoticeKind, deps: SendNoticesDeps): Promise<NoticeOutcome> {
  const { index } = latestChange(m, kind);
  const notices = buildNotices(m, kind, deps.timeZone);
  if (deps.emailMode === 'draft-only' || !deps.deliver) return { outcome: 'draft_only', sentTo: [], failedTo: [] };
  const sentTo: string[] = [], failedTo: string[] = [];
  let message: string | undefined;
  for (const n of notices) {
    const key = `notify:${m.id}:${index}:${n.to}`;
    if (deps.sentLog.has(key)) { sentTo.push(n.to); continue; }
    const email: DraftedEmail = { participantName: n.name ?? n.to, subject: n.subject, body: n.body, actionItems: [] };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.deliver.send(email, { idempotencyKey: key, to: n.to }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The email service didn’t respond in time.')), deps.timeoutMs ?? 30_000); }),
      ]);
      deps.sentLog.set(key, new Date().toISOString());
      sentTo.push(n.to);
    } catch (error) {
      failedTo.push(n.to);
      message = error instanceof Error ? error.message : 'The email service failed.';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { outcome: failedTo.length ? 'failed' : 'sent', sentTo, failedTo, message };
}

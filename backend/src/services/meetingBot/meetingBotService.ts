import { randomUUID } from 'crypto';
import { MeetingPipeline } from '../meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../schedule/scheduleService';
import { platformOf } from '../calendarSync/meetingLinks';
import { errorMessageFor, meaningOf, parseSpeakerTimeline, BotEvent } from './recallEvents';
import { BOT_CHAT_MESSAGE, BOT_NAME, BotProviderClient, BotSession, BotStatus, FINAL_STATUSES, ProviderBotState, SpeakerTurn } from './types';

export class BotError extends Error {
  constructor(readonly errorClass: 'BotNotConfigured' | 'BotNotFound' | 'BotValidationError' | 'BotStateError', message: string) {
    super(message);
    this.name = errorClass;
  }
}

export interface MeetingBotDeps {
  store: Map<string, BotSession>;
  /** Undefined when RECALL_API_KEY isn't set: every send answers "not configured". */
  client?: BotProviderClient;
  pipeline: MeetingPipeline;
  schedule: ScheduleService;
  now?: () => Date;
  /** Largest recording accepted from the provider (default 1 GB). */
  maxAudioBytes?: number;
}

export interface SendInput {
  scheduledMeetingId: string;
  consent: boolean;
  confirmedBy?: string;
  automatic?: boolean;
}

const DEFAULT_MAX_AUDIO = 1024 * 1024 * 1024;
const PRE_PROCESSING: BotStatus[] = ['scheduled', 'joining', 'waiting_room', 'awaiting_permission', 'recording'];
const log = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ event, service: 'meeting-bot', ...fields }));

/**
 * The notetaker: sends a Recall.ai bot to a calendar meeting, follows its status (webhooks, with
 * polling as the fallback), and when the call ends runs the recording through the normal pipeline.
 *
 * Idempotency: one active bot per calendar meeting (sending again returns it); webhook replays and
 * out-of-order events never move a bot backwards or out of a final state; processing is guarded
 * in-process and the pipeline itself dedupes on the audio, so a re-run after a crash is harmless.
 */
export function createMeetingBotService(deps: MeetingBotDeps) {
  const now = deps.now ?? (() => new Date());
  const maxAudio = deps.maxAudioBytes ?? DEFAULT_MAX_AUDIO;
  const inFlight = new Set<string>();

  function get(id: string): BotSession {
    const s = deps.store.get(id);
    if (!s) throw new BotError('BotNotFound', 'That notetaker session doesn’t exist.');
    return s;
  }
  function save(s: BotSession, patch: Partial<BotSession>, code?: string): BotSession {
    const at = now().toISOString();
    const statusChanged = patch.status && patch.status !== s.status;
    const next: BotSession = { ...s, ...patch, updatedAt: at, history: statusChanged ? [...s.history, { at, status: patch.status as BotStatus, code }] : s.history };
    deps.store.set(next.id, next);
    if (statusChanged) log('bot_status_changed', { session_id: s.id, scheduled_meeting_id: s.scheduledMeetingId, from: s.status, to: next.status, code, outcome: next.status === 'failed' ? 'failure' : 'success' });
    return next;
  }
  const fail = (s: BotSession, code: string, message: string) => save(s, { status: 'failed', error: { code, message } }, code);
  const client = (): BotProviderClient => {
    if (!deps.client) throw new BotError('BotNotConfigured', 'The notetaker isn’t set up on this server. Add RECALL_API_KEY to the server’s environment.');
    return deps.client;
  };
  const isFinal = (s: BotSession) => FINAL_STATUSES.includes(s.status);
  const forMeeting = (meetingId: string) => [...deps.store.values()].filter((s) => s.scheduledMeetingId === meetingId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /** The finished call: download, read speaker names, and draft minutes. */
  async function processRecording(s: BotSession, state: ProviderBotState): Promise<BotSession> {
    if (!state.audioUrl) {
      return s.stopRequestedAt && !s.recordedAt ? save(s, { status: 'cancelled' }, 'stopped') : fail(s, 'NoRecording', 'The notetaker didn’t record any audio.');
    }
    const c = client();
    const audio = await c.download(state.audioUrl, maxAudio);
    let speakerTurns: SpeakerTurn[] = [];
    if (state.speakerTimelineUrl) {
      try { speakerTurns = parseSpeakerTimeline(JSON.parse((await c.download(state.speakerTimelineUrl, 20 * 1024 * 1024)).toString('utf8'))); }
      catch (error) { log('bot_speaker_timeline_unavailable', { session_id: s.id, error_class: (error as Error).name, outcome: 'partial' }); }
    }
    deps.schedule.assertCanLinkRecording(s.scheduledMeetingId);
    const ext = audio.subarray(0, 4).toString('ascii') === 'RIFF' ? 'wav' : 'mp3';
    const run = await deps.pipeline.draftMinutes({
      originalFilename: `notetaker-${s.id}.${ext}`,
      buffer: audio,
      source: 'room_mic',
      location: `${{ zoom: 'Zoom', teams: 'Microsoft Teams', meet: 'Google Meet', none: 'Online meeting' }[s.platform]} (recorded by ${BOT_NAME})`,
      attendeeNames: s.attendees.map((a) => a.name),
      attendeeEmails: Object.fromEntries(s.attendees.filter((a) => a.email).map((a) => [a.name, a.email as string])),
      meetingContext: { title: s.title },
      speakerTurns,
    });
    try { deps.schedule.linkRecording(s.scheduledMeetingId, run.runId); } catch (error) { log('bot_link_failed', { session_id: s.id, error_class: (error as Error).name, outcome: 'partial' }); }
    return save(get(s.id), { status: 'ready', runId: run.runId, error: undefined }, 'processed');
  }

  /** Runs processing once at a time per session; failures leave a readable error and can be retried. */
  async function finalize(id: string, known?: ProviderBotState): Promise<BotSession> {
    let s = get(id);
    if (s.status === 'ready' || inFlight.has(id) || !s.providerBotId) return s;
    inFlight.add(id);
    try {
      const state = known?.audioUrl ? known : await client().getBot(s.providerBotId);
      if (!state.audioUrl && !s.recordedAt) {
        return s.stopRequestedAt ? save(s, { status: 'cancelled' }, 'stopped') : fail(s, known?.subCode ?? state.subCode ?? 'left', errorMessageFor(known?.subCode ?? state.subCode, 'The notetaker left before recording anything.'));
      }
      s = save(s, { status: 'processing', error: undefined }, 'done');
      return await processRecording(s, state);
    } catch (error) {
      const e = error as Error & { errorClass?: string };
      log('bot_processing_failed', { session_id: id, error_class: e.errorClass ?? e.name, outcome: 'failure' });
      return fail(get(id), e.errorClass ?? e.name ?? 'ProcessingError', `The recording couldn’t be processed: ${e.message}`);
    } finally {
      inFlight.delete(id);
    }
  }

  /** Applies one provider status to a session. Never moves backwards, never leaves a final state. */
  async function apply(s: BotSession, code: string, subCode?: string, state?: ProviderBotState): Promise<BotSession> {
    if (isFinal(s)) return s;
    const meaning = meaningOf(code);
    if (meaning === 'ignore') return s;
    if (meaning === 'fatal') return fail(s, subCode ?? code, errorMessageFor(subCode ?? (code === 'recording_permission_denied' ? code : undefined)));
    if (meaning === 'done') return finalize(s.id, state);
    if (meaning === 'call_ended') {
      if (s.recordedAt || s.status === 'recording' || s.status === 'processing') return save(s, { status: 'processing' }, subCode ?? code);
      return s.stopRequestedAt ? save(s, { status: 'cancelled' }, 'stopped') : fail(s, subCode ?? code, errorMessageFor(subCode, 'The notetaker left before recording anything.'));
    }
    if (s.status === 'processing' || PRE_PROCESSING.indexOf(meaning) < PRE_PROCESSING.indexOf(s.status)) return s;
    if (meaning === s.status) return s;
    return save(s, { status: meaning, ...(meaning === 'recording' && !s.recordedAt ? { recordedAt: now().toISOString() } : {}) }, code);
  }

  return {
    configured: () => !!deps.client,
    providerName: () => deps.client?.name,
    get,
    list: (): BotSession[] => [...deps.store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    /** The newest session for a calendar meeting (any status). */
    latestFor: (meetingId: string): BotSession | undefined => forMeeting(meetingId)[0],

    async send(input: SendInput): Promise<BotSession> {
      const c = client();
      if (!input.consent) throw new BotError('BotValidationError', 'Confirm that everyone in this meeting knows it is being recorded.');
      const m = deps.schedule.get(input.scheduledMeetingId);
      const active = forMeeting(m.id).find((s) => !isFinal(s));
      if (active) return active;
      const platform = platformOf(m.link);
      if (!m.link || platform === 'none') throw new BotError('BotValidationError', 'The notetaker joins Zoom, Microsoft Teams and Google Meet meetings. Add the meeting link first.');
      if (m.status === 'cancelled') throw new BotError('BotStateError', 'This meeting was cancelled.');
      if (!m.start || !m.end) throw new BotError('BotStateError', 'Pick a date for this meeting before sending the notetaker.');
      if (m.runId) throw new BotError('BotStateError', 'A recording is already attached to this meeting.');
      const t = now().getTime();
      if (Date.parse(m.end) <= t) throw new BotError('BotStateError', 'This meeting has already ended.');
      const at = now().toISOString();
      const joinAt = Date.parse(m.start) > t + 60_000 ? new Date(Date.parse(m.start)).toISOString() : undefined;
      let s: BotSession = {
        id: randomUUID(), scheduledMeetingId: m.id, meetingUrl: m.link, platform, title: m.title,
        attendees: m.participants.map((p) => ({ name: p.name || p.email, email: p.email })),
        status: joinAt ? 'scheduled' : 'joining', joinAt,
        consent: { confirmedAt: at, confirmedBy: input.confirmedBy, automatic: !!input.automatic },
        history: [{ at, status: joinAt ? 'scheduled' : 'joining', code: input.automatic ? 'auto_sent' : 'sent' }], createdAt: at, updatedAt: at,
      };
      deps.store.set(s.id, s);
      try {
        const { providerBotId } = await c.createBot({ meetingUrl: m.link, botName: BOT_NAME, joinAt, chatMessage: BOT_CHAT_MESSAGE, sessionId: s.id });
        s = save(s, { providerBotId });
        log('bot_sent', { session_id: s.id, scheduled_meeting_id: m.id, platform, automatic: !!input.automatic, outcome: 'success' });
        return s;
      } catch (error) {
        const e = error as Error & { errorClass?: string };
        fail(s, e.errorClass ?? 'BotCreateFailed', e.message);
        throw error;
      }
    },

    /** "Stop recording": removes the bot. Anything already recorded is still processed. */
    async stop(id: string): Promise<BotSession> {
      const s = get(id);
      if (isFinal(s) || s.status === 'processing') return s;
      const c = client();
      const at = now().toISOString();
      if (!s.providerBotId) return save(s, { status: 'cancelled', stopRequestedAt: at }, 'stopped');
      if (s.status === 'scheduled') { await c.cancelScheduled(s.providerBotId); return save(get(id), { status: 'cancelled', stopRequestedAt: at }, 'stopped'); }
      await c.leaveCall(s.providerBotId);
      const fresh = get(id);
      return fresh.status === 'recording' ? save(fresh, { status: 'processing', stopRequestedAt: at }, 'stop_requested') : save(fresh, { status: 'cancelled', stopRequestedAt: at }, 'stopped');
    },

    /** A webhook event. Unknown bots are ignored (undefined) so Recall doesn't keep retrying them. */
    async handleEvent(evt: BotEvent): Promise<BotSession | undefined> {
      const s = (evt.sessionId && deps.store.get(evt.sessionId)) || [...deps.store.values()].find((x) => x.providerBotId === evt.providerBotId);
      if (!s || (s.providerBotId && s.providerBotId !== evt.providerBotId)) return undefined;
      return apply(s, evt.code, evt.subCode);
    },

    /** Polling fallback (and restart recovery): asks the provider about every unfinished bot. */
    async reconcile(): Promise<void> {
      if (!deps.client) return;
      for (const s of [...deps.store.values()]) {
        if (isFinal(s) || !s.providerBotId || inFlight.has(s.id)) continue;
        try {
          const state = await deps.client.getBot(s.providerBotId);
          await apply(get(s.id), state.code, state.subCode, state);
        } catch (error) {
          log('bot_reconcile_failed', { session_id: s.id, error_class: (error as Error).name, outcome: 'failure' });
        }
      }
    },

    /** Retries processing a failed recording (the provider keeps it until retention deletes it). */
    async retry(id: string): Promise<BotSession> {
      const s = get(id);
      if (s.status !== 'failed' || !s.recordedAt || !s.providerBotId) throw new BotError('BotStateError', 'Only a recorded meeting that failed to process can be retried.');
      return finalize(save(s, { status: 'processing', error: undefined }, 'retry').id);
    },

    hasActiveWork: () => [...deps.store.values()].some((s) => !isFinal(s)),
    isInFlight: (id: string) => inFlight.has(id),
    sessionsFor: forMeeting,
    client: () => deps.client,
    save,
  };
}

export type MeetingBotService = ReturnType<typeof createMeetingBotService>;

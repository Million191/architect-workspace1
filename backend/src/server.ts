import path from 'path';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createAudioIngestionRouter } from './routes/audioIngestion';
import { createPhysicalAudioIngestionRouter } from './routes/physicalAudioIngestion';
import { createMeetingPipelineRouter } from './routes/meetingPipeline';
import { createMeetingPipeline, createPipelineStores, MeetingPipeline } from './services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from './services/meetingPipeline/demoProviders';
import { createRealProviders, DEFAULT_DATA_DIR } from './services/meetingPipeline/providers/realProviders';
import { createScheduleRouter } from './routes/schedule';
import { createPeopleRouter } from './routes/people';
import { createSearchRouter } from './routes/search';
import { createSpellingRouter } from './routes/spelling';
import { applyRetention, createRecordingsRouter, DEFAULT_RETENTION } from './routes/recordings';
import { RawAudioRetention } from './services/recording/types';
import { createCalendarSyncRouter, photoRoute } from './routes/calendarSync';
import { createMinutesRouter } from './routes/minutes';
import { createActivityRouter } from './routes/activity';
import { createNotetakerRouter, notetakerWebhook } from './routes/notetaker';
import { createMeetingBotService, MeetingBotService } from './services/meetingBot/meetingBotService';
import { createRecallClient, recallConfigFromEnv } from './services/meetingBot/recallClient';
import { createDemoBotClient } from './services/meetingBot/demoBotClient';
import { applyBotRetention, autoSendDue } from './services/meetingBot/botAutomation';
import { BotSession } from './services/meetingBot/types';
import { createMinutesDocService, MinutesDocService } from './services/minutesDoc/minutesDocService';
import { MinutesDocument } from './services/minutesDoc/types';
import { claudeAssistant, demoAssistant, MinutesAssistant } from './services/minutesDoc/assistant';
import { createCalendarSyncService, CalendarSyncService } from './services/calendarSync/calendarSyncService';
import { oauthConfigFromEnv } from './services/calendarSync/providers';
import { FetchLike } from './services/calendarSync/http';
import { CalendarConnection } from './services/calendarSync/types';
import { createRecordingService, RecordingService } from './services/recording/recordingService';
import { RecordingStore } from './services/recording/recordingStore';
import { UploadProgressTracker } from './services/meetingPipeline/uploadProgress';
import os from 'os';
import { createSpellChecker, SpellChecker } from './services/spelling/spellChecker';
import { createTeamDictionary, TeamDictionary, TeamWord } from './services/spelling/teamDictionary';
import { createSearchService, SearchService } from './services/search/searchService';
import { createPeopleService, PeopleService } from './services/people/peopleService';
import { PersonRecord } from './services/people/types';
import { createScheduleService, ScheduleService } from './services/schedule/scheduleService';
import { JsonFileMap } from './services/meetingPipeline/jsonFileMap';
import { ScheduledMeeting } from './services/schedule/types';
import { EmailDeliveryClient, EmailMode } from './services/meetingPipeline/types';

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400 && 'body' in err;
}

export interface AppDeps {
  /** The meeting workflow. Left unset, the /api/meetings routes answer 503 rather than run with no providers. */
  meetingPipeline?: MeetingPipeline;
  /** Calendar of scheduled meetings. Left unset, /api/schedule answers 503. */
  schedule?: ScheduleService;
  /** People directory (names, photos, avatar colours). Left unset, /api/people answers 503. */
  people?: PeopleService;
  /** Search index; created fresh (and filled from the data on first search) when not given. */
  search?: SearchService;
  /** Spell checking (nspell + dictionary-en) and the team dictionary; in-memory defaults when not given. */
  spelling?: { checker?: SpellChecker; team?: TeamDictionary };
  /** Live recordings (chunked upload). Left unset, /api/recordings answers 503. */
  recordings?: RecordingService;
  /** Small server-side settings (raw-audio retention). A JsonFileMap in real mode. */
  settings?: Map<string, string>;
  /** Google / Outlook calendar sync. Left unset, /api/calendar answers 503. */
  calendar?: CalendarSyncService;
  /** Folder of attendee photos from Outlook, served at /api/people/photos/:file. */
  photoDir?: string;
  /** Editable minutes (sections, versions). Created in memory over the pipeline when not given. */
  minutes?: MinutesDocService;
  /** "AI help" in the minutes editor: Claude when ANTHROPIC_API_KEY is set, the demo stand-in in demo mode. */
  assistant?: MinutesAssistant;
  /** How participant notices go out: the same delivery client and mode as meeting emails. */
  email?: { mode: EmailMode; deliver?: EmailDeliveryClient; noticeLog?: Map<string, string> };
  /** Meeting notetaker (Recall.ai bot). Left unset, /api/notetaker answers 503. */
  bots?: MeetingBotService;
  /** RECALL_WEBHOOK_SECRET; without it the webhook refuses every request (polling still follows bots). */
  botWebhookSecret?: string;
  /** Told when a bot is sent or stopped, so status polling speeds up right away. */
  onBotActivity?: () => void;
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  // Signed with the exact raw bytes, so it must see the body before express.json() parses it.
  app.post('/api/notetaker/webhook', ...notetakerWebhook({ bots: deps.bots, secret: deps.botWebhookSecret }));
  app.use(express.json());

  // express.json() rejects malformed bodies with a bare SyntaxError; without this handler
  // it falls through to Express's default error page instead of our usual {error, message} shape.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (isJsonParseError(err)) {
      res.status(400).json({ error: 'ValidationError', message: 'Request body is not valid JSON.' });
      return;
    }
    next(err);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/audio', createAudioIngestionRouter());
  app.use('/api/audio', createPhysicalAudioIngestionRouter());
  const progress = new UploadProgressTracker();
  app.use('/api/meetings', createMeetingPipelineRouter({ pipeline: deps.meetingPipeline, schedule: deps.schedule, progress, failedRecordings: deps.recordings ? () => deps.recordings!.listFailed() : undefined }));
  app.use('/api/recordings', createRecordingsRouter({ recordings: deps.recordings, pipeline: deps.meetingPipeline, schedule: deps.schedule, progress, settings: deps.settings ?? new Map() }));
  app.use('/api/notetaker', createNotetakerRouter({ bots: deps.bots, settings: deps.settings ?? new Map(), onActivity: deps.onBotActivity }));
  app.use('/api/schedule', createScheduleRouter({
    schedule: deps.schedule,
    pipeline: deps.meetingPipeline,
    emailMode: deps.email?.mode ?? 'draft-only',
    deliver: deps.email?.deliver,
    noticeLog: deps.email?.noticeLog ?? new Map(),
  }));

  const minutes = deps.minutes ?? (deps.meetingPipeline ? createMinutesDocService({ store: new Map<string, MinutesDocument>(), pipeline: deps.meetingPipeline }) : undefined);
  app.use('/api/activity', createActivityRouter({ pipeline: deps.meetingPipeline, minutes, recordings: deps.recordings }));
  app.use('/api/minutes', createMinutesRouter({ minutes, pipeline: deps.meetingPipeline, assistant: deps.assistant }));
  // The rich-text editor (Quill, BSD-3) served from the installed package — no bundler, no CDN.
  app.use('/vendor/quill', express.static(path.join(__dirname, '..', 'node_modules', 'quill', 'dist'), { index: false }));
  app.get('/api/people/photos/:file', photoRoute(deps.photoDir));
  app.use('/api/calendar', createCalendarSyncRouter({ calendar: deps.calendar }));
  app.use('/api/people', createPeopleRouter({ people: deps.people, pipeline: deps.meetingPipeline, schedule: deps.schedule }));

  app.use('/api/search', createSearchRouter({ search: deps.search ?? createSearchService(), pipeline: deps.meetingPipeline, schedule: deps.schedule, people: deps.people }));

  app.use('/api/spellcheck', createSpellingRouter({
    checker: deps.spelling?.checker ?? createSpellChecker(),
    team: deps.spelling?.team ?? createTeamDictionary(new Map<string, TeamWord>()),
    pipeline: deps.meetingPipeline, schedule: deps.schedule, people: deps.people,
  }));

  // The single review page (upload → draft minutes → approve → emails → approve & send).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  // Real providers by default. Sample data only with the explicit --demo-providers flag (npm run dev:demo).
  const useDemo = process.argv.includes('--demo-providers');
  const providers = useDemo ? createDemoProviders() : createRealProviders();
  // Real mode keeps its sent-email log, tracker log, and attendee addresses in backend/data so duplicate protection survives restarts.
  const stores = useDemo ? createPipelineStores() : createPipelineStores({ dataDir: process.env.MEETING_DATA_DIR ?? DEFAULT_DATA_DIR });
  const dataDir = process.env.MEETING_DATA_DIR ?? DEFAULT_DATA_DIR;
  const scheduleStore = useDemo ? new Map<string, ScheduledMeeting>() : new JsonFileMap<ScheduledMeeting>(path.join(dataDir, 'schedule.json'));
  const meetingPipeline = createMeetingPipeline(providers, stores);
  const recordings = createRecordingService({ store: new RecordingStore(useDemo ? path.join(os.tmpdir(), 'meeting-assistant-demo-recordings') : path.join(dataDir, 'recordings')) });
  const settings = useDemo ? new Map<string, string>() : new JsonFileMap<string>(path.join(dataDir, 'settings.json'));
  const schedule = createScheduleService({ store: scheduleStore });
  const people = createPeopleService({ store: useDemo ? new Map<string, PersonRecord>() : new JsonFileMap<PersonRecord>(path.join(dataDir, 'people.json')) });
  const photoDir = useDemo ? path.join(os.tmpdir(), 'meeting-assistant-demo-photos') : path.join(dataDir, 'photos');
  const calendar = createCalendarSyncService({
    store: useDemo ? new Map<string, CalendarConnection>() : new JsonFileMap<CalendarConnection>(path.join(dataDir, 'calendar-connections.json')),
    config: oauthConfigFromEnv(), encryptionKey: process.env.TOKEN_ENCRYPTION_KEY, fetchImpl: fetch as unknown as FetchLike, schedule, people, photoDir,
  });
  // Notetaker: Recall.ai when RECALL_API_KEY is set, a simulated bot in demo mode, otherwise off.
  const recall = recallConfigFromEnv();
  const bots = createMeetingBotService({
    store: useDemo ? new Map<string, BotSession>() : new JsonFileMap<BotSession>(path.join(dataDir, 'bot-sessions.json')),
    client: useDemo ? createDemoBotClient() : recall ? createRecallClient(recall) : undefined,
    pipeline: meetingPipeline, schedule,
  });
  // Bot status: webhooks first; this poll is the fallback (and recovers bots after a restart).
  // Every 2 s (demo) / 20 s (real) while a bot is active, nothing otherwise.
  const pollEveryMs = useDemo ? 2000 : 20000;
  let polling = false, lastPoll = 0;
  const pollBots = async () => {
    if (polling || !bots.hasActiveWork() || Date.now() - lastPoll < pollEveryMs) return;
    polling = true; lastPoll = Date.now();
    try { await bots.reconcile(); } finally { polling = false; }
  };
  setInterval(() => { void pollBots(); }, 1000).unref();
  const autoSend = () => autoSendDue({ bots, schedule, settings }).catch((error) => console.error(JSON.stringify({ event: 'bot_auto_send_failed', error_class: (error as Error).name, outcome: 'failure' })));
  setInterval(autoSend, 60 * 1000).unref();
  void autoSend();
  const app = createApp({
    bots,
    botWebhookSecret: process.env.RECALL_WEBHOOK_SECRET?.trim() || undefined,
    onBotActivity: () => { lastPoll = 0; void autoSend(); },
    meetingPipeline,
    schedule,
    calendar,
    photoDir,
    assistant: useDemo ? demoAssistant() : process.env.ANTHROPIC_API_KEY ? claudeAssistant() : undefined,
    minutes: createMinutesDocService({ store: useDemo ? new Map<string, MinutesDocument>() : new JsonFileMap<MinutesDocument>(path.join(dataDir, 'minutes-docs.json')), pipeline: meetingPipeline }),
    recordings,
    settings,
    spelling: { team: createTeamDictionary(useDemo ? new Map<string, TeamWord>() : new JsonFileMap<TeamWord>(path.join(dataDir, 'team-dictionary.json'))) },
    people,
    email: {
      mode: providers.emailMode ?? 'send',
      deliver: providers.emailDeliveryClient,
      noticeLog: useDemo ? new Map() : new JsonFileMap<string>(path.join(dataDir, 'schedule-notices.json')),
    },
  });
  const server = app.listen(port, () => {
    console.log(
      JSON.stringify({
        event: 'server_started',
        port,
        providerMode: providers.mode,
        providers: providers.description,
        notConfigured: providers.readiness,
        outcome: 'success',
      })
    );
  });
  // Local Whisper on a long recording can take many minutes inside one upload request; Node's
  // default 5-minute request timeout would cut it off. 45 minutes covers the 30-minute Whisper cap.
  server.requestTimeout = 45 * 60 * 1000;
  // Raw-audio retention: at startup, then hourly. Deletes audio only (never the meeting), idempotently.
  const runRetention = () => {
    try {
      const cleaned = applyRetention({ recordings, pipeline: meetingPipeline, settings });
      if (cleaned.length) console.log(JSON.stringify({ event: 'raw_audio_deleted', count: cleaned.length, outcome: 'success' }));
      const policy = (settings.get('rawAudioRetention') as RawAudioRetention | undefined) ?? DEFAULT_RETENTION;
      const approved = (runId: string) => { try { const st = meetingPipeline.getRun(runId).stage; return st === 'sent' || st === 'approved_not_sent'; } catch { return false; } };
      applyBotRetention(bots, policy, approved).then((ids) => { if (ids.length) console.log(JSON.stringify({ event: 'bot_media_deleted', count: ids.length, outcome: 'success' })); })
        .catch((error) => console.error(JSON.stringify({ event: 'bot_media_retention_failed', error_class: (error as Error).name, outcome: 'failure' })));
    } catch (error) {
      console.error(JSON.stringify({ event: 'raw_audio_retention_failed', error_class: error instanceof Error ? error.name : 'UnknownError', outcome: 'failure' }));
    }
  };
  runRetention();
  setInterval(runRetention, 60 * 60 * 1000).unref();
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(JSON.stringify({ event: 'server_start_failed', port, error_class: error.code ?? 'ServerError', outcome: 'failure', message: error.message }));
    process.exit(1);
  });
}

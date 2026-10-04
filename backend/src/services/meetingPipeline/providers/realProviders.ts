import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { MeetingPipelineProviders } from '../types';
import { ProviderNotConfiguredError } from '../errors';
import { createWhisperClients } from './whisperTranscriptionClient';
import { CLAUDE_ANALYSIS_MODEL, createClaudeAnalysisClients } from './claudeAnalysisClient';
import { createSmtpEmailClient, readSmtpConfig, SmtpEnv } from './smtpEmailClient';
import { createJsonActionItemTracker } from './jsonActionItemTracker';

const DEFAULT_WHISPER_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'meeting-assistant');
/** backend/data — runtime records (sent-email log, action items, attendee addresses). Gitignored. */
export const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data');
const WHISPER_TIMEOUT_MS = 30 * 60 * 1000;
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

export interface RealProviderEnv extends SmtpEnv {
  ANTHROPIC_API_KEY?: string;
  WHISPER_PROJECT_DIR?: string;
  MEETING_DATA_DIR?: string;
  /** "smtp" turns real sending on (needs every SMTP_* variable). Anything else, or unset, is draft-only. */
  EMAIL_MODE?: string;
}

/** Startup checks for local Whisper: uv on PATH, the script, and its virtual environment. Returns problems, never throws. */
function checkWhisper(projectDir: string): string[] {
  const problems: string[] = [];
  const uv = spawnSync('uv', ['--version'], { windowsHide: true, timeout: 10_000 });
  if (uv.error || uv.status !== 0) problems.push('Transcription: the "uv" command was not found on PATH (needed to run local Whisper).');
  if (!existsSync(path.join(projectDir, 'whisper_transcribe.py'))) problems.push(`Transcription: ${path.join(projectDir, 'whisper_transcribe.py')} is missing.`);
  if (!existsSync(path.join(projectDir, '.venv'))) problems.push(`Transcription: no Python environment at ${path.join(projectDir, '.venv')} — run "uv sync" in meeting-assistant.`);
  return problems;
}

/**
 * Real-mode providers. Every missing piece is reported by name in `readiness`; the pipeline refuses
 * that phase with a configuration error instead of running it. There is no sample-data path here.
 * Email is draft-only unless EMAIL_MODE=smtp: the final approval is recorded and action items are
 * tracked, but nothing is sent and no SMTP credentials are needed. With EMAIL_MODE=smtp, every SMTP
 * variable is required and the final approval answers with the exact missing names until they are set.
 */
export function createRealProviders(env: RealProviderEnv = process.env): MeetingPipelineProviders {
  const whisperDir = env.WHISPER_PROJECT_DIR ?? DEFAULT_WHISPER_DIR;
  const draftProblems = checkWhisper(whisperDir);
  if (!env.ANTHROPIC_API_KEY) draftProblems.push('Analysis: set ANTHROPIC_API_KEY so Claude can write the summary, decisions, and action items.');

  const dataDir = env.MEETING_DATA_DIR ?? DEFAULT_DATA_DIR;
  const sendingEnabled = env.EMAIL_MODE?.trim().toLowerCase() === 'smtp';
  const smtp = sendingEnabled ? readSmtpConfig(env) : { config: undefined, problems: [] as string[] };
  const sendProblems = smtp.problems;
  const notConfigured = (problems: string[]) => async (): Promise<never> => {
    throw new ProviderNotConfiguredError(problems);
  };

  const whisper = createWhisperClients({ projectDir: whisperDir, timeoutMs: WHISPER_TIMEOUT_MS });
  const claude = env.ANTHROPIC_API_KEY ? createClaudeAnalysisClients({ timeoutMs: CLAUDE_TIMEOUT_MS }) : undefined;
  const missingClaude = notConfigured(['Analysis: ANTHROPIC_API_KEY is not set.']);

  return {
    mode: 'live',
    emailMode: sendingEnabled ? 'send' : 'draft-only',
    description: {
      transcription: 'Local Whisper (no speaker separation)',
      analysis: `Claude (${CLAUDE_ANALYSIS_MODEL})`,
      email: !sendingEnabled
        ? 'Email sending disabled — draft only'
        : smtp.config
        ? `SMTP ${smtp.config.host}:${smtp.config.port} from ${smtp.config.from}${smtp.config.allowedRecipients ? ` (only to: ${smtp.config.allowedRecipients.join(', ')})` : ''}`
        : 'SMTP not configured',
      tracker: `JSON file ${path.join(dataDir, 'action-items.json')}`,
    },
    readiness: { draft: draftProblems, send: sendProblems },
    requiresRecipientAddresses: sendingEnabled,
    checkRecipients: (addresses) => {
      const allowed = smtp.config?.allowedRecipients;
      if (!allowed) return [];
      const blocked = addresses.filter((a) => !allowed.includes(a.toLowerCase()));
      return blocked.length > 0 ? [`Not in SMTP_ALLOWED_RECIPIENTS, so nothing was sent: ${blocked.join(', ')}.`] : [];
    },
    stageOptions: {
      // One attempt: a timed-out local run is not worth repeating automatically, and Whisper output is cached per recording.
      transcription: { timeoutMs: WHISPER_TIMEOUT_MS + 60_000, maxAttempts: 1 },
      diarization: { timeoutMs: 60_000, maxAttempts: 1 },
      // The SDK already retries transient API failures; the service-level retry would re-await the same memoized call.
      analysis: { timeoutMs: CLAUDE_TIMEOUT_MS * 3 + 60_000, maxAttempts: 1 },
    },
    ...whisper,
    topicSummarizationClient: claude?.topicSummarizationClient ?? { summarizeTopics: missingClaude },
    decisionExtractionClient: claude?.decisionExtractionClient ?? { extractDecisions: missingClaude },
    actionItemExtractionClient: claude?.actionItemExtractionClient ?? { extractActionItems: missingClaude },
    emailDeliveryClient: smtp.config
      ? createSmtpEmailClient(smtp.config)
      : // Never called in draft-only mode; fails loudly if that ever changes, rather than pretending to send.
        { send: notConfigured(sendingEnabled ? sendProblems : ['Email sending is disabled (draft-only mode).']) },
    actionItemTrackerClient: createJsonActionItemTracker(path.join(dataDir, 'action-items.json')),
  };
}

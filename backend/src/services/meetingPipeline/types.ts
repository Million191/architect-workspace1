import { IngestedAudio, PhysicalAudioSource } from '../audioIngestion/types';
import { Transcript, TranscriptionClient } from '../transcription/types';
import { DiarizationClient, DiarizedSegment, NameMappingClient, SpeakerMapping } from '../diarization/types';
import { MarkedTranscript } from '../segmentMarking/types';
import { MeetingContext, MeetingSummary } from '../meetingSummary/types';
import { DiscussionSummary, TopicSummarizationClient } from '../discussionSummary/types';
import { DecisionExtractionClient, DecisionListing } from '../decisionExtraction/types';
import { ActionItemExtractionClient, ActionItemTable } from '../actionItemExtraction/types';
import { DraftMinutes, ReviewGateSession } from '../reviewGate/types';
import { DraftedEmail, EmailDraftBatch } from '../emailDrafting/types';
import { SendingReviewGateSession } from '../reviewGateSending/types';
import { ActionItemTrackerClient, TrackedActionItem, TrackerLogResult } from '../actionItemTracker/types';

/**
 * Sends one already-approved email. No implementation exists yet beyond the demo outbox — wiring a
 * real mail provider (and a source for participant email addresses, which no attendee record in
 * this codebase carries) is an external-dependency decision, the same boundary every other
 * provider seam here draws. `idempotencyKey` is stable per (run, participant) so a real provider
 * can dedupe on its side too.
 */
export interface EmailDeliveryClient {
  send(email: DraftedEmail, meta: { idempotencyKey: string; to?: string }): Promise<void>;
}

export interface StageCallOptions {
  timeoutMs?: number;
  maxAttempts?: number;
}

/** What each part of the workflow is wired to, for the page's status line and the startup log. */
export interface ProviderDescription {
  transcription: string;
  analysis: string;
  email: string;
  tracker: string;
}

/** Every outside provider the pipeline calls. `mode` is surfaced to the UI so demo output is never mistaken for real minutes. */
export interface MeetingPipelineProviders {
  mode: 'demo' | 'live';
  /** Defaults to 'send'. Real mode uses 'draft-only' unless EMAIL_MODE=smtp is set with full SMTP settings. */
  emailMode?: EmailMode;
  description?: ProviderDescription;
  /**
   * Why a phase cannot run (missing key, missing tool). A non-empty list makes that phase refuse
   * with `ProviderNotConfiguredError` before doing anything — there is never a fallback to sample data.
   */
  readiness?: { draft: string[]; send: string[] };
  /** True when every recipient needs a real address before anything is sent (real SMTP); demo mode never sends. */
  requiresRecipientAddresses?: boolean;
  /** Extra recipient checks (e.g. the SMTP_ALLOWED_RECIPIENTS safety list). Returns problems; empty means OK. */
  checkRecipients?: (addresses: string[]) => string[];
  /** Real providers need far longer than the wrapped services' 30s defaults (local Whisper on CPU, LLM calls). */
  stageOptions?: { transcription?: StageCallOptions; diarization?: StageCallOptions; analysis?: StageCallOptions };
  transcriptionClient: TranscriptionClient;
  diarizationClient: DiarizationClient;
  nameMappingClient: NameMappingClient;
  topicSummarizationClient: TopicSummarizationClient;
  decisionExtractionClient: DecisionExtractionClient;
  actionItemExtractionClient: ActionItemExtractionClient;
  emailDeliveryClient: EmailDeliveryClient;
  actionItemTrackerClient: ActionItemTrackerClient;
}

/**
 * Every idempotency/session store the pipeline's stages use, owned in one place so a pipeline
 * instance (or a test) is isolated from the services' module-level defaults.
 * TODO(pre-persistence): in-process only, same limitation every wrapped service already documents.
 */
export interface MeetingPipelineStores {
  audio: Map<string, IngestedAudio>;
  transcripts: Map<string, Transcript>;
  speakers: Map<string, SpeakerMapping>;
  marked: Map<string, MarkedTranscript>;
  summaries: Map<string, MeetingSummary>;
  discussions: Map<string, DiscussionSummary>;
  decisions: Map<string, DecisionListing>;
  actionItems: Map<string, ActionItemTable>;
  minutesGate: Map<string, ReviewGateSession>;
  emailGate: Map<string, SendingReviewGateSession>;
  /** `${runId}:${participantName}` -> sentAt. Checked before every send so a replay never re-sends. */
  sentEmails: Map<string, string>;
  /** runId -> what the final approval did (sent vs draft-only). */
  finalApprovals: Map<string, FinalApprovalRecord>;
  /** runId -> { participantName: email address }, from the attendee entries typed at upload. */
  recipients: Map<string, Record<string, string>>;
  tracker: Map<string, TrackerLogResult>;
}

export interface DraftMinutesInput {
  originalFilename: string;
  buffer: Buffer;
  source: PhysicalAudioSource;
  location?: string;
  attendeeNames: string[];
  /** participantName -> address, for attendees entered as "Name <email>". */
  attendeeEmails?: Record<string, string>;
  /** Called with each stage name as it starts — used only to show real progress on the page. */
  onProgress?: (stage: string) => void;
  meetingContext?: MeetingContext;
  /**
   * Who was speaking when, from a meeting bot (Recall.ai). When given, these names label the
   * transcript instead of the diarization provider's guesses.
   */
  speakerTurns?: Array<{ startMs: number; endMs: number; name: string }>;
}

/**
 * Where a run is. Each stage only advances on an explicit human approval:
 * minutes_pending_approval --approve--> emails_pending_approval --approve--> sent.
 */
export type PipelineStage = 'minutes_pending_approval' | 'emails_pending_approval' | 'sent' | 'approved_not_sent';

/**
 * `send` — the final approval delivers each email. `draft-only` — the final approval is recorded
 * and action items are tracked, but no email is ever handed to a delivery client.
 */
export type EmailMode = 'send' | 'draft-only';

/** What the final (Gate #2) approval did for a run, persisted so the outcome survives restarts. */
export interface FinalApprovalRecord {
  approvedAt: string;
  approvedBy: string;
  emailMode: EmailMode;
  /** Exactly the emails that were approved (and, in draft-only mode, would have been sent) — kept so they stay reviewable after a restart. */
  emails?: EmailDraftBatch;
  /** The recipient addresses as they were at approval time. */
  recipients?: Record<string, string>;
  /** The approved minutes and the transcript they came from — with `emails`, the complete meeting record, reloadable after a restart without re-uploading. */
  minutes?: DraftMinutes;
  transcript?: DiarizedSegment[];
}

/** Everything the review page needs for one run, keyed by `runId` (== transcriptId == both gate session ids). */
export interface PipelineRunView {
  runId: string;
  stage: PipelineStage;
  providerMode: MeetingPipelineProviders['mode'];
  emailMode: EmailMode;
  providers?: ProviderDescription;
  finalApproval?: FinalApprovalRecord;
  transcript: DiarizedSegment[];
  minutes: DraftMinutes;
  emails?: EmailDraftBatch;
  recipients?: Record<string, string>;
  sentTo?: Array<{ participantName: string; sentAt: string }>;
  trackedActionItems?: TrackedActionItem[];
}

/** What the page shows on load: which providers are wired, and what is missing for each phase. */
export interface PipelineStatus {
  providerMode: MeetingPipelineProviders['mode'];
  emailMode: EmailMode;
  providers?: ProviderDescription;
  readiness: { draft: string[]; send: string[] };
}

import { approve as approveMinutesGate } from '../reviewGate/reviewGateService';
import { draftEmails } from '../emailDrafting/emailDraftingService';
import {
  approve as approveEmailGate,
  assertApprovedForSending,
  submitForReview as submitEmailsForReview,
} from '../reviewGateSending/reviewGateSendingService';
import { logActionItems } from '../actionItemTracker/actionItemTrackerService';
import { withTimeoutAndRetry } from '../audioIngestion/withTimeoutAndRetry';
import { draftMinutesFromAudio } from './draftMinutes';
import path from 'path';
import { ProviderNotConfiguredError, RecipientProblemError, RunNotFoundError, StageOrderError } from './errors';
import { JsonFileMap } from './jsonFileMap';
import { ActionItemListItem, listMeetings, listTrackedActionItems, MeetingListItem } from './meetingQueries';
import { amendApprovedMinutes, correctTranscript, replaceDraft, sendUpdatedMinutes, UpdatedMinutesResult } from './minutesAmendments';
import { DraftMinutes } from '../reviewGate/types';
import { DiarizedSegment } from '../diarization/types';
import { MinutesEdits, reviseMinutes } from './minutesEditing';
import { runStage } from './runStage';
import { DraftMinutesInput, MeetingPipelineProviders, MeetingPipelineStores, PipelineRunView, PipelineStatus } from './types';

const EMAIL_SEND_TIMEOUT_MS = 30_000;

/**
 * In-memory stores by default. With `dataDir`, the side-effect records — emails already sent,
 * action items already recorded, attendee addresses — and the drafts under review (minutes,
 * transcripts, email drafts) are mirrored to JSON files there, so the duplicate-send guard holds
 * and no draft is lost across a server restart.
 */
export function createPipelineStores(options: { dataDir?: string } = {}): MeetingPipelineStores {
  const persisted = <V>(name: string): Map<string, V> =>
    options.dataDir ? new JsonFileMap<V>(path.join(options.dataDir, name)) : new Map<string, V>();
  return {
    audio: new Map(),
    transcripts: new Map(),
    // Drafts and their transcripts are saved too (approved by the user 2026-10-04), so a draft under
    // review survives a restart and keeps its version history. Raw audio is never written here.
    speakers: persisted('transcripts.json'),
    marked: new Map(),
    summaries: new Map(),
    discussions: new Map(),
    decisions: new Map(),
    actionItems: new Map(),
    minutesGate: persisted('minutes-drafts.json'),
    emailGate: persisted('email-drafts.json'),
    sentEmails: persisted('sent-emails.json'),
    finalApprovals: persisted('final-approvals.json'),
    recipients: persisted('recipients.json'),
    tracker: persisted('tracker-log.json'),
  };
}

export interface MeetingPipeline {
  /** Upload → transcript → speakers → summary → decisions → action items → STOP at Gate #1. */
  draftMinutes(input: DraftMinutesInput): Promise<PipelineRunView>;
  /** Gate #1 approval → drafts one email per attendee → STOP at Gate #2. */
  approveMinutes(runId: string, approvedBy: string): Promise<PipelineRunView>;
  /** Gate #2 approval → sends each email once → records action items as "Not Started". */
  approveEmailsAndSend(runId: string, approvedBy: string): Promise<PipelineRunView>;
  getRun(runId: string): PipelineRunView;
  getStatus(): PipelineStatus;
  /** Read-only: every meeting this server knows about (drafts in memory + approved meetings on disk). */
  listMeetings(): MeetingListItem[];
  /** Read-only: action items recorded by the tracker after final approvals. */
  listActionItems(): ActionItemListItem[];
  /** Saves reviewer edits to draft minutes via Gate #1's revise rule; only before approval #1. */
  reviseMinutes(runId: string, edits: MinutesEdits, editedBy?: string): PipelineRunView;
  /** The section editor's content as the whole draft (before approval #1). */
  replaceDraft(runId: string, draft: DraftMinutes, editedBy?: string): void;
  /** After final approval: saves amended minutes on the meeting record. */
  amendApprovedMinutes(runId: string, draft: DraftMinutes): void;
  /** Replaces the transcript lines (corrected words / speaker names). */
  correctTranscript(runId: string, segments: DiarizedSegment[]): void;
  /** Emails "Updated minutes" once per amended version (draft-only mode drafts without sending). */
  sendUpdatedMinutes(runId: string, version: number, reason: string, by: string): Promise<UpdatedMinutesResult>;
}

/**
 * Connects every existing meeting-workflow service in order, with the two human approvals as hard
 * stops. Each step is safe to replay: an already-approved gate is not re-approved, an
 * already-drafted email batch is not re-drafted, an already-sent email is not re-sent, and the
 * tracker dedupes its own log. A failed send leaves the run at `emails_pending_approval` with the
 * successful sends recorded, so approving again resumes with only the remaining recipients.
 */
export function createMeetingPipeline(
  providers: MeetingPipelineProviders,
  stores: MeetingPipelineStores = createPipelineStores()
): MeetingPipeline {
  const emailMode = providers.emailMode ?? 'send';
  /** One in-flight send per run, so a double-clicked Approve can't send the same email twice. */
  const inFlightSends = new Map<string, Promise<PipelineRunView>>();

  /** A final approval saved with its full meeting record (minutes + transcript + emails) can be shown with no in-memory state at all. */
  function savedRecord(runId: string) {
    const record = stores.finalApprovals.get(runId);
    return record?.minutes && record.emails ? record : undefined;
  }

  function getRun(runId: string): PipelineRunView {
    const minutesSession = stores.minutesGate.get(runId);
    // Only a COMPLETE saved record (minutes + transcript + emails) defines an approved meeting. An
    // older, incomplete approval record (saved before drafts were kept) must never override a fresh
    // in-memory run of the same recording — that was the bug that hid the draft and the Approve button.
    const record = savedRecord(runId);
    const minutes = record?.minutes ?? minutesSession?.draft;
    if (!minutes) {
      throw new RunNotFoundError(`No meeting run found for id "${runId}"`, { runId });
    }
    const emailSession = stores.emailGate.get(runId);
    const tracked = stores.tracker.get(runId);
    // The approved batch is kept with the final approval, so the drafts stay visible even after a restart.
    const emails = emailSession?.batch ?? record?.emails;
    const sentTo = emails?.emails
      .map((email) => ({ participantName: email.participantName, sentAt: stores.sentEmails.get(`${runId}:${email.participantName}`) }))
      .filter((entry): entry is { participantName: string; sentAt: string } => typeof entry.sentAt === 'string');

    return {
      runId,
      stage:
        record && tracked
          ? record.emailMode === 'draft-only'
            ? 'approved_not_sent'
            : 'sent'
          : emailSession
            ? 'emails_pending_approval'
            : 'minutes_pending_approval',
      providerMode: providers.mode,
      emailMode,
      finalApproval: record && { approvedAt: record.approvedAt, approvedBy: record.approvedBy, emailMode: record.emailMode },
      providers: providers.description,
      transcript: record?.transcript ?? stores.speakers.get(runId)?.segments ?? [],
      minutes,
      emails,
      recipients: record?.recipients ?? stores.recipients.get(runId),
      sentTo,
      trackedActionItems: record ? tracked?.loggedItems : undefined,
    };
  }

  async function approveMinutes(runId: string, approvedBy: string): Promise<PipelineRunView> {
    if (savedRecord(runId)) return getRun(runId); // already fully approved — nothing to redo
    const session = stores.minutesGate.get(runId);
    if (!session) {
      throw new RunNotFoundError(`No meeting run found for id "${runId}"`, { runId });
    }
    if (session.status !== 'approved') {
      await runStage(runId, 'minutes approval', () => approveMinutesGate({ sessionId: runId, approvedBy }, { sessionStore: stores.minutesGate }));
    }
    if (!stores.emailGate.has(runId)) {
      const batch = await runStage(runId, 'email drafting', () =>
        draftEmails({ reviewGateSessionId: runId }, { reviewGateOptions: { sessionStore: stores.minutesGate } })
      );
      await runStage(runId, 'email review gate', () => submitEmailsForReview({ batch }, { sessionStore: stores.emailGate }));
    }
    return getRun(runId);
  }

  /**
   * Every email still to be sent needs an address (real SMTP), and every address must pass the
   * provider's checks (e.g. SMTP_ALLOWED_RECIPIENTS). Checked before Gate #2 is recorded, so a
   * problem never leaves a half-sent batch or an approval that could not be carried out.
   */
  function assertRecipientsReady(runId: string, participantNames: string[]): void {
    const addresses = stores.recipients.get(runId) ?? {};
    const pending = participantNames.filter((name) => !stores.sentEmails.has(`${runId}:${name}`));
    const problems: string[] = [];
    if (emailMode === 'draft-only') return; // nothing will be sent, so a missing address is not a blocker
    if (providers.requiresRecipientAddresses) {
      const missing = pending.filter((name) => !addresses[name]);
      if (missing.length > 0) {
        problems.push(`No email address for: ${missing.join(', ')}. Upload again with attendees entered as Name <email@example.com>.`);
      }
    }
    const known = pending.map((name) => addresses[name]).filter((a): a is string => typeof a === 'string');
    problems.push(...(providers.checkRecipients?.(known) ?? []));
    if (problems.length > 0) throw new RecipientProblemError(problems);
  }

  async function sendApprovedEmails(runId: string, approvedBy: string): Promise<PipelineRunView> {
    if (savedRecord(runId) && !stores.emailGate.has(runId)) return getRun(runId); // approved before a restart; nothing left to do
    const emailSession = stores.emailGate.get(runId);
    if (!emailSession) {
      const reason = stores.minutesGate.has(runId) ? 'The minutes must be approved before emails can be sent.' : `No meeting run found for id "${runId}"`;
      throw stores.minutesGate.has(runId) ? new StageOrderError(reason, { runId }) : new RunNotFoundError(reason, { runId });
    }
    // Checked before Gate #2 is recorded: an approval that could not be acted on would be misleading.
    if (providers.readiness && providers.readiness.send.length > 0) {
      throw new ProviderNotConfiguredError(providers.readiness.send);
    }
    assertRecipientsReady(runId, emailSession.batch.emails.map((email) => email.participantName));
    if (emailSession.status !== 'approved') {
      await runStage(runId, 'email approval', () => approveEmailGate({ sessionId: runId, approvedBy }, { sessionStore: stores.emailGate }));
    }
    const approved = assertApprovedForSending(runId, { sessionStore: stores.emailGate });
    // Replace an incomplete (pre-draft-saving) record too, so this approval is saved with its draft.
    if (!savedRecord(runId)) {
      stores.finalApprovals.set(runId, {
        approvedAt: approved.approvedAt ?? new Date().toISOString(),
        approvedBy: approved.approvedBy ?? approvedBy,
        emailMode,
        emails: approved.batch,
        recipients: { ...(stores.recipients.get(runId) ?? {}) },
        minutes: stores.minutesGate.get(runId)?.draft,
        transcript: stores.speakers.get(runId)?.segments,
      });
    }

    // Draft-only: the approval is recorded and action items are tracked, but the delivery client is never called.
    const emailsToSend = stores.finalApprovals.get(runId)?.emailMode === 'draft-only' ? [] : approved.batch.emails;
    for (const email of emailsToSend) {
      const key = `${runId}:${email.participantName}`;
      if (stores.sentEmails.has(key)) continue;
      // maxAttempts 1 on purpose: a send that timed out may still have gone out, so an automatic
      // retry could duplicate it. A failure stops here; approving again resumes from this email.
      await runStage(runId, `email delivery to ${email.participantName}`, () =>
        withTimeoutAndRetry(() => providers.emailDeliveryClient.send(email, { idempotencyKey: key, to: stores.recipients.get(runId)?.[email.participantName] }), {
          timeoutMs: EMAIL_SEND_TIMEOUT_MS,
          maxAttempts: 1,
          operationName: `emailDelivery.send(${key})`,
        })
      );
      stores.sentEmails.set(key, new Date().toISOString());
    }

    await runStage(runId, 'action item recording', () =>
      logActionItems(
        {
          confirmation: {
            sendingReviewGateSessionId: runId,
            // In draft-only mode nothing was sent: the confirmation names no recipients and carries the approval time.
            sentAt: new Date().toISOString(),
            confirmedRecipients: emailsToSend.map((email) => email.participantName),
          },
        },
        {
          actionItemTrackerClient: providers.actionItemTrackerClient,
          idempotencyStore: stores.tracker,
          sendingReviewGateOptions: { sessionStore: stores.emailGate },
        }
      )
    );
    return getRun(runId);
  }

  function approveEmailsAndSend(runId: string, approvedBy: string): Promise<PipelineRunView> {
    const existing = inFlightSends.get(runId);
    if (existing) return existing;
    const pending = sendApprovedEmails(runId, approvedBy).finally(() => inFlightSends.delete(runId));
    inFlightSends.set(runId, pending);
    return pending;
  }

  return {
    async draftMinutes(input) {
      const runId = await draftMinutesFromAudio(input, providers, stores);
      // Addresses are contact details, not meeting content: a re-upload may add or correct them until that person's email has gone out.
      if (input.attendeeEmails && Object.keys(input.attendeeEmails).length > 0) {
        const current = { ...(stores.recipients.get(runId) ?? {}) };
        for (const [name, address] of Object.entries(input.attendeeEmails)) {
          if (!stores.sentEmails.has(`${runId}:${name}`)) current[name] = address;
        }
        stores.recipients.set(runId, current);
      }
      return getRun(runId);
    },
    approveMinutes,
    approveEmailsAndSend,
    getRun,
    listMeetings: () => listMeetings(stores, getRun),
    listActionItems: () => listTrackedActionItems(stores),
    reviseMinutes: (runId, edits, editedBy) => {
      reviseMinutes(stores, runId, edits, editedBy);
      return getRun(runId);
    },
    replaceDraft: (runId, draft, editedBy) => replaceDraft(stores, runId, draft, editedBy),
    amendApprovedMinutes: (runId, draft) => amendApprovedMinutes(stores, runId, draft),
    correctTranscript: (runId, segments) => correctTranscript(stores, runId, segments),
    sendUpdatedMinutes: (runId, version, reason, by) => sendUpdatedMinutes(stores, providers, runId, version, reason, by),
    getStatus: () => ({ providerMode: providers.mode, emailMode, providers: providers.description, readiness: providers.readiness ?? { draft: [], send: [] } }),
  };
}

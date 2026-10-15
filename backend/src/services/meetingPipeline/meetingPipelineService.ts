import { withConstraints } from '../storage/uniqueIndex';
import { meetingConstraints } from '../storage/constraints';
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
import { renamePerson } from './personSync';
import path from 'path';
import { createHash } from 'crypto';
import { dedupeActionItems } from './dedupe';
import { ProviderNotConfiguredError, RecipientProblemError, RunNotFoundError, StageOrderError } from './errors';
import { JsonFileMap } from './jsonFileMap';
import { ActionItemListItem, listMeetings, listTrackedActionItems, MeetingListItem, MeetingStatus, reviewStarted, statusOf } from './meetingQueries';
import { addRecipient, addRecipients, approvalRound, renameAddress, deleteMeeting, EmailEdit, openChangeRequest, ParticipantEdit, reopenMinutes, requestChanges, reviseEmails, sentKey, updateParticipants } from './reviewActions';
import { amendApprovedMinutes, correctTranscript, pipelineActivity, PipelineActivity, renameMeeting, replaceDraft, sendUpdatedMinutes, UpdatedMinutesResult } from './minutesAmendments';
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
type ReviewGateSessionShape = MeetingPipelineStores['minutesGate'] extends Map<string, infer V> ? V : never;
type FinalApprovalShape = MeetingPipelineStores['finalApprovals'] extends Map<string, infer V> ? V : never;

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
    // UNIQUE(audio content hash) per meeting; no repeated action items inside one.
    minutesGate: withConstraints(persisted<ReviewGateSessionShape>('minutes-drafts.json'), meetingConstraints<ReviewGateSessionShape>((s) => s.draft)),
    emailGate: persisted('email-drafts.json'),
    sentEmails: persisted('sent-emails.json'),
    finalApprovals: withConstraints(persisted<FinalApprovalShape>('final-approvals.json'), meetingConstraints<FinalApprovalShape>((r) => r.minutes)),
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
  /** opts.recipients: send only to these participants (the send dialog's ticked names). */
  approveEmailsAndSend(runId: string, approvedBy: string, opts?: { recipients?: string[] }): Promise<PipelineRunView>;
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
  /** Renames a meeting (draft and approved record). */
  renameMeeting(runId: string, title: string, editedBy?: string): PipelineRunView;
  /** Drafts ready, approvals, and sends, for "Recent activity". */
  activity(): PipelineActivity[];
  /** Emails "Updated minutes" once per amended version (draft-only mode drafts without sending). */
  sendUpdatedMinutes(runId: string, version: number, reason: string, by: string): Promise<UpdatedMinutesResult>;
  /** "Request changes" on the draft minutes: recorded, nothing approved. */
  requestChanges(runId: string, note: string, by?: string): PipelineRunView;
  /** Edits drafted emails before the final approval. */
  reviseEmails(runId: string, edits: EmailEdit[], by?: string): PipelineRunView;
  /** Corrects participant names / addresses before the minutes are approved. */
  updateParticipants(runId: string, people: ParticipantEdit[], by?: string): PipelineRunView;
  /** Removes a meeting and everything keyed by it. False when it was already gone. */
  deleteMeeting(runId: string): boolean;
  /** Dashboard status of one meeting. */
  meetingStatus(runId: string): MeetingStatus;
  /** Email step: add someone to receive the minutes, or give a participant an address. */
  addRecipient(runId: string, person: { name: string; email: string }, by?: string): PipelineRunView;
  /** Several people at once (validated together before any is added). */
  addRecipients(runId: string, people: Array<{ name?: string; email: string }>, by?: string): PipelineRunView;
  /** A person's corrected address, carried into every meeting not yet emailed to them. */
  renameAddress(from: string, to: string): number;
  /** A person's corrected name (People page), carried into every meeting not yet emailed to them. Returns the meetings changed. */
  renamePerson(email: string, name: string, by?: string): string[];
  /** Editing approved minutes withdraws the approval: back to review (Needs review). False when not approved. */
  reopenMinutes(runId: string, by?: string): boolean;
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
  /** One in-flight draft per audio file, so a double-submitted upload runs the (paid) stages once. */
  const inFlightDrafts = new Map<string, Promise<string>>();
  /** Action items are unique per (task, owner) within a meeting. */
  const unique = (draft: DraftMinutes): DraftMinutes => {
    const actionItems = dedupeActionItems(draft.actionItems);
    return actionItems.length === draft.actionItems.length ? draft : { ...draft, actionItems };
  };

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
    const stored = record?.minutes ?? minutesSession?.draft;
    if (!stored) {
      throw new RunNotFoundError(`No meeting run found for id "${runId}"`, { runId });
    }
    const minutes = unique(stored); // also tidies meetings saved before duplicates were removed
    const emailSession = stores.emailGate.get(runId);
    const tracked = stores.tracker.get(runId);
    // The approved batch is kept with the final approval, so the drafts stay visible even after a restart.
    const emails = emailSession?.batch ?? record?.emails;
    const sentTo = emails?.emails
      .map((email) => ({ participantName: email.participantName, sentAt: stores.sentEmails.get(sentKey(stores, runId, email.participantName)) }))
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
      status: statusOf(record && tracked ? (record.emailMode === 'draft-only' ? 'approved_not_sent' : 'sent') : emailSession ? 'emails_pending_approval' : 'minutes_pending_approval', reviewStarted(stores, runId), approvalRound(stores, runId) > 0),
      changeRequest: openChangeRequest(stores, runId),
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
      const drafted = await runStage(runId, 'email drafting', () =>
        draftEmails({ reviewGateSessionId: runId }, { reviewGateOptions: { sessionStore: stores.minutesGate } })
      );
      // Minutes that were already emailed, then corrected and approved again, go out as "Updated minutes".
      const sentBefore = approvalRound(stores, runId) > 0 && [...stores.sentEmails.keys()].some((k) => k.startsWith(`${runId}:`) && !k.includes(':update:'));
      const batch = sentBefore ? { ...drafted, emails: drafted.emails.map((e) => ({ ...e, subject: `Updated minutes: ${e.subject}` })) } : drafted;
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
    const pending = participantNames.filter((name) => !stores.sentEmails.has(sentKey(stores, runId, name)));
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

  async function sendApprovedEmails(runId: string, approvedBy: string, requested?: string[]): Promise<PipelineRunView> {
    if (savedRecord(runId) && !stores.emailGate.has(runId)) return getRun(runId); // approved before a restart; nothing left to do
    const emailSession = stores.emailGate.get(runId);
    if (!emailSession) {
      const reason = stores.minutesGate.has(runId) ? 'The minutes must be reviewed before emails can be sent.' : `No meeting run found for id "${runId}"`;
      throw stores.minutesGate.has(runId) ? new StageOrderError(reason, { runId }) : new RunNotFoundError(reason, { runId });
    }
    // Checked before Gate #2 is recorded: an approval that could not be acted on would be misleading.
    if (providers.readiness && providers.readiness.send.length > 0) {
      throw new ProviderNotConfiguredError(providers.readiness.send);
    }
    const everyone = emailSession.batch.emails.map((email) => email.participantName);
    // Who to email: the names ticked in the send dialog, or the selection saved with an earlier approval.
    const selected = requested ?? stores.finalApprovals.get(runId)?.selectedRecipients;
    if (selected) {
      const unknown = selected.filter((name) => !everyone.includes(name));
      if (unknown.length) throw new StageOrderError(`There’s no email to ${unknown.join(', ')} in this draft.`, { runId });
      if (!selected.length && emailMode !== 'draft-only') throw new StageOrderError('Choose at least one participant to send to.', { runId });
    }
    assertRecipientsReady(runId, selected ?? everyone);
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
        ...(selected ? { selectedRecipients: [...selected] } : {}),
        minutes: stores.minutesGate.get(runId)?.draft,
        transcript: stores.speakers.get(runId)?.segments,
      });
    }

    // Draft-only: the approval is recorded and action items are tracked, but the delivery client is never called.
    const chosen = stores.finalApprovals.get(runId)?.selectedRecipients;
    const emailsToSend = stores.finalApprovals.get(runId)?.emailMode === 'draft-only' ? [] : approved.batch.emails.filter((e) => !chosen || chosen.includes(e.participantName));
    for (const email of emailsToSend) {
      const key = sentKey(stores, runId, email.participantName);
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

  /**
   * A meeting approved while sending was off (draft-only) whose drafted emails are sent now that
   * sending is on: the approved emails go to the chosen participants, once each (sent-email log), and
   * the record becomes a normal sent approval. A failure leaves it at "Emails drafted" with the
   * successful sends recorded, so sending again resumes with only the remaining people.
   */
  /**
   * Also used to send to more people after the minutes were emailed (alreadySent): only people who
   * haven't received it yet are emailed, the original review (who/when) is kept, and the chosen people
   * are added to the record's selection. Anyone already sent to is skipped (sent-email log), never re-sent.
   */
  async function sendEarlierDraft(runId: string, approvedBy: string, requested?: string[], alreadySent = false): Promise<PipelineRunView> {
    const record = stores.finalApprovals.get(runId)!;
    const emails = record.emails!.emails;
    const everyone = emails.map((e) => e.participantName);
    const notYetSent = (name: string) => !stores.sentEmails.has(sentKey(stores, runId, name));
    const selected = requested ?? everyone.filter((name) => (record.recipients ?? stores.recipients.get(runId) ?? {})[name] && (!alreadySent || notYetSent(name)));
    const unknown = selected.filter((name) => !everyone.includes(name));
    if (unknown.length) throw new StageOrderError(`There’s no email to ${unknown.join(', ')} in this draft.`, { runId });
    if (!selected.length) throw new StageOrderError('Choose at least one participant to send to.', { runId });
    if (alreadySent && !selected.some(notYetSent)) throw new StageOrderError('Everyone you chose has already received the email.', { runId });
    if (providers.readiness && providers.readiness.send.length > 0) throw new ProviderNotConfiguredError(providers.readiness.send);
    if (record.recipients && !stores.recipients.has(runId)) stores.recipients.set(runId, { ...record.recipients });
    assertRecipientsReady(runId, selected);
    const addresses = stores.recipients.get(runId) ?? record.recipients ?? {};
    for (const email of emails.filter((e) => selected.includes(e.participantName))) {
      const key = sentKey(stores, runId, email.participantName);
      if (stores.sentEmails.has(key)) continue;
      await runStage(runId, `email delivery to ${email.participantName}`, () =>
        withTimeoutAndRetry(() => providers.emailDeliveryClient.send(email, { idempotencyKey: key, to: addresses[email.participantName] }), {
          timeoutMs: EMAIL_SEND_TIMEOUT_MS,
          maxAttempts: 1,
          operationName: `emailDelivery.send(${key})`,
        })
      );
      stores.sentEmails.set(key, new Date().toISOString());
    }
    const latest = stores.finalApprovals.get(runId)!;
    stores.finalApprovals.set(runId, alreadySent
      ? { ...latest, selectedRecipients: [...new Set([...(latest.selectedRecipients ?? everyone.filter((n) => !notYetSent(n) && !selected.includes(n))), ...selected])] }
      : { ...latest, emailMode: 'send', selectedRecipients: [...selected], approvedBy, approvedAt: new Date().toISOString() });
    return getRun(runId);
  }

  function approveEmailsAndSend(runId: string, approvedBy: string, opts?: { recipients?: string[] }): Promise<PipelineRunView> {
    const existing = inFlightSends.get(runId);
    if (existing) return existing;
    const record = savedRecord(runId);
    const earlierDraft = !!record && record.emailMode === 'draft-only' && emailMode === 'send';
    // Already emailed, and people were chosen: send to the ones who haven't received it (missed or added later).
    // Only once the send finished (action items recorded); a send that failed part-way resumes through sendApprovedEmails.
    const sendMore = !!record && record.emailMode === 'send' && emailMode === 'send' && !!opts?.recipients && stores.tracker.has(runId);
    const pending = (earlierDraft ? sendEarlierDraft(runId, approvedBy, opts?.recipients)
      : sendMore ? sendEarlierDraft(runId, approvedBy, opts?.recipients, true)
        : sendApprovedEmails(runId, approvedBy, opts?.recipients)).finally(() => inFlightSends.delete(runId));
    inFlightSends.set(runId, pending);
    return pending;
  }

  return {
    async draftMinutes(input) {
      const hash = createHash('sha256').update(input.buffer).digest('hex');
      let pending = inFlightDrafts.get(hash);
      if (!pending) {
        pending = draftMinutesFromAudio(input, providers, stores).finally(() => inFlightDrafts.delete(hash));
        inFlightDrafts.set(hash, pending);
      }
      const runId = await pending;
      // Addresses are contact details, not meeting content: a re-upload may add or correct them until that person's email has gone out.
      if (input.attendeeEmails && Object.keys(input.attendeeEmails).length > 0) {
        const current = { ...(stores.recipients.get(runId) ?? {}) };
        for (const [name, address] of Object.entries(input.attendeeEmails)) {
          if (!stores.sentEmails.has(sentKey(stores, runId, name))) current[name] = address;
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
    renameMeeting: (runId, title, editedBy) => { renameMeeting(stores, runId, title, editedBy); return getRun(runId); },
    activity: () => pipelineActivity(stores),
    replaceDraft: (runId, draft, editedBy) => replaceDraft(stores, runId, unique(draft), editedBy),
    amendApprovedMinutes: (runId, draft) => amendApprovedMinutes(stores, runId, unique(draft)),
    correctTranscript: (runId, segments) => correctTranscript(stores, runId, segments),
    sendUpdatedMinutes: (runId, version, reason, by) => sendUpdatedMinutes(stores, providers, runId, version, reason, by),
    requestChanges: (runId, note, by) => { requestChanges(stores, runId, note, by); return getRun(runId); },
    reviseEmails: (runId, edits, by) => { reviseEmails(stores, runId, edits, by); return getRun(runId); },
    updateParticipants: (runId, people, by) => { updateParticipants(stores, runId, people, by); return getRun(runId); },
    deleteMeeting: (runId) => { inFlightSends.delete(runId); return deleteMeeting(stores, runId); },
    meetingStatus: (runId) => getRun(runId).status as MeetingStatus,
    reopenMinutes: (runId, by) => reopenMinutes(stores, runId, by),
    addRecipient: (runId, person, by) => { addRecipient(stores, runId, person, by); return getRun(runId); },
    addRecipients: (runId, people, by) => { addRecipients(stores, runId, people, by); return getRun(runId); },
    renameAddress: (from, to) => renameAddress(stores, from, to),
    renamePerson: (email, name, by) => renamePerson(stores, email, name, by),
    getStatus: () => ({ providerMode: providers.mode, emailMode, providers: providers.description, readiness: providers.readiness ?? { draft: [], send: [] } }),
  };
}

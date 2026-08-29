import { approve, submitForReview } from '../reviewGate/reviewGateService';
import { ReviewGateSession } from '../reviewGate/types';
import { draftEmails, EmailDraftingLogger } from './emailDraftingService';
import { ContractViolationError, EmailDraftingFailedError } from './errors';
import { DraftEmailsInput } from './types';
import { MeetingSummary } from '../meetingSummary/types';
import { ActionItem } from '../actionItemExtraction/types';
import { DraftMinutes } from '../reviewGate/types';
import { ReviewNotApprovedError, SessionNotFoundError } from '../reviewGate/errors';

function meetingSummary(transcriptId: string, overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: transcriptId,
    transcriptId,
    audioId: `audio-${transcriptId}`,
    title: 'Roadmap Sync',
    date: '2026-08-29',
    time: '14:00',
    format: 'Virtual',
    platformOrLocation: 'Zoom',
    attendees: ['Priya', 'Marcus'],
    objective: 'Align on Q4 roadmap',
    missingFields: [],
    generatedAt: '2026-08-29T18:00:00.000Z',
    ...overrides,
  };
}

function actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    task: 'Follow up with the client',
    owner: 'Priya',
    dueDate: '2026-09-05',
    priority: 'high',
    status: 'open',
    sourceTimestampMs: 12000,
    missingFields: [],
    flaggedForReview: false,
    ...overrides,
  };
}

function draftMinutes(transcriptId = 't-1', overrides: Partial<DraftMinutes> = {}): DraftMinutes {
  return {
    transcriptId,
    meetingSummary: meetingSummary(transcriptId),
    discussionTopics: [{ topic: 'Q4 scope', startMs: 0, endMs: 5000, summary: 'Agreed on scope', flaggedForReview: false, flagReasons: [] }],
    decisions: [{ decision: 'Ship the v2 API by Q4', missingFields: [], flaggedForReview: false }],
    actionItems: [],
    ...overrides,
  };
}

/** Submits + approves a draft against a fresh, isolated review-gate session store, then returns
 * that store so `draftEmails` can be pointed at it via `reviewGateOptions`. */
function approvedSession(draft: DraftMinutes, approvedBy = 'Dana'): Map<string, ReviewGateSession> {
  const sessionStore = new Map<string, ReviewGateSession>();
  submitForReview({ draft }, { sessionStore });
  approve({ sessionId: draft.transcriptId, approvedBy }, { sessionStore });
  return sessionStore;
}

function fakeLogger(): EmailDraftingLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('draftEmails', () => {
  it('happy path: drafts one individualized email per attendee, each carrying only their own action items', () => {
    const draft = draftMinutes('t-happy', {
      actionItems: [actionItem({ task: 'Send the proposal', owner: 'Priya' }), actionItem({ task: 'Review the budget', owner: 'Marcus' })],
    });
    const sessionStore = approvedSession(draft);

    const batch = draftEmails({ reviewGateSessionId: 't-happy' }, { reviewGateOptions: { sessionStore } });

    expect(batch.emails).toHaveLength(2);
    const priyaEmail = batch.emails.find((e) => e.participantName === 'Priya');
    const marcusEmail = batch.emails.find((e) => e.participantName === 'Marcus');

    expect(priyaEmail?.actionItems.map((i) => i.task)).toEqual(['Send the proposal']);
    expect(priyaEmail?.body).toContain('Send the proposal');
    expect(priyaEmail?.body).not.toContain('Review the budget');

    expect(marcusEmail?.actionItems.map((i) => i.task)).toEqual(['Review the budget']);
    expect(marcusEmail?.body).toContain('Review the budget');
    expect(marcusEmail?.body).not.toContain('Send the proposal');

    expect(batch.unmatchedActionItems).toEqual([]);
    expect(batch.flaggedForReview).toBe(false);
  });

  it('acceptance criterion: a participant with no action items gets the exact required sentence', () => {
    const draft = draftMinutes('t-none', { actionItems: [actionItem({ owner: 'Priya' })] });
    const sessionStore = approvedSession(draft);

    const batch = draftEmails({ reviewGateSessionId: 't-none' }, { reviewGateOptions: { sessionStore } });

    const marcusEmail = batch.emails.find((e) => e.participantName === 'Marcus');
    expect(marcusEmail?.actionItems).toEqual([]);
    expect(marcusEmail?.body).toContain('No action items assigned to you from this meeting.');
  });

  it('incorrect email personalization: an action item whose owner matches no attendee is surfaced, not silently dropped or misattached', () => {
    const draft = draftMinutes('t-typo', { actionItems: [actionItem({ task: 'Unassigned task', owner: 'Stve' })] });
    const sessionStore = approvedSession(draft);

    const batch = draftEmails({ reviewGateSessionId: 't-typo' }, { reviewGateOptions: { sessionStore } });

    expect(batch.emails.every((e) => e.actionItems.length === 0)).toBe(true);
    expect(batch.unmatchedActionItems).toHaveLength(1);
    expect(batch.unmatchedActionItems[0].actionItem.task).toBe('Unassigned task');
    expect(batch.unmatchedActionItems[0].reason).toContain('Stve');
    expect(batch.flaggedForReview).toBe(true);
  });

  it('failure to draft emails: an approved draft with no attendees throws EmailDraftingFailedError', () => {
    const draft = draftMinutes('t-empty', { meetingSummary: meetingSummary('t-empty', { attendees: [] }) });
    const sessionStore = approvedSession(draft);

    expect(() => draftEmails({ reviewGateSessionId: 't-empty' }, { reviewGateOptions: { sessionStore } })).toThrow(EmailDraftingFailedError);
  });

  it('failure to wait for approval: a still-pending session\'s Gate #1 error propagates unchanged, no emails drafted', () => {
    const sessionStore = new Map<string, ReviewGateSession>();
    submitForReview({ draft: draftMinutes('t-pending') }, { sessionStore });

    expect(() => draftEmails({ reviewGateSessionId: 't-pending' }, { reviewGateOptions: { sessionStore } })).toThrow(ReviewNotApprovedError);
  });

  it('failure to wait for approval: a session that was never submitted throws SessionNotFoundError', () => {
    const sessionStore = new Map<string, ReviewGateSession>();

    expect(() => draftEmails({ reviewGateSessionId: 'never-submitted' }, { reviewGateOptions: { sessionStore } })).toThrow(SessionNotFoundError);
  });

  it('email drafting logic failure: a missing reviewGateSessionId throws ContractViolationError', () => {
    const badInput = {} as unknown as DraftEmailsInput;

    expect(() => draftEmails(badInput)).toThrow(ContractViolationError);
  });

  it('trust: logs the drafting attempt and result, and a failed attempt with the right error_class', () => {
    const logger = fakeLogger();
    const draft = draftMinutes('t-log', { actionItems: [actionItem({ owner: 'Priya' })] });
    const sessionStore = approvedSession(draft);

    draftEmails({ reviewGateSessionId: 't-log' }, { logger, reviewGateOptions: { sessionStore } });

    expect(logger.calls.map(([event]) => event)).toEqual(['email_drafting_attempted', 'emails_drafted']);
    expect(logger.calls[1][1].emailCount).toBe(2);
  });

  it('trust (real audit log): a blocked gate-check is recorded with outcome failure and the right error_class', () => {
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const sessionStore = new Map<string, ReviewGateSession>();

      expect(() => draftEmails({ reviewGateSessionId: 'ghost-session' }, { reviewGateOptions: { sessionStore } })).toThrow(SessionNotFoundError);

      const failureEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => entry.service === 'emailDrafting' && entry.outcome === 'failure');

      expect(failureEntries).toHaveLength(1);
      expect(failureEntries[0].event).toBe('email_drafting_failed');
      expect(failureEntries[0].error_class).toBe('SessionNotFoundError');
      expect(failureEntries[0].resourceId).toBe('ghost-session');
    } finally {
      logSpy.mockRestore();
    }
  });
});

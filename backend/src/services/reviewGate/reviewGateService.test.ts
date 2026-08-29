import {
  approve,
  assertApprovedForEmailDrafting,
  requestRevision,
  ReviewGateLogger,
  submitForReview,
} from './reviewGateService';
import { ContractViolationError, ReviewNotApprovedError, SessionAlreadyApprovedError, SessionNotFoundError } from './errors';
import { ApproveInput, DraftMinutes, RequestRevisionInput, ReviewGateSession, SubmitForReviewInput } from './types';
import { MeetingSummary } from '../meetingSummary/types';

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

function draftMinutes(transcriptId = 't-1', overrides: Partial<DraftMinutes> = {}): DraftMinutes {
  return {
    transcriptId,
    meetingSummary: meetingSummary(transcriptId),
    discussionTopics: [],
    decisions: [],
    actionItems: [],
    ...overrides,
  };
}

function fakeLogger(): ReviewGateLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

function freshStore(): Map<string, ReviewGateSession> {
  return new Map<string, ReviewGateSession>();
}

describe('submitForReview', () => {
  it('happy path: opens a new session in pending_review carrying the submitted draft', () => {
    const draft = draftMinutes('t-happy');
    const session = submitForReview({ draft }, { sessionStore: freshStore() });

    expect(session.status).toBe('pending_review');
    expect(session.id).toBe('t-happy');
    expect(session.draft).toEqual(draft);
    expect(session.revisions).toEqual([]);
  });

  it('failure path: a draft missing transcriptId throws ContractViolationError', () => {
    const badInput = { draft: { meetingSummary: {}, discussionTopics: [], decisions: [], actionItems: [] } } as unknown as SubmitForReviewInput;

    expect(() => submitForReview(badInput, { sessionStore: freshStore() })).toThrow(ContractViolationError);
  });

  it('failure path: a draft with a non-array actionItems throws ContractViolationError', () => {
    const badInput = { draft: { ...draftMinutes('t-bad'), actionItems: 'not-an-array' } } as unknown as SubmitForReviewInput;

    expect(() => submitForReview(badInput, { sessionStore: freshStore() })).toThrow(ContractViolationError);
  });

  it('idempotency: re-submitting the same transcript while pending is a no-op returning the same session', () => {
    const sessionStore = freshStore();
    const logger = fakeLogger();
    const draft = draftMinutes('t-dup');

    const first = submitForReview({ draft }, { sessionStore, logger });
    const second = submitForReview({ draft }, { sessionStore, logger });

    expect(second).toEqual(first);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'review_submission_attempted',
      'review_submitted',
      'review_submission_attempted',
      'review_submission_deduplicated',
    ]);
  });

  it('review gate logic failure: re-submitting after approval is rejected, not silently reopened', () => {
    const sessionStore = freshStore();
    const draft = draftMinutes('t-reopen');
    submitForReview({ draft }, { sessionStore });
    approve({ sessionId: 't-reopen', approvedBy: 'Dana' }, { sessionStore });

    expect(() => submitForReview({ draft }, { sessionStore })).toThrow(SessionAlreadyApprovedError);
    expect(sessionStore.get('t-reopen')?.status).toBe('approved');
  });
});

describe('requestRevision', () => {
  it('happy path: applies the revised draft and re-presents the session for review', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-rev') }, { sessionStore });

    const revisedDraft = draftMinutes('t-rev', { meetingSummary: meetingSummary('t-rev', { objective: 'Corrected objective' }) });
    const input: RequestRevisionInput = {
      sessionId: 't-rev',
      changesRequested: 'Fix the objective wording',
      revisedDraft,
      requestedBy: 'Priya',
    };

    const session = requestRevision(input, { sessionStore });

    expect(session.status).toBe('pending_review');
    expect(session.draft.meetingSummary.objective).toBe('Corrected objective');
    expect(session.revisions).toHaveLength(1);
    expect(session.revisions[0].changesRequested).toBe('Fix the objective wording');
    expect(session.revisions[0].requestedBy).toBe('Priya');
    expect(session.revisions[0].draftAtRequest.meetingSummary.objective).toBe('Align on Q4 roadmap');
  });

  it('failure path (incorrect handling of requested edits): a revised draft for the wrong transcript throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-mismatch') }, { sessionStore });

    const input: RequestRevisionInput = {
      sessionId: 't-mismatch',
      changesRequested: 'Wrong meeting entirely',
      revisedDraft: draftMinutes('t-other-meeting'),
    };

    expect(() => requestRevision(input, { sessionStore })).toThrow(ContractViolationError);
  });

  it('failure path: requesting a revision with no changesRequested text throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-empty-edit') }, { sessionStore });

    const input = { sessionId: 't-empty-edit', changesRequested: '', revisedDraft: draftMinutes('t-empty-edit') };

    expect(() => requestRevision(input, { sessionStore })).toThrow(ContractViolationError);
  });

  it('review gate logic failure: requesting a revision on a nonexistent session throws SessionNotFoundError', () => {
    const input: RequestRevisionInput = {
      sessionId: 'does-not-exist',
      changesRequested: 'Anything',
      revisedDraft: draftMinutes('does-not-exist'),
    };

    expect(() => requestRevision(input, { sessionStore: freshStore() })).toThrow(SessionNotFoundError);
  });

  it('review gate logic failure: requesting a revision on an already-approved session throws SessionAlreadyApprovedError', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-locked') }, { sessionStore });
    approve({ sessionId: 't-locked', approvedBy: 'Dana' }, { sessionStore });

    const input: RequestRevisionInput = {
      sessionId: 't-locked',
      changesRequested: 'Too late',
      revisedDraft: draftMinutes('t-locked'),
    };

    expect(() => requestRevision(input, { sessionStore })).toThrow(SessionAlreadyApprovedError);
  });
});

describe('approve', () => {
  it('happy path: marks a pending session approved with the approver and timestamp recorded', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-approve') }, { sessionStore });

    const session = approve({ sessionId: 't-approve', approvedBy: 'Dana' }, { sessionStore });

    expect(session.status).toBe('approved');
    expect(session.approvedBy).toBe('Dana');
    expect(typeof session.approvedAt).toBe('string');
  });

  it('review gate logic failure: approving a nonexistent session throws SessionNotFoundError', () => {
    const input: ApproveInput = { sessionId: 'does-not-exist', approvedBy: 'Dana' };

    expect(() => approve(input, { sessionStore: freshStore() })).toThrow(SessionNotFoundError);
  });

  it('review gate logic failure: approving an already-approved session throws SessionAlreadyApprovedError', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-double') }, { sessionStore });
    approve({ sessionId: 't-double', approvedBy: 'Dana' }, { sessionStore });

    expect(() => approve({ sessionId: 't-double', approvedBy: 'Someone Else' }, { sessionStore })).toThrow(SessionAlreadyApprovedError);
  });

  it('review gate logic failure: approving without an approvedBy throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-anon') }, { sessionStore });

    const badInput = { sessionId: 't-anon' } as unknown as ApproveInput;

    expect(() => approve(badInput, { sessionStore })).toThrow(ContractViolationError);
  });
});

describe('assertApprovedForEmailDrafting (Gate #1)', () => {
  it('failure to wait for approval: throws ReviewNotApprovedError while a session is still pending_review', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-pending') }, { sessionStore });

    expect(() => assertApprovedForEmailDrafting('t-pending', { sessionStore })).toThrow(ReviewNotApprovedError);
  });

  it('failure to wait for approval: throws SessionNotFoundError when minutes were never submitted for review', () => {
    expect(() => assertApprovedForEmailDrafting('never-submitted', { sessionStore: freshStore() })).toThrow(SessionNotFoundError);
  });

  it('happy path: returns the session once it has been explicitly approved', () => {
    const sessionStore = freshStore();
    submitForReview({ draft: draftMinutes('t-cleared') }, { sessionStore });
    approve({ sessionId: 't-cleared', approvedBy: 'Dana' }, { sessionStore });

    const session = assertApprovedForEmailDrafting('t-cleared', { sessionStore });

    expect(session.status).toBe('approved');
  });
});

describe('trust: audit trail', () => {
  it('records submit, approve, and a blocked gate-check with distinct auditEventIds and the right outcome/error_class', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const sessionStore = freshStore();
      submitForReview({ draft: draftMinutes('t-audit') }, { sessionStore });
      approve({ sessionId: 't-audit', approvedBy: 'Dana' }, { sessionStore });

      expect(() => assertApprovedForEmailDrafting('t-audit-unsubmitted', { sessionStore })).toThrow(SessionNotFoundError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      const submittedEntry = successEntries.find((e) => e.event === 'review_submitted' && e.resourceId === 't-audit');
      expect(submittedEntry).toBeDefined();
      expect(submittedEntry.service).toBe('reviewGate');

      const approvedEntry = successEntries.find((e) => e.event === 'review_approved' && e.resourceId === 't-audit');
      expect(approvedEntry).toBeDefined();
      expect(approvedEntry.context.approvedBy).toBe('Dana');

      const blockedEntry = failureEntries.find((e) => e.event === 'gate_check_blocked' && e.resourceId === 't-audit-unsubmitted');
      expect(blockedEntry).toBeDefined();
      expect(blockedEntry.outcome).toBe('failure');
      expect(blockedEntry.error_class).toBe('SessionNotFoundError');

      const allIds = [...successEntries, ...failureEntries].map((e) => e.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

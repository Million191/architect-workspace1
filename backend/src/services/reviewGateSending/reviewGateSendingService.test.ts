import {
  approve,
  assertApprovedForSending,
  requestRevision,
  ReviewGateSendingLogger,
  submitForReview,
} from './reviewGateSendingService';
import { ContractViolationError, SendingNotApprovedError, SessionAlreadyApprovedError, SessionNotFoundError } from './errors';
import { ApproveInput, RequestRevisionInput, SendingReviewGateSession, SubmitForReviewInput } from './types';
import { DraftedEmail, EmailDraftBatch } from '../emailDrafting/types';

function draftedEmail(participantName: string, overrides: Partial<DraftedEmail> = {}): DraftedEmail {
  return {
    participantName,
    subject: 'Roadmap Sync — your recap',
    body: `Hi ${participantName}, here is your recap.`,
    actionItems: [],
    ...overrides,
  };
}

function emailDraftBatch(id = 'b-1', overrides: Partial<EmailDraftBatch> = {}): EmailDraftBatch {
  return {
    id,
    transcriptId: id,
    reviewGateSessionId: id,
    emails: [draftedEmail('Priya'), draftedEmail('Marcus')],
    unmatchedActionItems: [],
    flaggedForReview: false,
    generatedAt: '2026-08-29T18:30:00.000Z',
    ...overrides,
  };
}

function fakeLogger(): ReviewGateSendingLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

function freshStore(): Map<string, SendingReviewGateSession> {
  return new Map<string, SendingReviewGateSession>();
}

describe('submitForReview', () => {
  it('happy path: opens a new session in pending_review carrying the submitted batch', () => {
    const batch = emailDraftBatch('b-happy');
    const session = submitForReview({ batch }, { sessionStore: freshStore() });

    expect(session.status).toBe('pending_review');
    expect(session.id).toBe('b-happy');
    expect(session.batch).toEqual(batch);
    expect(session.revisions).toEqual([]);
  });

  it('failure path: a batch missing id throws ContractViolationError', () => {
    const badInput = {
      batch: { reviewGateSessionId: 'b-bad', emails: [draftedEmail('Priya')], unmatchedActionItems: [], flaggedForReview: false, generatedAt: 'now' },
    } as unknown as SubmitForReviewInput;

    expect(() => submitForReview(badInput, { sessionStore: freshStore() })).toThrow(ContractViolationError);
  });

  it('failure path: a batch with a non-array emails field throws ContractViolationError', () => {
    const badInput = { batch: { ...emailDraftBatch('b-bad-emails'), emails: 'not-an-array' } } as unknown as SubmitForReviewInput;

    expect(() => submitForReview(badInput, { sessionStore: freshStore() })).toThrow(ContractViolationError);
  });

  it('boundary case: a batch with zero emails throws ContractViolationError — nothing to send for review', () => {
    const badInput = { batch: emailDraftBatch('b-empty', { emails: [] }) };

    expect(() => submitForReview(badInput, { sessionStore: freshStore() })).toThrow(ContractViolationError);
  });

  it('idempotency: re-submitting the same batch while pending is a no-op returning the same session', () => {
    const sessionStore = freshStore();
    const logger = fakeLogger();
    const batch = emailDraftBatch('b-dup');

    const first = submitForReview({ batch }, { sessionStore, logger });
    const second = submitForReview({ batch }, { sessionStore, logger });

    expect(second).toEqual(first);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'sending_review_submission_attempted',
      'sending_review_submitted',
      'sending_review_submission_attempted',
      'sending_review_submission_deduplicated',
    ]);
  });

  it('review gate logic failure: re-submitting after approval is rejected, not silently reopened', () => {
    const sessionStore = freshStore();
    const batch = emailDraftBatch('b-reopen');
    submitForReview({ batch }, { sessionStore });
    approve({ sessionId: 'b-reopen', approvedBy: 'Dana' }, { sessionStore });

    expect(() => submitForReview({ batch }, { sessionStore })).toThrow(SessionAlreadyApprovedError);
    expect(sessionStore.get('b-reopen')?.status).toBe('approved');
  });
});

describe('requestRevision', () => {
  it('happy path: applies the revised batch and re-presents the session for review', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-rev') }, { sessionStore });

    const revisedBatch = emailDraftBatch('b-rev', {
      emails: [draftedEmail('Priya', { subject: 'Roadmap Sync — corrected recap' }), draftedEmail('Marcus')],
    });
    const input: RequestRevisionInput = {
      sessionId: 'b-rev',
      changesRequested: "Fix Priya's subject line",
      revisedBatch,
      requestedBy: 'Dana',
    };

    const session = requestRevision(input, { sessionStore });

    expect(session.status).toBe('pending_review');
    expect(session.batch.emails[0].subject).toBe('Roadmap Sync — corrected recap');
    expect(session.revisions).toHaveLength(1);
    expect(session.revisions[0].changesRequested).toBe("Fix Priya's subject line");
    expect(session.revisions[0].requestedBy).toBe('Dana');
    expect(session.revisions[0].batchAtRequest.emails[0].subject).toBe('Roadmap Sync — your recap');
  });

  it('failure path (incorrect handling of requested adjustments): a revised batch for the wrong session throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-mismatch') }, { sessionStore });

    const input: RequestRevisionInput = {
      sessionId: 'b-mismatch',
      changesRequested: 'Wrong meeting entirely',
      revisedBatch: emailDraftBatch('b-other-meeting'),
    };

    expect(() => requestRevision(input, { sessionStore })).toThrow(ContractViolationError);
  });

  it('failure path: requesting a revision with no changesRequested text throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-empty-edit') }, { sessionStore });

    const input = { sessionId: 'b-empty-edit', changesRequested: '', revisedBatch: emailDraftBatch('b-empty-edit') };

    expect(() => requestRevision(input, { sessionStore })).toThrow(ContractViolationError);
  });

  it('review gate logic failure: requesting a revision on a nonexistent session throws SessionNotFoundError', () => {
    const input: RequestRevisionInput = {
      sessionId: 'does-not-exist',
      changesRequested: 'Anything',
      revisedBatch: emailDraftBatch('does-not-exist'),
    };

    expect(() => requestRevision(input, { sessionStore: freshStore() })).toThrow(SessionNotFoundError);
  });

  it('review gate logic failure: requesting a revision on an already-approved session throws SessionAlreadyApprovedError', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-locked') }, { sessionStore });
    approve({ sessionId: 'b-locked', approvedBy: 'Dana' }, { sessionStore });

    const input: RequestRevisionInput = {
      sessionId: 'b-locked',
      changesRequested: 'Too late',
      revisedBatch: emailDraftBatch('b-locked'),
    };

    expect(() => requestRevision(input, { sessionStore })).toThrow(SessionAlreadyApprovedError);
  });
});

describe('approve', () => {
  it('happy path: marks a pending session approved with the approver and timestamp recorded', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-approve') }, { sessionStore });

    const session = approve({ sessionId: 'b-approve', approvedBy: 'Dana' }, { sessionStore });

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
    submitForReview({ batch: emailDraftBatch('b-double') }, { sessionStore });
    approve({ sessionId: 'b-double', approvedBy: 'Dana' }, { sessionStore });

    expect(() => approve({ sessionId: 'b-double', approvedBy: 'Someone Else' }, { sessionStore })).toThrow(SessionAlreadyApprovedError);
  });

  it('review gate logic failure: approving without an approvedBy throws ContractViolationError', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-anon') }, { sessionStore });

    const badInput = { sessionId: 'b-anon' } as unknown as ApproveInput;

    expect(() => approve(badInput, { sessionStore })).toThrow(ContractViolationError);
  });
});

describe('assertApprovedForSending (Gate #2)', () => {
  it('failure to wait for approval: throws SendingNotApprovedError while a session is still pending_review', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-pending') }, { sessionStore });

    expect(() => assertApprovedForSending('b-pending', { sessionStore })).toThrow(SendingNotApprovedError);
  });

  it('failure to wait for approval: throws SessionNotFoundError when emails were never submitted for review', () => {
    expect(() => assertApprovedForSending('never-submitted', { sessionStore: freshStore() })).toThrow(SessionNotFoundError);
  });

  it('happy path: returns the session once it has been explicitly approved', () => {
    const sessionStore = freshStore();
    submitForReview({ batch: emailDraftBatch('b-cleared') }, { sessionStore });
    approve({ sessionId: 'b-cleared', approvedBy: 'Dana' }, { sessionStore });

    const session = assertApprovedForSending('b-cleared', { sessionStore });

    expect(session.status).toBe('approved');
  });
});

describe('trust: audit trail', () => {
  it('records submit, approve, and a blocked gate-check with distinct auditEventIds and the right outcome/error_class', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const sessionStore = freshStore();
      submitForReview({ batch: emailDraftBatch('b-audit') }, { sessionStore });
      approve({ sessionId: 'b-audit', approvedBy: 'Dana' }, { sessionStore });

      expect(() => assertApprovedForSending('b-audit-unsubmitted', { sessionStore })).toThrow(SessionNotFoundError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      const submittedEntry = successEntries.find((e) => e.event === 'sending_review_submitted' && e.resourceId === 'b-audit');
      expect(submittedEntry).toBeDefined();
      expect(submittedEntry.service).toBe('reviewGateSending');

      const approvedEntry = successEntries.find((e) => e.event === 'sending_review_approved' && e.resourceId === 'b-audit');
      expect(approvedEntry).toBeDefined();
      expect(approvedEntry.context.approvedBy).toBe('Dana');

      const blockedEntry = failureEntries.find((e) => e.event === 'sending_gate_check_blocked' && e.resourceId === 'b-audit-unsubmitted');
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

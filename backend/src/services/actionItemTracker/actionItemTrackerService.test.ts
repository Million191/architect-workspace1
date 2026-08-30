import { logActionItems } from './actionItemTrackerService';
import { ActionItemLoggingFailedError, ContractViolationError, SendConfirmationNotVerifiedError } from './errors';
import { ActionItemTrackerClient, EmailSendConfirmation, TrackerLogResult } from './types';
import { approve, submitForReview } from '../reviewGateSending/reviewGateSendingService';
import { SendingReviewGateSession } from '../reviewGateSending/types';
import { ActionItem } from '../actionItemExtraction/types';
import { DraftedEmail, EmailDraftBatch } from '../emailDrafting/types';

function actionItem(task: string, overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    task,
    owner: 'Priya',
    dueDate: '2026-09-05',
    priority: 'high',
    status: 'open',
    sourceTimestampMs: 1000,
    missingFields: [],
    flaggedForReview: false,
    ...overrides,
  };
}

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

function confirmation(sendingReviewGateSessionId: string, overrides: Partial<EmailSendConfirmation> = {}): EmailSendConfirmation {
  return {
    sendingReviewGateSessionId,
    sentAt: '2026-08-29T19:00:00.000Z',
    confirmedRecipients: ['Priya', 'Marcus'],
    ...overrides,
  };
}

function freshSendingStore(): Map<string, SendingReviewGateSession> {
  return new Map<string, SendingReviewGateSession>();
}

/** Submits and approves a batch through the real Gate #2 module, so tests exercise this service
 * against a genuinely-approved session rather than a hand-built fixture standing in for one. */
function approvedBatch(sessionStore: Map<string, SendingReviewGateSession>, id: string, batchOverrides: Partial<EmailDraftBatch> = {}): void {
  submitForReview({ batch: emailDraftBatch(id, batchOverrides) }, { sessionStore });
  approve({ sessionId: id, approvedBy: 'Dana' }, { sessionStore });
}

describe('logActionItems', () => {
  it('happy path: logs every action item from the approved batch (per-participant + unmatched) with status Not Started', async () => {
    const sessionStore = freshSendingStore();
    const priyaItem = actionItem('Send the proposal', { owner: 'Priya' });
    const marcusItem = actionItem('Update the roadmap doc', { owner: 'Marcus' });
    const strayItem = actionItem('Follow up with vendor', { owner: 'Someone Not Invited' });

    approvedBatch(sessionStore, 'b-happy', {
      emails: [draftedEmail('Priya', { actionItems: [priyaItem] }), draftedEmail('Marcus', { actionItems: [marcusItem] })],
      unmatchedActionItems: [{ actionItem: strayItem, reason: 'owner not on attendee list' }],
    });

    const trackerCalls: unknown[] = [];
    const actionItemTrackerClient: ActionItemTrackerClient = {
      logActionItems: async (items) => {
        trackerCalls.push(items);
      },
    };

    const result = await logActionItems(
      { confirmation: confirmation('b-happy') },
      { actionItemTrackerClient, sendingReviewGateOptions: { sessionStore }, idempotencyStore: new Map() }
    );

    expect(result.sendingReviewGateSessionId).toBe('b-happy');
    expect(result.loggedItems).toHaveLength(3);
    expect(result.loggedItems.every((item) => item.status === 'Not Started')).toBe(true);
    expect(result.loggedItems.map((item) => item.actionItem.task).sort()).toEqual(
      ['Follow up with vendor', 'Send the proposal', 'Update the roadmap doc'].sort()
    );
    expect(trackerCalls).toHaveLength(1);
  });

  it('incorrect action item logging (input boundary): a confirmation missing sendingReviewGateSessionId throws ContractViolationError', async () => {
    const actionItemTrackerClient: ActionItemTrackerClient = { logActionItems: jest.fn().mockResolvedValue(undefined) };
    const badInput = { confirmation: { sentAt: 'now', confirmedRecipients: [] } } as unknown as { confirmation: EmailSendConfirmation };

    await expect(logActionItems(badInput, { actionItemTrackerClient, idempotencyStore: new Map() })).rejects.toThrow(ContractViolationError);
    expect(actionItemTrackerClient.logActionItems).not.toHaveBeenCalled();
  });

  it('incorrect action item logging (input boundary): a non-array confirmedRecipients throws ContractViolationError', async () => {
    const actionItemTrackerClient: ActionItemTrackerClient = { logActionItems: jest.fn().mockResolvedValue(undefined) };
    const badInput = {
      confirmation: { sendingReviewGateSessionId: 'b-x', sentAt: 'now', confirmedRecipients: 'nope' },
    } as unknown as { confirmation: EmailSendConfirmation };

    await expect(logActionItems(badInput, { actionItemTrackerClient, idempotencyStore: new Map() })).rejects.toThrow(ContractViolationError);
  });

  it('incorrect action item logging (trust boundary): a confirmation for a batch never submitted to Gate #2 throws SendConfirmationNotVerifiedError', async () => {
    const actionItemTrackerClient: ActionItemTrackerClient = { logActionItems: jest.fn().mockResolvedValue(undefined) };

    await expect(
      logActionItems(
        { confirmation: confirmation('never-submitted') },
        { actionItemTrackerClient, sendingReviewGateOptions: { sessionStore: freshSendingStore() }, idempotencyStore: new Map() }
      )
    ).rejects.toThrow(SendConfirmationNotVerifiedError);
    expect(actionItemTrackerClient.logActionItems).not.toHaveBeenCalled();
  });

  it('incorrect action item logging (trust boundary): a confirmation for a batch still pending_review (never approved) throws SendConfirmationNotVerifiedError', async () => {
    const sessionStore = freshSendingStore();
    submitForReview({ batch: emailDraftBatch('b-pending') }, { sessionStore });
    const actionItemTrackerClient: ActionItemTrackerClient = { logActionItems: jest.fn().mockResolvedValue(undefined) };

    await expect(
      logActionItems(
        { confirmation: confirmation('b-pending') },
        { actionItemTrackerClient, sendingReviewGateOptions: { sessionStore }, idempotencyStore: new Map() }
      )
    ).rejects.toThrow(SendConfirmationNotVerifiedError);
    expect(actionItemTrackerClient.logActionItems).not.toHaveBeenCalled();
  });

  it('idempotency: re-confirming the same send is a no-op returning the existing result, without calling the tracker client again', async () => {
    const sessionStore = freshSendingStore();
    approvedBatch(sessionStore, 'b-dup');
    const idempotencyStore = new Map<string, TrackerLogResult>();
    let callCount = 0;
    const actionItemTrackerClient: ActionItemTrackerClient = {
      logActionItems: async () => {
        callCount += 1;
      },
    };

    const first = await logActionItems(
      { confirmation: confirmation('b-dup') },
      { actionItemTrackerClient, sendingReviewGateOptions: { sessionStore }, idempotencyStore }
    );
    const second = await logActionItems(
      { confirmation: confirmation('b-dup') },
      { actionItemTrackerClient, sendingReviewGateOptions: { sessionStore }, idempotencyStore }
    );

    expect(second).toEqual(first);
    expect(callCount).toBe(1);
  });

  it('logging service failure: retries a failing tracker client and succeeds once it stops failing', async () => {
    const sessionStore = freshSendingStore();
    approvedBatch(sessionStore, 'b-retry');
    let attempts = 0;
    const actionItemTrackerClient: ActionItemTrackerClient = {
      logActionItems: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('tracker temporarily unavailable');
        }
      },
    };

    const result = await logActionItems(
      { confirmation: confirmation('b-retry') },
      {
        actionItemTrackerClient,
        sendingReviewGateOptions: { sessionStore },
        idempotencyStore: new Map(),
        maxAttempts: 3,
        backoffMs: () => 0,
        timeoutMs: 1000,
      }
    );

    expect(attempts).toBe(2);
    expect(result.sendingReviewGateSessionId).toBe('b-retry');
  });

  it('action item logging retry failure: exhausts retries, throws ActionItemLoggingFailedError, and notifies the user', async () => {
    const sessionStore = freshSendingStore();
    approvedBatch(sessionStore, 'b-fail');
    let attempts = 0;
    const actionItemTrackerClient: ActionItemTrackerClient = {
      logActionItems: async () => {
        attempts += 1;
        throw new Error('tracker down');
      },
    };
    const notified: Array<{ sendingReviewGateSessionId: string; error: ActionItemLoggingFailedError }> = [];

    await expect(
      logActionItems(
        { confirmation: confirmation('b-fail') },
        {
          actionItemTrackerClient,
          sendingReviewGateOptions: { sessionStore },
          idempotencyStore: new Map(),
          maxAttempts: 3,
          backoffMs: () => 0,
          timeoutMs: 1000,
          notifyUserOfFailure: (context) => notified.push(context),
        }
      )
    ).rejects.toThrow(ActionItemLoggingFailedError);

    expect(attempts).toBe(3);
    expect(notified).toHaveLength(1);
    expect(notified[0].sendingReviewGateSessionId).toBe('b-fail');
    expect(notified[0].error).toBeInstanceOf(ActionItemLoggingFailedError);
  });
});

describe('trust: audit trail', () => {
  it('records an attempted+logged success and a failed+notified run, all with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const sessionStore = freshSendingStore();
      approvedBatch(sessionStore, 'b-audit-ok');
      approvedBatch(sessionStore, 'b-audit-fail');

      const okClient: ActionItemTrackerClient = { logActionItems: async () => {} };
      await logActionItems(
        { confirmation: confirmation('b-audit-ok') },
        { actionItemTrackerClient: okClient, sendingReviewGateOptions: { sessionStore }, idempotencyStore: new Map() }
      );

      const failingClient: ActionItemTrackerClient = {
        logActionItems: async () => {
          throw new Error('nope');
        },
      };
      await expect(
        logActionItems(
          { confirmation: confirmation('b-audit-fail') },
          {
            actionItemTrackerClient: failingClient,
            sendingReviewGateOptions: { sessionStore },
            idempotencyStore: new Map(),
            maxAttempts: 1,
            backoffMs: () => 0,
          }
        )
      ).rejects.toThrow(ActionItemLoggingFailedError);

      const successEntries = logSpy.mock.calls.map(([line]) => JSON.parse(line as string)).filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls.map(([line]) => JSON.parse(line as string)).filter((entry) => typeof entry.auditEventId === 'string');

      const attemptedEntry = successEntries.find((entry) => entry.event === 'action_item_logging_attempted' && entry.resourceId === 'b-audit-ok');
      expect(attemptedEntry).toBeDefined();
      expect(attemptedEntry.service).toBe('actionItemTracker');

      const loggedEntry = successEntries.find((entry) => entry.event === 'action_items_logged' && entry.resourceId === 'b-audit-ok');
      expect(loggedEntry).toBeDefined();
      expect(loggedEntry.context.status).toBe('Not Started');

      const failedEntry = failureEntries.find((entry) => entry.event === 'action_item_logging_failed' && entry.resourceId === 'b-audit-fail');
      expect(failedEntry).toBeDefined();
      expect(failedEntry.outcome).toBe('failure');
      expect(failedEntry.error_class).toBe('ActionItemLoggingFailedError');

      const notifiedEntry = successEntries.find((entry) => entry.event === 'user_notified_of_logging_failure' && entry.resourceId === 'b-audit-fail');
      expect(notifiedEntry).toBeDefined();

      const allIds = [...successEntries, ...failureEntries].map((entry) => entry.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

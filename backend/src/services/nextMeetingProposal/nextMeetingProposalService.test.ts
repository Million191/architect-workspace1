import { proposeNextMeetingAndCarryOverItems, NextMeetingProposalLogger } from './nextMeetingProposalService';
import { ContractViolationError } from './errors';
import { NextMeetingProposalResult, ProposeNextMeetingInput } from './types';
import { ActionItem } from '../actionItemExtraction/types';

const CONCLUDED_AT = '2026-08-29T18:00:00.000Z';

function openItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return { task: 'Send the revised budget', owner: 'Jordan Lee', status: 'open', missingFields: [], flaggedForReview: false, ...overrides };
}

function fakeLogger(): NextMeetingProposalLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('proposeNextMeetingAndCarryOverItems', () => {
  it('happy path: open items present proposes a next meeting one week out and carries the items over', () => {
    const result = proposeNextMeetingAndCarryOverItems(
      { meetingId: 'm-happy', concludedAt: CONCLUDED_AT, openItems: [openItem()] },
      { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
    );

    expect(result.proposed).toBe(true);
    expect(result.proposal?.proposedDateTime).toBe('2026-09-05T18:00:00.000Z');
    expect(result.carriedOverItems).toHaveLength(1);
    expect(result.carriedOverItems[0].task).toBe('Send the revised budget');
  });

  it('failure path: no open items does not propose a next meeting', () => {
    const result = proposeNextMeetingAndCarryOverItems(
      { meetingId: 'm-none', concludedAt: CONCLUDED_AT, openItems: [] },
      { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
    );

    expect(result.proposed).toBe(false);
    expect(result.proposal).toBeUndefined();
    expect(result.carriedOverItems).toEqual([]);
  });

  it('an item with no status at all still counts as open', () => {
    const itemWithoutStatus = openItem({ status: undefined, missingFields: ['status'], flaggedForReview: true });

    const result = proposeNextMeetingAndCarryOverItems(
      { meetingId: 'm-unknown-status', concludedAt: CONCLUDED_AT, openItems: [itemWithoutStatus] },
      { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
    );

    expect(result.proposed).toBe(true);
    expect(result.carriedOverItems).toHaveLength(1);
  });

  it('an item already marked done is excluded from the open count and from carry-over', () => {
    const result = proposeNextMeetingAndCarryOverItems(
      { meetingId: 'm-done', concludedAt: CONCLUDED_AT, openItems: [openItem({ status: 'done' })] },
      { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
    );

    expect(result.proposed).toBe(false);
    expect(result.carriedOverItems).toEqual([]);
  });

  it('failure path: a missing meetingId throws ContractViolationError', () => {
    const badInput = { concludedAt: CONCLUDED_AT, openItems: [] } as unknown as ProposeNextMeetingInput;

    expect(() => proposeNextMeetingAndCarryOverItems(badInput, { idempotencyStore: new Map() })).toThrow(ContractViolationError);
  });

  it('failure path: an unparseable concludedAt throws ContractViolationError', () => {
    const badInput: ProposeNextMeetingInput = { meetingId: 'm-bad-date', concludedAt: 'not-a-date', openItems: [] };

    expect(() => proposeNextMeetingAndCarryOverItems(badInput, { idempotencyStore: new Map() })).toThrow(ContractViolationError);
  });

  it('failure path: an open item missing its task text throws ContractViolationError', () => {
    const badInput = {
      meetingId: 'm-bad-item',
      concludedAt: CONCLUDED_AT,
      openItems: [{ status: 'open' }],
    } as unknown as ProposeNextMeetingInput;

    expect(() => proposeNextMeetingAndCarryOverItems(badInput, { idempotencyStore: new Map() })).toThrow(ContractViolationError);
  });

  it('idempotency: proposing twice for the same meetingId returns the same result without recomputing', () => {
    const idempotencyStore = new Map<string, NextMeetingProposalResult>();
    const logger = fakeLogger();
    const input: ProposeNextMeetingInput = { meetingId: 'm-dup', concludedAt: CONCLUDED_AT, openItems: [openItem()] };

    const first = proposeNextMeetingAndCarryOverItems(input, { idempotencyStore, logger });
    const second = proposeNextMeetingAndCarryOverItems(input, { idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'next_meeting_proposal_attempted',
      'next_meeting_proposed',
      'next_meeting_proposal_deduplicated',
    ]);
  });

  it('trust: proposal attempts and results (proposed, skipped, and failed) are written to the audit trail with distinct auditEventIds, including proposedDateTime and carried-over items', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      proposeNextMeetingAndCarryOverItems(
        { meetingId: 'm-trust-proposed', concludedAt: CONCLUDED_AT, openItems: [openItem()] },
        { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
      );
      proposeNextMeetingAndCarryOverItems(
        { meetingId: 'm-trust-skipped', concludedAt: CONCLUDED_AT, openItems: [] },
        { idempotencyStore: new Map<string, NextMeetingProposalResult>() }
      );

      const badInput = { meetingId: 'm-trust-fail', concludedAt: 'not-a-date', openItems: [] } as unknown as ProposeNextMeetingInput;
      expect(() => proposeNextMeetingAndCarryOverItems(badInput, { idempotencyStore: new Map() })).toThrow(ContractViolationError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      const proposedEntry = successEntries.find((e) => e.event === 'next_meeting_proposed' && e.resourceId === 'm-trust-proposed');
      expect(proposedEntry).toBeDefined();
      expect(proposedEntry.context.proposedDateTime).toBe('2026-09-05T18:00:00.000Z');
      expect(proposedEntry.context.carriedOverItems).toHaveLength(1);

      const skippedEntry = successEntries.find(
        (e) => e.event === 'next_meeting_proposal_skipped_no_open_items' && e.resourceId === 'm-trust-skipped'
      );
      expect(skippedEntry).toBeDefined();
      expect(skippedEntry.context.proposed).toBe(false);
      expect(skippedEntry.context.carriedOverItemCount).toBe(0);

      const failureEntry = failureEntries.find((e) => e.event === 'next_meeting_proposal_failed');
      expect(failureEntry).toBeDefined();
      expect(failureEntry.outcome).toBe('failure');
      expect(failureEntry.error_class).toBe('ContractViolationError');

      const allIds = [...successEntries, ...failureEntries].map((e) => e.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

import { compareOpenItems } from './staleItemComparison';
import { ContractViolationError, StaleComparisonFailedError } from './errors';
import { TrackedActionItem } from './types';
import { ActionItem } from '../actionItemExtraction/types';

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

function tracked(task: string, loggedAt: string, overrides: Partial<ActionItem> = {}): TrackedActionItem {
  return { actionItem: actionItem(task, overrides), status: 'Not Started', loggedAt };
}

const NOW = new Date('2026-08-30T00:00:00.000Z');

describe('compareOpenItems', () => {
  it('happy path: flags an item open for more than 2 weeks as Stale, ages from the earliest sighting', () => {
    const prior = [tracked('Send the proposal', '2026-08-01T00:00:00.000Z')];
    const current = [tracked('Send the proposal', '2026-08-20T00:00:00.000Z')];

    const result = compareOpenItems({ priorOpenItems: prior, currentOpenItems: current, now: NOW });

    expect(result.staleCount).toBe(1);
    expect(result.items[0].status).toBe('Stale');
    expect(result.items[0].firstLoggedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(result.items[0].daysOpen).toBeCloseTo(29, 0);
  });

  it('an item open exactly at the 14-day boundary is not yet stale (threshold is "more than 2 weeks")', () => {
    const current = [tracked('Update the roadmap doc', '2026-08-16T00:00:00.000Z')];

    const result = compareOpenItems({ priorOpenItems: [], currentOpenItems: current, now: NOW });

    expect(result.items[0].daysOpen).toBeCloseTo(14, 5);
    expect(result.items[0].status).toBe('Not Started');
    expect(result.staleCount).toBe(0);
  });

  it('no stale items: confirms all items are current (allCurrent true, staleCount 0)', () => {
    const current = [tracked('Update the roadmap doc', '2026-08-25T00:00:00.000Z'), tracked('Book the vendor call', '2026-08-28T00:00:00.000Z')];

    const result = compareOpenItems({ priorOpenItems: [], currentOpenItems: current, now: NOW });

    expect(result.allCurrent).toBe(true);
    expect(result.staleCount).toBe(0);
    expect(result.items.every((item) => item.status === 'Not Started')).toBe(true);
  });

  it('incorrect stale item flagging: same task but a different owner does not match across meetings', () => {
    const prior = [tracked('Send the proposal', '2026-08-01T00:00:00.000Z', { owner: 'Priya' })];
    const current = [tracked('Send the proposal', '2026-08-25T00:00:00.000Z', { owner: 'Marcus' })];

    const result = compareOpenItems({ priorOpenItems: prior, currentOpenItems: current, now: NOW });

    expect(result.items[0].firstLoggedAt).toBe('2026-08-25T00:00:00.000Z');
    expect(result.items[0].status).toBe('Not Started');
  });

  it('comparison logic failure (input boundary): a non-array priorOpenItems throws ContractViolationError', () => {
    const badInput = { priorOpenItems: 'nope', currentOpenItems: [] } as unknown as Parameters<typeof compareOpenItems>[0];

    expect(() => compareOpenItems(badInput)).toThrow(ContractViolationError);
  });

  it('comparison logic failure: an unparseable loggedAt on a current item throws StaleComparisonFailedError', () => {
    const current = [tracked('Send the proposal', 'not-a-date')];

    expect(() => compareOpenItems({ priorOpenItems: [], currentOpenItems: current, now: NOW })).toThrow(StaleComparisonFailedError);
  });

  it('comparison logic failure: an unparseable loggedAt on a prior item throws StaleComparisonFailedError', () => {
    const prior = [tracked('Send the proposal', 'not-a-date')];
    const current = [tracked('Send the proposal', '2026-08-25T00:00:00.000Z')];

    expect(() => compareOpenItems({ priorOpenItems: prior, currentOpenItems: current, now: NOW })).toThrow(StaleComparisonFailedError);
  });
});

describe('trust: audit trail', () => {
  it('records an attempted+flagged run and an attempted+current run, all with distinct auditEventIds', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      compareOpenItems({
        priorOpenItems: [tracked('Send the proposal', '2026-08-01T00:00:00.000Z')],
        currentOpenItems: [tracked('Send the proposal', '2026-08-20T00:00:00.000Z')],
        now: NOW,
      });
      compareOpenItems({ priorOpenItems: [], currentOpenItems: [tracked('Book the vendor call', '2026-08-28T00:00:00.000Z')], now: NOW });
      expect(() => compareOpenItems({ priorOpenItems: [], currentOpenItems: [tracked('Bad item', 'not-a-date')], now: NOW })).toThrow(
        StaleComparisonFailedError
      );

      const successEntries = logSpy.mock.calls.map(([line]) => JSON.parse(line as string));
      const failureEntries = errorSpy.mock.calls.map(([line]) => JSON.parse(line as string));

      const attemptedEntries = successEntries.filter((entry) => entry.event === 'stale_item_comparison_attempted');
      expect(attemptedEntries).toHaveLength(3);
      expect(attemptedEntries[0].service).toBe('actionItemTracker');

      const flaggedEntry = successEntries.find((entry) => entry.event === 'stale_items_flagged');
      expect(flaggedEntry).toBeDefined();
      expect(flaggedEntry.context.staleCount).toBe(1);

      const currentEntry = successEntries.find((entry) => entry.event === 'all_items_current');
      expect(currentEntry).toBeDefined();

      const failedEntry = failureEntries.find((entry) => entry.event === 'stale_item_comparison_failed');
      expect(failedEntry).toBeDefined();
      expect(failedEntry.outcome).toBe('failure');
      expect(failedEntry.error_class).toBe('StaleComparisonFailedError');

      const allIds = [...successEntries, ...failureEntries].map((entry) => entry.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

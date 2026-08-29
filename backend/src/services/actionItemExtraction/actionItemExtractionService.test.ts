import { extractActionItems, ActionItemExtractionLogger } from './actionItemExtractionService';
import { ActionItemExtractionFailedError, ContractViolationError, IncorrectActionItemExtractionError } from './errors';
import { ActionItemExtractionClient, ActionItemTable, ExtractActionItemsInput, RawActionItem } from './types';
import { MarkedSegment, MarkedTranscript } from '../segmentMarking/types';

const noBackoff = () => 1; // keep retry tests fast; still exercises the retry path

function markedSegment(overrides: Partial<MarkedSegment>): MarkedSegment {
  return { startMs: 0, endMs: 1000, text: 'Hello.', audibility: 'clear', ...overrides };
}

function fakeMarkedTranscript(id = 'transcript-1', segments?: MarkedSegment[]): MarkedTranscript {
  return {
    id: `${id}-marked`,
    transcriptId: id,
    generatedAt: new Date().toISOString(),
    segments:
      segments ?? [
        markedSegment({ startMs: 0, endMs: 1000, text: "I'll send the revised budget by Friday." }),
        markedSegment({ startMs: 1000, endMs: 2000, text: 'Thanks, that unblocks procurement.' }),
        markedSegment({ startMs: 2000, endMs: 3000, text: 'Someone should follow up with legal.' }),
        markedSegment({ startMs: 3000, endMs: 4000, text: "I'll take that one." }),
      ],
  };
}

const completeActionItem: RawActionItem = {
  task: 'Send the revised budget',
  owner: 'Jordan Lee',
  dueDate: '2026-09-05',
  priority: 'high',
  status: 'open',
  sourceTimestampMs: 1000,
};

function fakeActionItemClient(items: RawActionItem[]): ActionItemExtractionClient {
  return { extractActionItems: jest.fn().mockResolvedValue(items) };
}

function fakeLogger(): ActionItemExtractionLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('extractActionItems', () => {
  it('happy path: a complete action item lists owner, due date, priority, status, and source timestamp, and is not flagged', async () => {
    const actionItemExtractionClient = fakeActionItemClient([completeActionItem]);

    const table = await extractActionItems(
      { markedTranscript: fakeMarkedTranscript('t-happy') },
      { actionItemExtractionClient, idempotencyStore: new Map<string, ActionItemTable>() }
    );

    expect(table.actionItems).toHaveLength(1);
    expect(table.actionItems[0]).toMatchObject({
      task: 'Send the revised budget',
      owner: 'Jordan Lee',
      dueDate: '2026-09-05',
      priority: 'high',
      status: 'open',
      sourceTimestampMs: 1000,
      missingFields: [],
      flaggedForReview: false,
    });
  });

  it('failure path: missing action item fields are flagged for review, not rejected', async () => {
    const incompleteActionItem: RawActionItem = { task: 'Follow up with legal', sourceTimestampMs: 3000 };
    const actionItemExtractionClient = fakeActionItemClient([completeActionItem, incompleteActionItem]);

    const table = await extractActionItems(
      { markedTranscript: fakeMarkedTranscript('t-missing') },
      { actionItemExtractionClient, idempotencyStore: new Map<string, ActionItemTable>() }
    );

    expect(table.actionItems).toHaveLength(2);
    expect(table.actionItems[0].flaggedForReview).toBe(false);
    expect(table.actionItems[1]).toMatchObject({
      task: 'Follow up with legal',
      flaggedForReview: true,
    });
    expect(table.actionItems[1].missingFields.sort()).toEqual(['dueDate', 'owner', 'priority', 'status']);
  });

  it('failure path: action item extraction failure — non-array segments throws ContractViolationError', async () => {
    const badInput = {
      markedTranscript: { id: 'm-bad', transcriptId: 't-bad', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
    } as unknown as ExtractActionItemsInput;

    await expect(
      extractActionItems(badInput, { actionItemExtractionClient: fakeActionItemClient([completeActionItem]), idempotencyStore: new Map() })
    ).rejects.toThrow(ContractViolationError);
  });

  it('failure path: incorrect action item extraction — a timestamp outside the transcript span throws IncorrectActionItemExtractionError', async () => {
    const outOfRangeItem: RawActionItem = { ...completeActionItem, sourceTimestampMs: 999_999 };

    await expect(
      extractActionItems(
        { markedTranscript: fakeMarkedTranscript('t-oor') },
        { actionItemExtractionClient: fakeActionItemClient([outOfRangeItem]), idempotencyStore: new Map<string, ActionItemTable>() }
      )
    ).rejects.toBeInstanceOf(IncorrectActionItemExtractionError);
  });

  it('failure path: incorrect action item extraction — an unrecognized priority throws IncorrectActionItemExtractionError', async () => {
    const badPriorityItem = { ...completeActionItem, priority: 'urgent' } as unknown as RawActionItem;

    await expect(
      extractActionItems(
        { markedTranscript: fakeMarkedTranscript('t-badpri') },
        { actionItemExtractionClient: fakeActionItemClient([badPriorityItem]), idempotencyStore: new Map<string, ActionItemTable>() }
      )
    ).rejects.toBeInstanceOf(IncorrectActionItemExtractionError);
  });

  it('failure path: a provider that hangs past its timeout fails with ActionItemExtractionFailedError after exhausting retries', async () => {
    const hangingClient: ActionItemExtractionClient = {
      extractActionItems: jest.fn().mockImplementation(() => new Promise(() => {})),
    };

    await expect(
      extractActionItems(
        { markedTranscript: fakeMarkedTranscript('t-timeout') },
        {
          actionItemExtractionClient: hangingClient,
          idempotencyStore: new Map<string, ActionItemTable>(),
          timeoutMs: 10,
          maxAttempts: 2,
          backoffMs: noBackoff,
        }
      )
    ).rejects.toBeInstanceOf(ActionItemExtractionFailedError);

    expect(hangingClient.extractActionItems).toHaveBeenCalledTimes(2);
  });

  it('idempotency: extracting the same transcript twice does not call the provider a second time', async () => {
    const actionItemExtractionClient = fakeActionItemClient([completeActionItem]);
    const idempotencyStore = new Map<string, ActionItemTable>();
    const logger = fakeLogger();
    const markedTranscript = fakeMarkedTranscript('t-dup');

    const first = await extractActionItems({ markedTranscript }, { actionItemExtractionClient, idempotencyStore, logger });
    const second = await extractActionItems({ markedTranscript }, { actionItemExtractionClient, idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(actionItemExtractionClient.extractActionItems).toHaveBeenCalledTimes(1);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'action_item_extraction_attempted',
      'action_item_extraction_completed',
      'action_item_table_deduplicated',
    ]);
  });

  it('trust: action-item extraction attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await extractActionItems(
        { markedTranscript: fakeMarkedTranscript('t-ok') },
        { actionItemExtractionClient: fakeActionItemClient([completeActionItem]), idempotencyStore: new Map<string, ActionItemTable>() }
      );

      const badInput = {
        markedTranscript: { id: 'm-fail', transcriptId: 't-fail', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
      } as unknown as ExtractActionItemsInput;

      await expect(
        extractActionItems(badInput, { actionItemExtractionClient: fakeActionItemClient([completeActionItem]), idempotencyStore: new Map() })
      ).rejects.toThrow(ContractViolationError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'action_item_extraction_attempted' && e.service === 'actionItemExtraction')).toBe(true);
      expect(successEntries.some((e) => e.event === 'action_item_extraction_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'action_item_extraction_failed');
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

import { listDecisions, DecisionExtractionLogger } from './decisionExtractionService';
import { ContractViolationError, DecisionExtractionFailedError, IncorrectDecisionListingError } from './errors';
import { DecisionExtractionClient, DecisionListing, ListDecisionsInput, RawDecision } from './types';
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
        markedSegment({ startMs: 0, endMs: 1000, text: "Let's approve the new budget." }),
        markedSegment({ startMs: 1000, endMs: 2000, text: 'Agreed, approved.' }),
        markedSegment({ startMs: 2000, endMs: 3000, text: 'We will slip the deadline.' }),
        markedSegment({ startMs: 3000, endMs: 4000, text: 'Confirmed, deadline moved.' }),
      ],
  };
}

const completeDecision: RawDecision = {
  decision: 'Approve the new budget',
  rationale: 'Q3 revenue came in above forecast',
  approver: 'Jordan Lee',
  timestampMs: 1000,
};

function fakeDecisionClient(decisions: RawDecision[]): DecisionExtractionClient {
  return { extractDecisions: jest.fn().mockResolvedValue(decisions) };
}

function fakeLogger(): DecisionExtractionLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('listDecisions', () => {
  it('happy path: a complete decision lists rationale, approver, and timestamp, and is not flagged', async () => {
    const decisionExtractionClient = fakeDecisionClient([completeDecision]);

    const listing = await listDecisions(
      { markedTranscript: fakeMarkedTranscript('t-happy') },
      { decisionExtractionClient, idempotencyStore: new Map<string, DecisionListing>() }
    );

    expect(listing.decisions).toHaveLength(1);
    expect(listing.decisions[0]).toMatchObject({
      decision: 'Approve the new budget',
      rationale: 'Q3 revenue came in above forecast',
      approver: 'Jordan Lee',
      timestampMs: 1000,
      missingFields: [],
      flaggedForReview: false,
    });
  });

  it('failure path: missing decision fields are flagged for review, not rejected', async () => {
    const incompleteDecision: RawDecision = { decision: 'Slip the deadline', timestampMs: 3000 };
    const decisionExtractionClient = fakeDecisionClient([completeDecision, incompleteDecision]);

    const listing = await listDecisions(
      { markedTranscript: fakeMarkedTranscript('t-missing') },
      { decisionExtractionClient, idempotencyStore: new Map<string, DecisionListing>() }
    );

    expect(listing.decisions).toHaveLength(2);
    expect(listing.decisions[0].flaggedForReview).toBe(false);
    expect(listing.decisions[1]).toMatchObject({
      decision: 'Slip the deadline',
      flaggedForReview: true,
    });
    expect(listing.decisions[1].missingFields.sort()).toEqual(['approver', 'rationale']);
  });

  it('failure path: decision extraction failure — non-array segments throws ContractViolationError', async () => {
    const badInput = {
      markedTranscript: { id: 'm-bad', transcriptId: 't-bad', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
    } as unknown as ListDecisionsInput;

    await expect(
      listDecisions(badInput, { decisionExtractionClient: fakeDecisionClient([completeDecision]), idempotencyStore: new Map() })
    ).rejects.toThrow(ContractViolationError);
  });

  it('failure path: incorrect decision listing — a timestamp outside the transcript span throws IncorrectDecisionListingError', async () => {
    const outOfRangeDecision: RawDecision = { ...completeDecision, timestampMs: 999_999 };

    await expect(
      listDecisions(
        { markedTranscript: fakeMarkedTranscript('t-oor') },
        { decisionExtractionClient: fakeDecisionClient([outOfRangeDecision]), idempotencyStore: new Map<string, DecisionListing>() }
      )
    ).rejects.toBeInstanceOf(IncorrectDecisionListingError);
  });

  it('failure path: a provider that hangs past its timeout fails with DecisionExtractionFailedError after exhausting retries', async () => {
    const hangingClient: DecisionExtractionClient = {
      extractDecisions: jest.fn().mockImplementation(() => new Promise(() => {})),
    };

    await expect(
      listDecisions(
        { markedTranscript: fakeMarkedTranscript('t-timeout') },
        {
          decisionExtractionClient: hangingClient,
          idempotencyStore: new Map<string, DecisionListing>(),
          timeoutMs: 10,
          maxAttempts: 2,
          backoffMs: noBackoff,
        }
      )
    ).rejects.toBeInstanceOf(DecisionExtractionFailedError);

    expect(hangingClient.extractDecisions).toHaveBeenCalledTimes(2);
  });

  it('idempotency: listing the same transcript twice does not call the provider a second time', async () => {
    const decisionExtractionClient = fakeDecisionClient([completeDecision]);
    const idempotencyStore = new Map<string, DecisionListing>();
    const logger = fakeLogger();
    const markedTranscript = fakeMarkedTranscript('t-dup');

    const first = await listDecisions({ markedTranscript }, { decisionExtractionClient, idempotencyStore, logger });
    const second = await listDecisions({ markedTranscript }, { decisionExtractionClient, idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(decisionExtractionClient.extractDecisions).toHaveBeenCalledTimes(1);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'decision_listing_attempted',
      'decision_listing_completed',
      'decision_listing_deduplicated',
    ]);
  });

  it('trust: decision-listing attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await listDecisions(
        { markedTranscript: fakeMarkedTranscript('t-ok') },
        { decisionExtractionClient: fakeDecisionClient([completeDecision]), idempotencyStore: new Map<string, DecisionListing>() }
      );

      const badInput = {
        markedTranscript: { id: 'm-fail', transcriptId: 't-fail', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
      } as unknown as ListDecisionsInput;

      await expect(
        listDecisions(badInput, { decisionExtractionClient: fakeDecisionClient([completeDecision]), idempotencyStore: new Map() })
      ).rejects.toThrow(ContractViolationError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'decision_listing_attempted' && e.service === 'decisionExtraction')).toBe(true);
      expect(successEntries.some((e) => e.event === 'decision_listing_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'decision_extraction_failed');
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

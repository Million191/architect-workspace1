import { summarizeDiscussionPoints, DiscussionSummaryLogger } from './discussionSummaryService';
import { ContractViolationError, IncorrectTopicGroupingError, TopicSummarizationFailedError } from './errors';
import { DiscussionSummary, RawTopicSegment, SummarizeDiscussionInput, TopicSummarizationClient } from './types';
import { MarkedSegment, MarkedTranscript, UNCLEAR_LABEL } from '../segmentMarking/types';

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
        markedSegment({ startMs: 0, endMs: 1000, text: "Let's discuss the budget." }),
        markedSegment({ startMs: 1000, endMs: 2000, text: 'Yes, budget looks fine.' }),
        markedSegment({ startMs: 2000, endMs: 3000, text: 'Now the timeline...', audibility: 'unclear', marker: UNCLEAR_LABEL }),
        markedSegment({ startMs: 3000, endMs: 4000, text: 'Deadline is next month.' }),
      ],
  };
}

const twoTopics: RawTopicSegment[] = [
  { topic: 'Budget', startMs: 0, endMs: 2000, summary: 'Team discussed the budget and confirmed it looks fine.' },
  { topic: 'Timeline', startMs: 2000, endMs: 4000, summary: 'Team discussed the timeline; deadline is next month.' },
];

function fakeTopicClient(topics: RawTopicSegment[]): TopicSummarizationClient {
  return { summarizeTopics: jest.fn().mockResolvedValue(topics) };
}

function fakeLogger(): DiscussionSummaryLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('summarizeDiscussionPoints', () => {
  it('happy path: discussion points are grouped by topic with timestamp references', async () => {
    const topicSummarizationClient = fakeTopicClient(twoTopics);

    const summary = await summarizeDiscussionPoints(
      { markedTranscript: fakeMarkedTranscript('t-happy') },
      { topicSummarizationClient, idempotencyStore: new Map<string, DiscussionSummary>() }
    );

    expect(summary.topics).toHaveLength(2);
    expect(summary.topics[0]).toMatchObject({ topic: 'Budget', startMs: 0, endMs: 2000 });
    expect(summary.topics[1]).toMatchObject({ topic: 'Timeline', startMs: 2000, endMs: 4000 });
  });

  it('given unclear discussion points, the containing topic is flagged for review; a fully clear topic is not', async () => {
    const topicSummarizationClient = fakeTopicClient(twoTopics);

    const summary = await summarizeDiscussionPoints(
      { markedTranscript: fakeMarkedTranscript('t-flag') },
      { topicSummarizationClient, idempotencyStore: new Map<string, DiscussionSummary>() }
    );

    expect(summary.topics[0].flaggedForReview).toBe(false);
    expect(summary.topics[0].flagReasons).toEqual([]);
    expect(summary.topics[1].flaggedForReview).toBe(true);
    expect(summary.topics[1].flagReasons).toEqual([UNCLEAR_LABEL]);
  });

  it('failure path: discussion point extraction failure — non-array segments throws ContractViolationError', async () => {
    const badInput = {
      markedTranscript: { id: 'm-bad', transcriptId: 't-bad', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
    } as unknown as SummarizeDiscussionInput;

    await expect(
      summarizeDiscussionPoints(badInput, { topicSummarizationClient: fakeTopicClient(twoTopics), idempotencyStore: new Map() })
    ).rejects.toThrow(ContractViolationError);
  });

  it('failure path: incorrect topic grouping — a gap between topic ranges throws IncorrectTopicGroupingError', async () => {
    const gappedTopics: RawTopicSegment[] = [
      { topic: 'Budget', startMs: 0, endMs: 1500, summary: 'Budget discussion.' },
      { topic: 'Timeline', startMs: 2000, endMs: 4000, summary: 'Timeline discussion.' },
    ];

    await expect(
      summarizeDiscussionPoints(
        { markedTranscript: fakeMarkedTranscript('t-gap') },
        { topicSummarizationClient: fakeTopicClient(gappedTopics), idempotencyStore: new Map<string, DiscussionSummary>() }
      )
    ).rejects.toBeInstanceOf(IncorrectTopicGroupingError);
  });

  it('failure path: a provider that hangs past its timeout fails with TopicSummarizationFailedError after exhausting retries', async () => {
    const hangingClient: TopicSummarizationClient = {
      summarizeTopics: jest.fn().mockImplementation(() => new Promise(() => {})),
    };

    await expect(
      summarizeDiscussionPoints(
        { markedTranscript: fakeMarkedTranscript('t-timeout') },
        {
          topicSummarizationClient: hangingClient,
          idempotencyStore: new Map<string, DiscussionSummary>(),
          timeoutMs: 10,
          maxAttempts: 2,
          backoffMs: noBackoff,
        }
      )
    ).rejects.toBeInstanceOf(TopicSummarizationFailedError);

    expect(hangingClient.summarizeTopics).toHaveBeenCalledTimes(2);
  });

  it('idempotency: summarizing the same transcript twice does not call the provider a second time', async () => {
    const topicSummarizationClient = fakeTopicClient(twoTopics);
    const idempotencyStore = new Map<string, DiscussionSummary>();
    const logger = fakeLogger();
    const markedTranscript = fakeMarkedTranscript('t-dup');

    const first = await summarizeDiscussionPoints({ markedTranscript }, { topicSummarizationClient, idempotencyStore, logger });
    const second = await summarizeDiscussionPoints({ markedTranscript }, { topicSummarizationClient, idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(topicSummarizationClient.summarizeTopics).toHaveBeenCalledTimes(1);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'discussion_summary_attempted',
      'discussion_summary_completed',
      'discussion_summary_deduplicated',
    ]);
  });

  it('trust: discussion-summary attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await summarizeDiscussionPoints(
        { markedTranscript: fakeMarkedTranscript('t-ok') },
        { topicSummarizationClient: fakeTopicClient(twoTopics), idempotencyStore: new Map<string, DiscussionSummary>() }
      );

      const badInput = {
        markedTranscript: { id: 'm-fail', transcriptId: 't-fail', generatedAt: new Date().toISOString(), segments: 'not-an-array' },
      } as unknown as SummarizeDiscussionInput;

      await expect(
        summarizeDiscussionPoints(badInput, { topicSummarizationClient: fakeTopicClient(twoTopics), idempotencyStore: new Map() })
      ).rejects.toThrow(ContractViolationError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'discussion_summary_attempted' && e.service === 'discussionSummary')).toBe(
        true
      );
      expect(successEntries.some((e) => e.event === 'discussion_summary_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'discussion_extraction_failed');
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

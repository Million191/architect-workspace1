import Anthropic from '@anthropic-ai/sdk';
import { createClaudeAnalysisClients, toMeetingAnalysis } from './claudeAnalysisClient';

type ModelJson = Parameters<typeof toMeetingAnalysis>[0];
import { ProviderCallError } from './providerErrors';

const SEGMENTS = [
  { startMs: 0, endMs: 3760, text: 'Unidentified Speaker: Thanks everyone for joining the ACME onboarding sync.' },
  { startMs: 3760, endMs: 10080, text: 'Unidentified Speaker: We decided to move the kickoff call to next Tuesday instead of Monday.' },
  { startMs: 10080, endMs: 14960, text: 'Unidentified Speaker: Priya, can you send the updated contract to the client by Friday?' },
  { startMs: 14960, endMs: 25600, text: 'Unidentified Speaker: We still need someone to follow up with legal about the addendum.' },
];

const MODEL_JSON: ModelJson = {
  topics: [
    { title: 'Kickoff', summary: 'Kickoff moves to Tuesday.', firstSegment: 0, lastSegment: 1 },
    { title: 'Contract and legal', summary: 'Contract to client; legal follow-up unowned.', firstSegment: 2, lastSegment: 3 },
  ],
  decisions: [{ decision: 'Move the kickoff call to next Tuesday', rationale: '', approver: '', evidenceSegment: 1 }],
  actionItems: [
    { task: 'Send the updated contract to the client by Friday', owner: 'Priya', dueDate: '', priority: '', evidenceSegment: 2 },
    { task: 'Follow up with legal about the addendum', owner: '', dueDate: '', priority: '', evidenceSegment: 3 },
  ],
};

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function fakeClient(respond: () => Promise<unknown>) {
  const create = jest.fn(respond);
  return { create, client: { beta: { messages: { create } } } as unknown as Anthropic };
}

const reply = (json: unknown, stop_reason = 'end_turn') => async () => ({
  stop_reason,
  model: 'claude-sonnet-5-5',
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
});

describe('toMeetingAnalysis', () => {
  it('maps line indexes to real timestamps and keeps topics contiguous', () => {
    const result = toMeetingAnalysis(MODEL_JSON, SEGMENTS);
    expect(result.topics.map((t) => [t.startMs, t.endMs])).toEqual([[0, 10080], [10080, 25600]]);
    expect(result.decisions[0]).toMatchObject({ timestampMs: 3760, rationale: undefined, approver: undefined });
    expect(result.actionItems[0]).toMatchObject({ owner: 'Priya', dueDate: undefined, priority: undefined, sourceTimestampMs: 10080 });
    expect(result.actionItems[1].owner).toBeUndefined();
  });

  it('never keeps an invented timestamp or a non-date due date', () => {
    const result = toMeetingAnalysis(
      {
        ...MODEL_JSON,
        decisions: [{ decision: 'X', rationale: '', approver: '', evidenceSegment: 99 }],
        actionItems: [
          { task: 'A', owner: '', dueDate: 'Friday', priority: '' as const, evidenceSegment: -1 },
          { task: 'B', owner: '', dueDate: '2026-10-09', priority: 'high' as const, evidenceSegment: 0 },
        ],
      },
      SEGMENTS
    );
    expect(result.decisions[0].timestampMs).toBeUndefined();
    expect(result.actionItems[0]).toMatchObject({ dueDate: undefined, sourceTimestampMs: undefined });
    expect(result.actionItems[1]).toMatchObject({ dueDate: '2026-10-09', priority: 'high' });
  });

  it('repairs out-of-order or duplicate topics and rejects having none', () => {
    const shuffled = toMeetingAnalysis({ ...MODEL_JSON, topics: [MODEL_JSON.topics[1], MODEL_JSON.topics[0], MODEL_JSON.topics[0]] }, SEGMENTS);
    expect(shuffled.topics.map((t) => t.topic)).toEqual(['Kickoff', 'Contract and legal']);
    expect(() => toMeetingAnalysis({ ...MODEL_JSON, topics: [] }, SEGMENTS)).toThrow(ProviderCallError);
  });
});

describe('createClaudeAnalysisClients', () => {
  const input = { transcriptId: 't1', segments: SEGMENTS };

  it('makes one Claude call shared by topics, decisions, and action items', async () => {
    const { client, create } = fakeClient(reply(MODEL_JSON));
    const clients = createClaudeAnalysisClients({ client, timeoutMs: 1000 });
    const [topics, decisions, items] = await Promise.all([
      clients.topicSummarizationClient.summarizeTopics(input),
      clients.decisionExtractionClient.extractDecisions(input),
      clients.actionItemExtractionClient.extractActionItems(input),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toBeDefined();
    expect(topics).toHaveLength(2);
    expect(decisions).toHaveLength(1);
    expect(items).toHaveLength(2);
  });

  it('rejects malformed output, refusals, and truncation with clear classes, and retries after a failure', async () => {
    const malformed = createClaudeAnalysisClients({ client: fakeClient(reply('not json')).client, timeoutMs: 1000 });
    await expect(malformed.topicSummarizationClient.summarizeTopics(input)).rejects.toMatchObject({ errorClass: 'AnalysisContractViolation' });

    const refused = createClaudeAnalysisClients({ client: fakeClient(reply(MODEL_JSON, 'refusal')).client, timeoutMs: 1000 });
    await expect(refused.topicSummarizationClient.summarizeTopics(input)).rejects.toMatchObject({ errorClass: 'ModelRefused' });

    const truncated = createClaudeAnalysisClients({ client: fakeClient(reply(MODEL_JSON, 'max_tokens')).client, timeoutMs: 1000 });
    await expect(truncated.topicSummarizationClient.summarizeTopics(input)).rejects.toMatchObject({ errorClass: 'AnalysisTruncated' });

    let calls = 0;
    const flaky = fakeClient(async () => (++calls === 1 ? reply('broken')() : reply(MODEL_JSON)()));
    const retrying = createClaudeAnalysisClients({ client: flaky.client, timeoutMs: 1000 });
    await expect(retrying.topicSummarizationClient.summarizeTopics(input)).rejects.toBeInstanceOf(ProviderCallError);
    await expect(retrying.topicSummarizationClient.summarizeTopics(input)).resolves.toHaveLength(2);
  });

  it('reports a bad API key as AuthError without leaking the response', async () => {
    const authFail = fakeClient(async () => {
      throw new Anthropic.AuthenticationError(401, { error: { message: 'secret detail' } }, 'invalid x-api-key', new Headers());
    });
    const clients = createClaudeAnalysisClients({ client: authFail.client, timeoutMs: 1000 });
    const failure = clients.topicSummarizationClient.summarizeTopics(input);
    await expect(failure).rejects.toMatchObject({ errorClass: 'AuthError', message: 'Anthropic rejected ANTHROPIC_API_KEY.' });
  });
});

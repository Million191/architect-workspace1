import Anthropic from '@anthropic-ai/sdk';
import { findUnsupportedGenderedTerms, NEUTRAL_LANGUAGE_RULE } from './genderedLanguage';
import { createClaudeAnalysisClients, SYSTEM_PROMPT } from './claudeAnalysisClient';
import { createMeetingPipeline, createPipelineStores } from '../meetingPipelineService';
import { createDemoProviders } from '../demoProviders';

/** A transcript like the one that exposed the bug: a name, no pronouns, no gender stated anywhere. */
const SEGMENTS = [
  { startMs: 0, endMs: 5000, text: "Unidentified Speaker: Hi everyone, I'm Milen and I'll facilitate today." },
  { startMs: 5000, endMs: 9000, text: "Unidentified Speaker: We agreed to ship the report on Friday." },
];
const TRANSCRIPT_TEXT = SEGMENTS.map((s) => s.text).join(' ');

const analysisWith = (summary: string) => ({
  topics: [{ title: 'Opening', summary, firstSegment: 0, lastSegment: 1 }],
  decisions: [{ decision: 'Ship the report on Friday', rationale: '', approver: '', evidenceSegment: 1 }],
  actionItems: [],
});

const reply = (json: unknown) => ({
  stop_reason: 'end_turn',
  model: 'claude-sonnet-5-5',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'text', text: JSON.stringify(json) }],
});

function fakeClaude(...replies: unknown[]) {
  const create = jest.fn();
  replies.forEach((json) => create.mockResolvedValueOnce(reply(json)));
  return { create, client: { beta: { messages: { create } } } as unknown as Anthropic };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('findUnsupportedGenderedTerms', () => {
  it('flags gender the transcript never states', () => {
    expect(findUnsupportedGenderedTerms(['The facilitator, who introduces himself as Milen, welcomes everyone.'], TRANSCRIPT_TEXT)).toEqual(['himself']);
    expect(findUnsupportedGenderedTerms(['Milen opened; she then handed over to Mr. Lee.'], TRANSCRIPT_TEXT)).toEqual(['mr', 'she']);
  });

  it('accepts neutral wording, and does not trip on words that merely contain a pronoun', () => {
    const neutral = [
      'The facilitator, Milen, welcomes the attendees.',
      'The facilitator introduces themselves as Milen.',
      'Here is their plan; this is the other item; they will share it there.',
    ];
    expect(findUnsupportedGenderedTerms(neutral, TRANSCRIPT_TEXT)).toEqual([]);
  });

  it('allows a pronoun only when the transcript itself uses that family of words', () => {
    const transcript = `${TRANSCRIPT_TEXT} Priya said she will send the contract.`;
    expect(findUnsupportedGenderedTerms(['Priya will send the contract; she confirmed it.'], transcript)).toEqual([]);
    expect(findUnsupportedGenderedTerms(['Priya will send it; he confirmed it.'], transcript)).toEqual(['he']);
  });
});

describe('Claude analysis instructions and enforcement', () => {
  const input = { transcriptId: 't-gender', segments: SEGMENTS };

  it('tells Claude never to infer gender and to use names, roles, or they/them', () => {
    expect(SYSTEM_PROMPT).toContain(NEUTRAL_LANGUAGE_RULE);
    expect(NEUTRAL_LANGUAGE_RULE).toMatch(/never infer anyone's gender or pronouns from a name, a voice/);
    expect(NEUTRAL_LANGUAGE_RULE).toMatch(/they\/them/);
  });

  it('accepts neutral output in one call', async () => {
    const { client, create } = fakeClaude(analysisWith('The facilitator, Milen, welcomes the attendees.'));
    const topics = await createClaudeAnalysisClients({ client, timeoutMs: 1000 }).topicSummarizationClient.summarizeTopics(input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(topics[0].summary).toBe('The facilitator, Milen, welcomes the attendees.');
  });

  it('retries once with a correction when Claude assumes gender, and keeps the neutral rewrite', async () => {
    const { client, create } = fakeClaude(
      analysisWith('The facilitator, who introduces himself as Milen, welcomes attendees.'),
      analysisWith('The facilitator, Milen, welcomes the attendees.')
    );
    const topics = await createClaudeAnalysisClients({ client, timeoutMs: 1000 }).topicSummarizationClient.summarizeTopics(input);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].system).toMatch(/gendered words the transcript does not support \(himself\)/);
    expect(topics[0].summary).not.toMatch(/\b(he|him|his|himself|she|her|hers|herself)\b/i);
  });

  it('fails the draft rather than showing assumed gender if the retry still has it', async () => {
    const { client, create } = fakeClaude(
      analysisWith('The facilitator, who introduces himself as Milen, welcomes attendees.'),
      analysisWith('Milen opens the meeting; he welcomes attendees.')
    );
    const failure = createClaudeAnalysisClients({ client, timeoutMs: 1000 }).topicSummarizationClient.summarizeTopics(input);
    await expect(failure).rejects.toMatchObject({ errorClass: 'UngroundedGenderedLanguage' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('checks decisions and action items too, not only summaries', async () => {
    const gendered = { ...analysisWith('Opening.'), actionItems: [{ task: 'Milen will send her notes', owner: 'Milen', dueDate: '', priority: '', evidenceSegment: 0 }] };
    const { client, create } = fakeClaude(gendered, analysisWith('Opening.'));
    await createClaudeAnalysisClients({ client, timeoutMs: 1000 }).actionItemExtractionClient.extractActionItems(input);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('email drafts', () => {
  it('add no gendered wording of their own', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const pipeline = createMeetingPipeline(createDemoProviders(), createPipelineStores());
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + 2000, 4);
    header.write('WAVEfmt ', 8, 'ascii');
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(2000, 40);
    const run = await pipeline.draftMinutes({
      originalFilename: 'm.wav',
      buffer: Buffer.concat([header, Buffer.alloc(2000, 7), Buffer.from('gender-email')]),
      source: 'room_mic',
      attendeeNames: ['Milen', 'Priya'],
    });
    const withEmails = await pipeline.approveMinutes(run.runId, 'Reviewer');
    const transcriptText = withEmails.transcript.map((s) => s.text).join(' ');
    const bodies = withEmails.emails!.emails.flatMap((e) => [e.subject, e.body]);
    expect(findUnsupportedGenderedTerms(bodies, transcriptText)).toEqual([]);
  });
});

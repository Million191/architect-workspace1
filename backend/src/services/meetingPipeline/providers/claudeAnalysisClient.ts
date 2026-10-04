import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { RawTopicSegment, TopicSummarizationClient } from '../../discussionSummary/types';
import { DecisionExtractionClient, RawDecision } from '../../decisionExtraction/types';
import { ActionItemExtractionClient, RawActionItem } from '../../actionItemExtraction/types';
import { recordAuditEvent } from '../auditLog';
import { ProviderCallError } from './providerErrors';
import { findUnsupportedGenderedTerms, NEUTRAL_LANGUAGE_RULE } from './genderedLanguage';

export const CLAUDE_ANALYSIS_MODEL = 'claude-sonnet-5-5';

type Segment = { startMs: number; endMs: number; text: string };

export const SYSTEM_PROMPT = `You turn a meeting transcript into draft minutes for human review.

The transcript is the only source of truth. Each line is "[index] start-end Speaker: text". Speakers may be generic labels such as "Speaker A" or "Unidentified Speaker"; never replace a label with a real name unless the transcript itself says who that speaker is.

Rules:
- topics: group the conversation into consecutive topics in order. Give each a short title, a 1-2 sentence summary of what was actually said, and the index of its first and last line. Together the topics must cover every line from the first to the last, without gaps or overlap.
- decisions: only things the transcript shows were actually decided or agreed, not proposals or open questions. evidenceSegment is the index of the line where the decision is stated. rationale only if a reason is stated. approver only if the transcript shows who made or approved the decision (a name, or the speaker label of the person who decided); otherwise "".
- actionItems: only tasks someone was asked to do, committed to do, or that the meeting explicitly said still needs doing (including tasks stated to have no owner yet). owner only if the transcript names who will do it, or the committing speaker's label for "I'll ..."; otherwise "". dueDate only if an explicit calendar date is stated, written as YYYY-MM-DD; relative phrases like "Friday" or "next week" are not dates, so use "" and keep the phrase in the task text. priority only if urgency is stated ("high", "medium", "low"); otherwise "". evidenceSegment is the index of the line where the task is assigned.
${NEUTRAL_LANGUAGE_RULE}
- Unknown means "". Do not guess, infer, or fill gaps. An empty list is a correct answer when nothing qualifies.`;

/** JSON schema for structured outputs. Unknown values are "" rather than null to keep the schema simple; they are dropped below. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics', 'decisions', 'actionItems'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'firstSegment', 'lastSegment'],
        properties: { title: { type: 'string' }, summary: { type: 'string' }, firstSegment: { type: 'integer' }, lastSegment: { type: 'integer' } },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['decision', 'rationale', 'approver', 'evidenceSegment'],
        properties: { decision: { type: 'string' }, rationale: { type: 'string' }, approver: { type: 'string' }, evidenceSegment: { type: 'integer' } },
      },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'owner', 'dueDate', 'priority', 'evidenceSegment'],
        properties: {
          task: { type: 'string' },
          owner: { type: 'string' },
          dueDate: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low', ''] },
          evidenceSegment: { type: 'integer' },
        },
      },
    },
  },
} as const;

/** Runtime check of the model's JSON — the contract is enforced here, not trusted. */
const analysisSchema = z.object({
  topics: z.array(z.object({ title: z.string(), summary: z.string(), firstSegment: z.number().int(), lastSegment: z.number().int() })),
  decisions: z.array(z.object({ decision: z.string(), rationale: z.string(), approver: z.string(), evidenceSegment: z.number().int() })),
  actionItems: z.array(
    z.object({ task: z.string(), owner: z.string(), dueDate: z.string(), priority: z.enum(['high', 'medium', 'low', '']), evidenceSegment: z.number().int() })
  ),
});
type ModelAnalysis = z.infer<typeof analysisSchema>;

/** Every piece of generated prose in an analysis — what the gendered-language check reads. */
function generatedTexts(model: ModelAnalysis): string[] {
  return [
    ...model.topics.flatMap((t) => [t.title, t.summary]),
    ...model.decisions.flatMap((d) => [d.decision, d.rationale]),
    ...model.actionItems.map((a) => a.task),
  ];
}

export interface MeetingAnalysis {
  topics: RawTopicSegment[];
  decisions: RawDecision[];
  actionItems: RawActionItem[];
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const blankToUndefined = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());

/**
 * Maps the model's line indexes back onto real transcript timestamps. Topic ranges are rebuilt
 * from the transcript's own segment bounds so they are always contiguous; an out-of-range evidence
 * index drops the timestamp (the services then flag the item) instead of inventing one.
 */
export function toMeetingAnalysis(model: ModelAnalysis, segments: Segment[]): MeetingAnalysis {
  const inRange = (i: number) => i >= 0 && i < segments.length;
  const starts = model.topics
    .filter((t) => inRange(t.firstSegment))
    .sort((a, b) => a.firstSegment - b.firstSegment)
    .filter((t, i, all) => i === 0 || t.firstSegment > all[i - 1].firstSegment);
  if (starts.length === 0) {
    throw new ProviderCallError('AnalysisContractViolation', 'Claude returned no usable topics for this transcript.');
  }
  const topics = starts.map((t, i) => ({
    topic: t.title,
    summary: t.summary,
    startMs: i === 0 ? segments[0].startMs : segments[t.firstSegment].startMs,
    endMs: i === starts.length - 1 ? segments[segments.length - 1].endMs : segments[starts[i + 1].firstSegment].startMs,
  }));

  const isoDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(Date.parse(value.trim())) ? value.trim() : undefined);
  return {
    topics,
    decisions: model.decisions.map((d) => ({
      decision: d.decision,
      rationale: blankToUndefined(d.rationale),
      approver: blankToUndefined(d.approver),
      timestampMs: inRange(d.evidenceSegment) ? segments[d.evidenceSegment].startMs : undefined,
    })),
    actionItems: model.actionItems.map((a) => ({
      task: a.task,
      owner: blankToUndefined(a.owner),
      dueDate: isoDate(a.dueDate),
      priority: a.priority === '' ? undefined : a.priority,
      // A task just raised in the meeting is open by definition; this is not an inferred fact.
      status: 'open' as const,
      sourceTimestampMs: inRange(a.evidenceSegment) ? segments[a.evidenceSegment].startMs : undefined,
    })),
  };
}

/** Translates SDK errors into stable classes with messages safe for the page. Most specific first. */
function classifyClaudeError(error: unknown): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new ProviderCallError('AuthError', 'Anthropic rejected ANTHROPIC_API_KEY.');
  if (error instanceof Anthropic.PermissionDeniedError) return new ProviderCallError('AuthError', 'This Anthropic API key may not use the requested model.');
  if (error instanceof Anthropic.RateLimitError) return new ProviderCallError('RateLimitError', 'Anthropic rate limit reached; try again shortly.');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderCallError('UpstreamTimeoutError', 'Claude did not respond in time.');
  if (error instanceof Anthropic.APIConnectionError) return new ProviderCallError('UpstreamUnavailable', 'Could not reach the Anthropic API.');
  if (error instanceof Anthropic.APIError) {
    return (error.status ?? 0) >= 500
      ? new ProviderCallError('UpstreamUnavailable', `The Anthropic API is unavailable (HTTP ${error.status}).`)
      : new ProviderCallError('AnthropicRequestError', `The Anthropic API rejected the request (HTTP ${error.status}).`);
  }
  return new ProviderCallError('UnknownError', error instanceof Error ? error.message : String(error));
}

export interface ClaudeAnalysisConfig {
  client?: Anthropic;
  /** Per-request timeout for the SDK; the SDK itself retries 429/5xx/connection errors twice. */
  timeoutMs: number;
}

/**
 * One Claude call per transcript produces topics, decisions, and action items together (one
 * consistent reading of the meeting, one charge). The three clients below share that result,
 * memoized per transcript; a failed call is forgotten so retrying re-asks Claude.
 */
export function createClaudeAnalysisClients(config: ClaudeAnalysisConfig): {
  topicSummarizationClient: TopicSummarizationClient;
  decisionExtractionClient: DecisionExtractionClient;
  actionItemExtractionClient: ActionItemExtractionClient;
} {
  const client = config.client ?? new Anthropic({ timeout: config.timeoutMs, maxRetries: 2 });
  const inFlight = new Map<string, Promise<MeetingAnalysis>>();

  /** One structured-output request. `correction` is appended to the system prompt on the single grounding retry. */
  async function requestAnalysis(lines: string, correction?: string) {
    const response = await client.beta.messages.create({
      model: CLAUDE_ANALYSIS_MODEL,
      max_tokens: 16000,
      system: correction ? `${SYSTEM_PROMPT}\n\n${correction}` : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `<transcript>\n${lines}\n</transcript>` }],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      // Server-side refusal fallback: if Sonnet declines, the API re-runs the request on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') {
      throw new ProviderCallError('ModelRefused', 'Claude declined to analyze this transcript.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderCallError('AnalysisTruncated', 'Claude ran out of output space before finishing the analysis.');
    }
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    try {
      return { response, parsed: analysisSchema.parse(JSON.parse(text)) };
    } catch {
      throw new ProviderCallError('AnalysisContractViolation', 'Claude returned analysis that did not match the expected format.');
    }
  }

  async function callClaude(transcriptId: string, segments: Segment[]): Promise<MeetingAnalysis> {
    const lines = segments.map((s, i) => `[${i}] ${clock(s.startMs)}-${clock(s.endMs)} ${s.text.trim() || '[inaudible]'}`).join('\n');
    const transcriptText = segments.map((s) => s.text).join(' ');
    const started = Date.now();
    try {
      let { response, parsed } = await requestAnalysis(lines);
      // Gender is never known from this transcript. Unsupported gendered words get exactly one
      // corrective retry; if they persist, the draft fails loudly instead of showing them.
      let unsupported = findUnsupportedGenderedTerms(generatedTexts(parsed), transcriptText);
      if (unsupported.length > 0) {
        recordAuditEvent({ event: 'claude_analysis_gendered_language_retry', outcome: 'success', resourceId: transcriptId, context: { terms: unsupported } });
        ({ response, parsed } = await requestAnalysis(
          lines,
          `Your previous answer used gendered words the transcript does not support (${unsupported.join(', ')}). Rewrite without them: use names, roles, speaker labels, or they/them.`
        ));
        unsupported = findUnsupportedGenderedTerms(generatedTexts(parsed), transcriptText);
        if (unsupported.length > 0) {
          throw new ProviderCallError(
            'UngroundedGenderedLanguage',
            `Claude kept assuming gender (${unsupported.join(', ')}) that the transcript does not support; the draft was not created.`
          );
        }
      }
      const analysis = toMeetingAnalysis(parsed, segments);
      recordAuditEvent({
        event: 'claude_analysis_completed',
        outcome: 'success',
        resourceId: transcriptId,
        durationMs: Date.now() - started,
        context: {
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          topics: analysis.topics.length,
          decisions: analysis.decisions.length,
          actionItems: analysis.actionItems.length,
        },
      });
      return analysis;
    } catch (error) {
      const classified = classifyClaudeError(error);
      recordAuditEvent({
        event: 'claude_analysis_failed',
        outcome: 'failure',
        resourceId: transcriptId,
        errorClass: classified.errorClass,
        durationMs: Date.now() - started,
        context: { message: classified.message },
      });
      throw classified;
    }
  }

  function analyze(transcriptId: string, segments: Segment[]): Promise<MeetingAnalysis> {
    const existing = inFlight.get(transcriptId);
    if (existing) return existing;
    const pending = callClaude(transcriptId, segments);
    inFlight.set(transcriptId, pending);
    pending.catch(() => inFlight.delete(transcriptId));
    return pending;
  }

  return {
    topicSummarizationClient: { summarizeTopics: async ({ transcriptId, segments }) => (await analyze(transcriptId, segments)).topics },
    decisionExtractionClient: { extractDecisions: async ({ transcriptId, segments }) => (await analyze(transcriptId, segments)).decisions },
    actionItemExtractionClient: { extractActionItems: async ({ transcriptId, segments }) => (await analyze(transcriptId, segments)).actionItems },
  };
}

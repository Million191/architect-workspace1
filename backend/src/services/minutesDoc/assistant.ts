import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_ANALYSIS_MODEL } from '../meetingPipeline/providers/claudeAnalysisClient';
import { findUnsupportedGenderedTerms, NEUTRAL_LANGUAGE_RULE } from '../meetingPipeline/providers/genderedLanguage';
import { escapeHtml, htmlToText, sanitizeHtml } from './html';

/** "AI help" on one section. The result is only ever a suggestion the reviewer accepts or rejects. */
export type AssistMode = 'regenerate' | 'shorter' | 'formal';

export interface AssistInput {
  mode: AssistMode;
  title: string;
  html: string;
  /** Transcript lines for this section ("m:ss Speaker: text"), the source of truth for "Regenerate". */
  transcript: string[];
}

export interface MinutesAssistant {
  readonly kind: 'claude' | 'demo';
  suggest(input: AssistInput): Promise<string>;
}

export class AssistError extends Error {
  constructor(readonly errorClass: 'AssistUnavailable' | 'AssistFailed' | 'ModelRefused', message: string) {
    super(message);
  }
}

const INSTRUCTION: Record<AssistMode, string> = {
  regenerate: 'Rewrite this section of the minutes from the transcript excerpt: what was actually said, decided, and agreed, in 1–4 short paragraphs or a bullet list.',
  shorter: 'Make this section of the minutes shorter: keep every fact, decision, name, date, and number; remove repetition and filler. Aim for about half the length.',
  formal: 'Rewrite this section of the minutes in a more formal, professional register suitable for a board pack. Keep every fact, name, date, and number. No new information.',
};

const SYSTEM = `You help a person edit meeting minutes. You return only the rewritten section body as simple HTML using <p>, <ul>, <ol>, <li>, <strong>, <em> — no headings, no title, no commentary, no code fences.
Rules:
- Never add facts that are not in the section text or the transcript excerpt.
${NEUTRAL_LANGUAGE_RULE}`;

/** Claude-backed suggestions (needs ANTHROPIC_API_KEY). One corrective retry if gendered words slip in. */
export function claudeAssistant(client: Anthropic = new Anthropic({ timeout: 60000, maxRetries: 2 })): MinutesAssistant {
  async function ask(input: AssistInput, correction?: string): Promise<string> {
    const user = `<section_title>${input.title}</section_title>\n<section_text>\n${htmlToText(input.html) || '(empty)'}\n</section_text>\n<transcript_excerpt>\n${input.transcript.join('\n') || '(none)'}\n</transcript_excerpt>\n\n${INSTRUCTION[input.mode]}`;
    const response = await client.messages.create({
      model: CLAUDE_ANALYSIS_MODEL, max_tokens: 2000,
      system: correction ? `${SYSTEM}\n\n${correction}` : SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') throw new AssistError('ModelRefused', 'Claude declined to rewrite this section.');
    return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').replace(/^```(?:html)?\s*|\s*```$/g, '');
  }
  return {
    kind: 'claude',
    async suggest(input) {
      const source = `${htmlToText(input.html)} ${input.transcript.join(' ')}`;
      let html = sanitizeHtml(await ask(input));
      const unsupported = findUnsupportedGenderedTerms([htmlToText(html)], source);
      if (unsupported.length) html = sanitizeHtml(await ask(input, `Your previous answer used gendered words the text does not support (${unsupported.join(', ')}). Use names, roles, or they/them.`));
      if (findUnsupportedGenderedTerms([htmlToText(html)], source).length) throw new AssistFailedError();
      if (!htmlToText(html)) throw new AssistError('AssistFailed', 'The suggestion came back empty. Try again.');
      return html;
    },
  };
}

class AssistFailedError extends AssistError {
  constructor() { super('AssistFailed', 'The suggestion used wording that assumes people’s gender, so it wasn’t shown. Try again.'); }
}

/** Deterministic stand-in for demo mode and tests: never calls out, always a visible change. */
export function demoAssistant(): MinutesAssistant {
  const sentences = (t: string) => t.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const CONTRACTIONS: Array<[RegExp, string]> = [[/\bcan't\b/gi, 'cannot'], [/\bwon't\b/gi, 'will not'], [/\bdon't\b/gi, 'do not'], [/\bit's\b/gi, 'it is'], [/\bwe'll\b/gi, 'we will'], [/\blet's\b/gi, 'let us'], [/n't\b/gi, ' not'], [/\bok\b/gi, 'acceptable']];
  return {
    kind: 'demo',
    async suggest({ mode, html, transcript }) {
      const text = htmlToText(html);
      if (mode === 'regenerate') return `<p>${escapeHtml(transcript.map((l) => l.replace(/^\S+\s+/, '')).join(' ') || text || 'Nothing was said in this part of the meeting.')}</p>`;
      if (mode === 'shorter') return `<p>${escapeHtml(sentences(text).slice(0, Math.max(1, Math.ceil(sentences(text).length / 2))).join(' ') || text)}</p>`;
      let formal = text;
      for (const [re, to] of CONTRACTIONS) formal = formal.replace(re, to);
      return `<p>${escapeHtml(`The meeting noted the following: ${formal.charAt(0).toLowerCase()}${formal.slice(1)}`)}</p>`;
    },
  };
}

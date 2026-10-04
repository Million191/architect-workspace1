/**
 * Deterministic check that generated minutes do not assume anyone's gender. The transcript gives
 * no reliable speaker identity, gender, or pronouns (local Whisper does not even separate
 * speakers), so a gendered word in Claude's output is only acceptable when the transcript itself
 * uses that same family of words — e.g. a participant saying "she'll send it" supports "she".
 *
 * Limitation (deliberate, documented): support is checked per word family across the whole
 * transcript, not per person, so a transcript that says "he" about one person would let "he"
 * through for another. It blocks the common failure — gender invented from a name or a voice —
 * without needing speaker identity the system does not have.
 */
const FAMILIES: Record<string, string[]> = {
  masculine: ['he', 'him', 'his', 'himself', 'mr', 'sir', 'gentleman', 'gentlemen', 'chairman'],
  feminine: ['she', 'her', 'hers', 'herself', 'mrs', 'ms', 'madam', 'lady', 'ladies', 'chairwoman'],
};

function wordsIn(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
}

/** Gendered words used in `outputTexts` whose family never appears in `transcriptText`. Empty means OK. */
export function findUnsupportedGenderedTerms(outputTexts: string[], transcriptText: string): string[] {
  const transcriptWords = wordsIn(transcriptText);
  const outputWords = wordsIn(outputTexts.join(' '));
  const unsupported: string[] = [];
  for (const family of Object.values(FAMILIES)) {
    const supported = family.some((word) => transcriptWords.has(word));
    if (supported) continue;
    unsupported.push(...family.filter((word) => outputWords.has(word)));
  }
  return unsupported;
}

/** The instruction given to Claude, kept here so the rule and its check live together. */
export const NEUTRAL_LANGUAGE_RULE = `- People: never infer anyone's gender or pronouns from a name, a voice, a role, or any other assumption — the transcript carries no reliable speaker identity or gender. Refer to people by their explicitly stated name (e.g. "The facilitator, Milen, welcomes the attendees"), by their role or speaker label, or with "they/them/their/themselves". Use he/him/his or she/her/hers (or Mr./Ms./Mrs.) only when the transcript itself uses those words for that person. This applies to topic titles and summaries, decisions, rationales, and action item text.`;

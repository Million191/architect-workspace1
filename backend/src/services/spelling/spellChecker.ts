import { existsSync, readFileSync } from 'fs';
import path from 'path';
import nspell from 'nspell';

/** One possible mistake. `offset`/`length` are JavaScript string indices into the checked text. */
export interface SpellingIssue {
  word: string;
  offset: number;
  length: number;
  suggestions: string[];
}

export class DictionaryUnavailableError extends Error {
  readonly errorClass = 'DictionaryUnavailableError';
}

/**
 * dictionary-en only exports an ESM loader; its .aff/.dic files are read directly from node_modules
 * (resolved the same way `require` would look) so this CommonJS server needs no ESM interop.
 */
function readEnglishDictionary(): { aff: Buffer; dic: Buffer } {
  const dirs = require.resolve.paths('dictionary-en') ?? [];
  for (const dir of dirs) {
    const base = path.join(dir, 'dictionary-en');
    if (existsSync(path.join(base, 'index.aff')) && existsSync(path.join(base, 'index.dic'))) {
      return { aff: readFileSync(path.join(base, 'index.aff')), dic: readFileSync(path.join(base, 'index.dic')) };
    }
  }
  throw new DictionaryUnavailableError('The English dictionary (dictionary-en) is not installed. Run npm install in backend/.');
}

/** Words, with inner apostrophes ("don't", "Sara's"). Digits and underscores end a word. */
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
/** Spans never checked: URLs, email addresses, @mentions, and inline code. */
const SKIP_SPANS = /(?:https?:\/\/|www\.)\S+|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+|@\w+|`[^`]*`/g;

function skippedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(SKIP_SPANS)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return ranges;
}

/**
 * Hunspell-compatible checking (nspell + dictionary-en). The checker never changes text; it only
 * reports words it doesn't know, with suggestions. Known words include the team dictionary.
 */
export function createSpellChecker() {
  let speller: ReturnType<typeof nspell> | undefined;
  const suggestionCache = new Map<string, string[]>();

  function engine() {
    if (!speller) speller = nspell(readEnglishDictionary());
    return speller;
  }

  /** Acronyms (ALL CAPS up to 6 letters), single letters, and words in `known` are never flagged. */
  function isKnown(word: string, known: Set<string>): boolean {
    const plain = word.replace(/’/g, "'");
    if (plain.length < 2 || /^[A-Z]{2,6}s?$/.test(plain)) return true;
    const lower = plain.toLowerCase();
    if (known.has(lower) || known.has(lower.replace(/'s$/, ''))) return true;
    const s = engine();
    return s.correct(plain) || s.correct(lower) || (plain.endsWith("'s") && s.correct(plain.slice(0, -2)));
  }

  function suggest(word: string): string[] {
    const cached = suggestionCache.get(word);
    if (cached) return cached;
    const found = engine().suggest(word.replace(/’/g, "'")).slice(0, 5);
    if (suggestionCache.size > 5000) suggestionCache.clear();
    suggestionCache.set(word, found);
    return found;
  }

  /** `known`: lower-cased extra words (team dictionary + names + project terms). */
  function check(text: string, known: Set<string>): SpellingIssue[] {
    const skip = skippedRanges(text);
    const issues: SpellingIssue[] = [];
    for (const m of text.matchAll(WORD)) {
      const offset = m.index ?? 0, word = m[0];
      if (skip.some(([a, b]) => offset >= a && offset < b)) continue;
      // Part of something like "Q4" or "v2beta": not a word on its own.
      if (/[0-9_]/.test(text[offset - 1] ?? '') || /[0-9_]/.test(text[offset + word.length] ?? '')) continue;
      if (isKnown(word, known)) continue;
      issues.push({ word, offset, length: word.length, suggestions: suggest(word) });
    }
    return issues;
  }

  return { check, warmUp: () => void engine() };
}

export type SpellChecker = ReturnType<typeof createSpellChecker>;

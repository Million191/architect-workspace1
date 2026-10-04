/**
 * "Did you mean" built from the app's own vocabulary (titles, participant names, transcript and
 * minutes words), so names and project terms are known words and are never "corrected".
 */

/** Lower-cased word tokens. Unicode letters/digits, so "Zoë" and "Q4" stay whole. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((t) => t.replace(/’/g, "'"));
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition), stopping early once the
 * distance must exceed `max`. Returns max + 1 for "too far".
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prevPrev = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prevPrev[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** Short words tolerate one typo; longer words two. Words under 3 letters are never corrected. */
export function allowedEdits(word: string): number {
  if (word.length < 3) return 0;
  return word.length <= 5 ? 1 : 2;
}

export class Vocabulary {
  private readonly counts = new Map<string, number>();

  add(text: string): void {
    for (const t of tokenize(text)) this.counts.set(t, (this.counts.get(t) ?? 0) + 1);
  }

  has(word: string): boolean {
    return this.counts.has(word.toLowerCase());
  }

  get size(): number {
    return this.counts.size;
  }

  /**
   * Closest known word, or undefined when the word is already known (or nothing is close). Ties go to
   * the smaller distance, then the more frequent word, then alphabetical — deterministic.
   */
  suggest(word: string): string | undefined {
    const w = word.toLowerCase();
    const max = allowedEdits(w);
    if (!max || this.counts.has(w) || /^\d+$/.test(w)) return undefined;
    let best: { word: string; d: number; n: number } | undefined;
    for (const [candidate, n] of this.counts) {
      if (candidate.length < 3 || /^\d+$/.test(candidate)) continue;
      const d = editDistance(w, candidate, max);
      if (d > max) continue;
      if (!best || d < best.d || (d === best.d && (n > best.n || (n === best.n && candidate < best.word)))) best = { word: candidate, d, n };
    }
    return best?.word;
  }

  /** The query with each unknown word replaced by its suggestion, or undefined when nothing changes. */
  correct(query: string): string | undefined {
    const words = tokenize(query);
    let changed = false;
    const fixed = words.map((w) => {
      const s = this.suggest(w);
      if (s) changed = true;
      return s ?? w;
    });
    return changed ? fixed.join(' ') : undefined;
  }
}

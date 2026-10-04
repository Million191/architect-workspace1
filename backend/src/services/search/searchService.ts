import { createHash } from 'crypto';
import MiniSearch, { SearchResult } from 'minisearch';
import { SearchDoc, SearchDocType } from './searchDocuments';
import { tokenize, Vocabulary } from './spelling';

export type SearchGroupKey = 'meetings' | 'transcripts' | 'actionItems';

const GROUPS: Array<{ key: SearchGroupKey; label: string; type: SearchDocType }> = [
  { key: 'meetings', label: 'Meetings', type: 'meeting' },
  { key: 'transcripts', label: 'Transcripts', type: 'transcript' },
  { key: 'actionItems', label: 'Action items', type: 'action' },
];

export interface SearchHit {
  id: string;
  type: SearchDocType;
  title: string;
  snippet: string;
  /** Index words this hit matched; the page highlights words that start with them. */
  terms: string[];
  runId?: string;
  scheduleId?: string;
  meetingTitle?: string;
  speaker?: string;
  startMs?: number;
  date?: string;
  status?: string;
}

export interface SearchResponse {
  query: string;
  /** What the results are actually for (differs from `query` when a correction was applied). */
  searchedFor: string;
  /**
   * `showing`: the typed words had no results, so results are for the correction ("Showing results
   * for budget. Search instead for budjet"). `suggest`: both have results ("Did you mean budget?").
   */
  correction?: { text: string; mode: 'showing' | 'suggest' };
  total: number;
  groups: Array<{ key: SearchGroupKey; label: string; total: number; items: SearchHit[] }>;
}

export interface SearchOptions {
  /** Only this group, e.g. for "See all". */
  group?: SearchGroupKey;
  /** Items per group (default 3). */
  limit?: number;
  /** Search exactly what was typed: no correction, no fuzzy fallback ("Search instead for …"). */
  exact?: boolean;
}

function hashDoc(d: SearchDoc): string {
  return createHash('sha1').update(JSON.stringify(d)).digest('hex');
}

/** ~160 characters around the first matched word, with ellipses where it was cut. */
export function snippet(text: string, terms: string[], width = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean;
  const lower = clean.toLowerCase();
  const hit = terms.map((t) => lower.search(new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'))).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - Math.floor(width / 3), clean.length - width));
  return (start > 0 ? '…' : '') + clean.slice(start, start + width).trim() + (start + width < clean.length ? '…' : '');
}

/**
 * Search over meetings (titles, participants, dates, minutes), transcripts, and action items.
 * `sync` keeps the index in step with the data by adding, replacing, or removing only the documents
 * whose content changed, so calling it before every search is cheap and never misses an update.
 */
export function createSearchService() {
  const index = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: ['title', 'text', 'people', 'when'],
    storeFields: ['id', 'type', 'title', 'text', 'runId', 'scheduleId', 'meetingTitle', 'speaker', 'startMs', 'date', 'status', 'participantNames'],
    tokenize: (text) => tokenize(text),
    processTerm: (term) => term.toLowerCase(),
    searchOptions: { boost: { title: 3, people: 2 }, prefix: true, combineWith: 'AND' },
  });
  const hashes = new Map<string, string>();
  let vocabulary = new Vocabulary();

  function sync(docs: SearchDoc[]): { added: number; updated: number; removed: number } {
    const seen = new Set<string>();
    let added = 0, updated = 0, removed = 0;
    for (const d of docs) {
      seen.add(d.id);
      const h = hashDoc(d), old = hashes.get(d.id);
      if (old === h) continue;
      if (old) { index.replace(d); updated++; } else { index.add(d); added++; }
      hashes.set(d.id, h);
    }
    for (const id of [...hashes.keys()]) {
      if (!seen.has(id)) { index.discard(id); hashes.delete(id); removed++; }
    }
    if (added || updated || removed || !vocabulary.size) {
      vocabulary = new Vocabulary();
      for (const d of docs) vocabulary.add(`${d.title} ${d.text} ${d.people}`);
    }
    return { added, updated, removed };
  }

  function run(q: string, fuzzy: boolean, typeFilter?: SearchDocType): SearchResult[] {
    return index.search(q, { fuzzy: fuzzy ? 0.25 : false, filter: typeFilter ? (r) => r.type === typeFilter : undefined });
  }

  function toHit(r: SearchResult, queryTerms: string[]): SearchHit {
    const terms = [...new Set([...r.terms, ...queryTerms])];
    // A meeting found by a participant (not by its minutes or agenda) explains itself: "With Sara Lee, Tom Ward".
    const fields = new Set(Object.values(r.match as Record<string, string[]>).flat());
    const byPerson = r.type === 'meeting' && fields.has('people') && !fields.has('text') && r.participantNames;
    const text = byPerson ? `With ${r.participantNames}` : r.type === 'action' ? r.meetingTitle ?? '' : r.text ?? '';
    return {
      id: r.id, type: r.type, title: r.title || r.meetingTitle || '', snippet: snippet(text, terms), terms,
      runId: r.runId, scheduleId: r.scheduleId, meetingTitle: r.meetingTitle, speaker: r.speaker, startMs: r.startMs, date: r.date, status: r.status,
    };
  }

  function search(query: string, opts: SearchOptions = {}): SearchResponse {
    const q = query.trim();
    const limit = opts.limit ?? 3;
    const typeFilter = opts.group ? GROUPS.find((g) => g.key === opts.group)?.type : undefined;
    let searchedFor = q, correction: SearchResponse['correction'];
    let results = q ? run(q, false, typeFilter) : [];
    if (q && !opts.exact) {
      const corrected = vocabulary.correct(q);
      const alt = corrected ? run(corrected, false, typeFilter) : [];
      if (!results.length && alt.length) { results = alt; searchedFor = corrected as string; correction = { text: corrected as string, mode: 'showing' }; }
      else if (results.length && alt.length) correction = { text: corrected as string, mode: 'suggest' };
      else if (!results.length) results = run(q, true, typeFilter); // nothing close in the vocabulary: plain fuzzy match
    }
    const queryTerms = tokenize(searchedFor);
    const groups = GROUPS.filter((g) => !opts.group || g.key === opts.group).map((g) => {
      const all = results.filter((r) => r.type === g.type);
      return { key: g.key, label: g.label, total: all.length, items: all.slice(0, limit).map((r) => toHit(r, queryTerms)) };
    });
    return { query: q, searchedFor, correction, total: groups.reduce((n, g) => n + g.total, 0), groups };
  }

  return { sync, search, vocabularySize: () => vocabulary.size, documentCount: () => index.documentCount };
}

export type SearchService = ReturnType<typeof createSearchService>;

import { createSearchService, snippet } from './searchService';
import { SearchDoc } from './searchDocuments';
import { editDistance, tokenize, Vocabulary } from './spelling';

const docs = (): SearchDoc[] => [
  { id: 'm:1', type: 'meeting', title: 'Q4 budget review', text: 'We agreed the marketing budget moves to Q1.', people: 'Sara Lee sara.lee@acme.com Tom Ward', when: '2026-10-04 October Oct 4 2026 Sunday', runId: '1', date: '2026-10-04' },
  { id: 't:1:0', type: 'transcript', title: '', meetingTitle: 'Q4 budget review', text: 'Let us look at the budget for Kubernetes migration.', people: 'Sara Lee', when: '', runId: '1', speaker: 'Sara Lee', startMs: 65000 },
  { id: 't:1:1', type: 'transcript', title: '', meetingTitle: 'Q4 budget review', text: 'Priyanka owns the Zephyr rollout.', people: 'Tom Ward', when: '', runId: '1', speaker: 'Tom Ward', startMs: 130000 },
  { id: 'a:1:0', type: 'action', title: 'Send the revised budget to finance', text: 'Send the revised budget to finance', people: 'Tom Ward', when: '', runId: '1', meetingTitle: 'Q4 budget review' },
  { id: 'm:2', type: 'meeting', title: 'Design sync', text: 'Navigation changes.', people: 'Ann Bo ann.bo@acme.com', when: '2026-10-02 October Oct 2 2026 Friday', runId: '2', date: '2026-10-02' },
];

function service() {
  const s = createSearchService();
  s.sync(docs());
  return s;
}

describe('spelling helpers', () => {
  it('tokenizes words, numbers, and apostrophes', () => {
    expect(tokenize("Sara's Q4 budget — Zoë, 2026!")).toEqual(["sara's", 'q4', 'budget', 'zoë', '2026']);
  });
  it('edit distance counts substitutions, insertions, deletions, and transpositions, stopping early', () => {
    expect(editDistance('budjet', 'budget', 2)).toBe(1);
    expect(editDistance('bugdet', 'budget', 2)).toBe(1); // transposition
    expect(editDistance('budge', 'budget', 2)).toBe(1);
    expect(editDistance('kitten', 'sitting', 2)).toBe(3); // max + 1 = "too far"
    expect(editDistance('a', 'abcdef', 2)).toBe(3);
  });
  it('never "corrects" known names, project terms, short words, or numbers', () => {
    const v = new Vocabulary();
    v.add('Priyanka owns the Zephyr rollout budget');
    expect(v.suggest('priyanka')).toBeUndefined();
    expect(v.suggest('zephyr')).toBeUndefined();
    expect(v.suggest('to')).toBeUndefined();
    expect(v.suggest('2027')).toBeUndefined();
    expect(v.suggest('budjet')).toBe('budget');
    expect(v.suggest('zepyhr')).toBe('zephyr');
    expect(v.suggest('xxxxxxxx')).toBeUndefined();
    expect(v.correct('the budjet')).toBe('the budget');
    expect(v.correct('the budget')).toBeUndefined();
  });
});

describe('search service', () => {
  it('groups results into meetings, transcripts, and action items (3 each) with totals', () => {
    const r = service().search('budget');
    expect(r.correction).toBeUndefined();
    expect(r.groups.map((g) => [g.key, g.total])).toEqual([['meetings', 1], ['transcripts', 1], ['actionItems', 1]]);
    const t = r.groups[1].items[0];
    expect(t).toMatchObject({ type: 'transcript', title: 'Q4 budget review', speaker: 'Sara Lee', startMs: 65000, runId: '1' });
    expect(t.terms).toContain('budget');
    expect(r.groups[2].items[0].snippet).toBe('Q4 budget review'); // action items show their meeting
  });

  it('finds participants by name or email, dates by month or ISO, and minutes text', () => {
    const s = service();
    expect(s.search('ann.bo@acme.com').groups[0].items.map((i) => i.title)).toEqual(['Design sync']);
    expect(s.search('tom ward').groups[0].items.map((i) => i.title)).toEqual(['Q4 budget review']);
    expect(s.search('friday').groups[0].items.map((i) => i.title)).toEqual(['Design sync']);
    expect(s.search('2026-10-04').groups[0].items.map((i) => i.title)).toEqual(['Q4 budget review']);
    expect(s.search('marketing').groups[0].total).toBe(1);
    expect(s.search('kube').groups[1].total).toBe(1); // prefix as you type
  });

  it('typo with no exact results → results for the correction, with “Showing results for”', () => {
    const r = service().search('budjet');
    expect(r.correction).toEqual({ text: 'budget', mode: 'showing' });
    expect(r.searchedFor).toBe('budget');
    expect(r.total).toBe(3);
  });

  it('“Search instead for” (exact) searches only what was typed', () => {
    const r = service().search('budjet', { exact: true });
    expect(r.correction).toBeUndefined();
    expect(r.total).toBe(0);
  });

  it('a word that exists in the meetings is never corrected, even if it looks like a typo', () => {
    const s = createSearchService();
    s.sync(docs());
    expect(s.search('revew').correction).toEqual({ text: 'review', mode: 'showing' });
    s.sync([...docs(), { id: 'm:10', type: 'meeting', title: 'Revew of the old spelling', text: '', people: '', when: '' }]);
    const r = s.search('revew');
    expect(r.correction).toBeUndefined();
    expect(r.groups[0].items.map((i) => i.title)).toEqual(['Revew of the old spelling']);
  });

  it('suggests (“Did you mean”) when the typed words match by prefix but a closer whole word exists', () => {
    const s = createSearchService();
    s.sync([
      { id: 'm:1', type: 'meeting', title: 'Plan', text: 'planing session', people: '', when: '' },
      { id: 'm:2', type: 'meeting', title: 'Planning review', text: 'planning planning planning', people: '', when: '' },
    ]);
    const r = s.search('plannin');
    expect(r.total).toBeGreaterThan(0);
    expect(r.correction).toEqual({ text: 'planning', mode: 'suggest' });
  });

  it('nothing close in the vocabulary or the fuzzy index: empty, no correction offered', () => {
    const r = service().search('qqqqqqqq');
    expect(r.total).toBe(0);
    expect(r.correction).toBeUndefined();
  });

  it('see all: one group, a larger limit', () => {
    const s = createSearchService();
    s.sync(Array.from({ length: 8 }, (_, i) => ({ id: `t:x:${i}`, type: 'transcript' as const, title: 'X', text: `budget line ${i}`, people: '', when: '' })));
    expect(s.search('budget').groups[1].items).toHaveLength(3);
    const all = s.search('budget', { group: 'transcripts', limit: 50 });
    expect(all.groups.map((g) => g.key)).toEqual(['transcripts']);
    expect(all.groups[0].items).toHaveLength(8);
  });

  it('sync updates only what changed, removes what is gone, and is idempotent', () => {
    const s = createSearchService();
    expect(s.sync(docs())).toEqual({ added: 5, updated: 0, removed: 0 });
    expect(s.sync(docs())).toEqual({ added: 0, updated: 0, removed: 0 });
    const edited = docs().map((d) => (d.id === 'a:1:0' ? { ...d, title: 'Send the forecast to finance', text: 'Send the forecast to finance' } : d)).filter((d) => d.id !== 'm:2');
    expect(s.sync(edited)).toEqual({ added: 0, updated: 1, removed: 1 });
    expect(s.search('forecast').groups[2].total).toBe(1);
    expect(s.search('design').total).toBe(0);
    expect(s.documentCount()).toBe(4);
  });

  it('empty and blank queries return empty groups', () => {
    const r = service().search('   ');
    expect(r.total).toBe(0);
    expect(r.groups.every((g) => g.items.length === 0)).toBe(true);
  });
});

describe('snippet', () => {
  it('keeps short text whole and centres long text on the first match', () => {
    expect(snippet('short text', ['text'])).toBe('short text');
    const long = 'a'.repeat(300) + ' budget ' + 'b'.repeat(300);
    const s = snippet(long, ['budget']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('budget');
    expect(s.length).toBeLessThanOrEqual(162);
  });
});

describe('participant matches', () => {
  it('a meeting found by a person shows who was there instead of its minutes', () => {
    const s = createSearchService();
    s.sync([{ id: 'm:1', type: 'meeting', title: 'Design sync', text: 'Navigation changes.', people: 'Ann Bo ann.bo@acme.com', participantNames: 'Ann Bo, Tom Ward', when: '' }]);
    expect(s.search('ann').groups[0].items[0].snippet).toBe('With Ann Bo, Tom Ward');
    expect(s.search('navigation').groups[0].items[0].snippet).toBe('Navigation changes.');
  });
});

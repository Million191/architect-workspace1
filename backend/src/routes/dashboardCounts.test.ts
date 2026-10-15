// Runs in US Pacific time on purpose: the original count bug only appeared west of Greenwich, where
// a meeting's UTC date is often the next day (and, on Sunday evenings, the next week).
process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

/** The page's real selector code (public/js/dashboard/selectors.js), run on its own. */
interface Sel {
  instant(m: object): Date | null;
  localDay(m: object): string;
  bounds(range: string, now?: Date): { from: Date | null; to: Date | null; prevFrom?: Date };
  inPeriod(meetings: object[], from: Date | null, to: Date | null): object[];
  rangeCounts(meetings: object[], range: string, now?: Date): { range: string; count: number; prev: number | null };
  rows(meetings: object[], opts: object): object[];
  tabCounts(meetings: object[], opts: object, tabs: Array<{ id: string; match: (m: { status: string }) => boolean }>): Record<string, number>;
}
function loadSelectors(): Sel {
  const ctx: { MA: { dashboard?: { sel: Sel } }; Date: DateConstructor } = { MA: {}, Date };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'dashboard', 'selectors.js'), 'utf8'), ctx);
  return ctx.MA.dashboard!.sel;
}
const sel = loadSelectors();
const TABS = [
  { id: 'needs_review', match: (m: { status: string }) => m.status === 'needs_review' },
  { id: 'approved', match: (m: { status: string }) => ['emails_drafted', 'approved', 'sent'].includes(m.status) },
  { id: 'all', match: () => true },
];
const ALL = TABS[2];

// "Now": Wednesday 7 Oct 2026, 10:00 Pacific. This week = Mon 5 Oct 00:00 → Mon 12 Oct 00:00 local.
const NOW = new Date(2026, 9, 7, 10, 0);
// Meetings as the server sends them: date + time in UTC.
const M = (title: string, date: string, time: string | undefined, status = 'needs_review') => ({ runId: title, title, date, time, status });
const meetings = [
  M('Sunday evening (local) = Monday UTC', '2026-10-05', '03:30'), // Sun 4 Oct 20:30 PDT → LAST week
  M('Monday morning', '2026-10-05', '16:00', 'emails_drafted'), // Mon 5 Oct 09:00 PDT → this week
  M('Friday', '2026-10-09', '18:00', 'sent'), // this week
  M('Sunday late (local) = Monday UTC next week', '2026-10-12', '06:00'), // Sun 11 Oct 23:00 PDT → this week
  M('Last Tuesday', '2026-09-29', '17:00', 'approved'), // last week
  M('Last month', '2026-09-02', '17:00'), // September
  M('No date', '', undefined, 'failed'), // listed in All only
];

describe('one selector for the Meetings card, its comparison, the tab counts and the table', () => {
  it('reads server dates as UTC and places them on the viewer’s local day (weeks start Monday)', () => {
    expect(sel.localDay(meetings[0])).toBe('2026-10-04'); // the UTC date says 5 Oct; locally it is Sunday the 4th
    expect(sel.localDay(meetings[3])).toBe('2026-10-11');
    const b = sel.bounds('week', NOW);
    expect(b.from!.getDay()).toBe(1); // Monday
    expect([b.from!.getHours(), b.from!.getMinutes()]).toEqual([0, 0]); // local midnight
  });

  it.each(['week', 'month', 'all'])('range %s: the card count equals the table rows for the same range, and the delta is current − previous from the same function', (range) => {
    const counts = sel.rangeCounts(meetings, range, NOW);
    const tableRows = sel.rows(meetings, { tab: ALL, range, rangeFilter: true, now: NOW, query: '' });
    expect(counts.count).toBe(tableRows.length);
    const tabs = sel.tabCounts(meetings, { range, rangeFilter: true, now: NOW, query: '' }, TABS);
    expect(tabs.all).toBe(counts.count);
    expect(tabs.needs_review + tabs.approved).toBeLessThanOrEqual(tabs.all);

    const b = sel.bounds(range, NOW);
    if (range === 'all') {
      expect(counts.prev).toBeNull(); // no comparison for All time
    } else {
      const previous = sel.inPeriod(meetings, b.prevFrom!, b.from).length;
      expect(counts.prev).toBe(previous);
      expect(counts.count - (counts.prev as number)).toBe(sel.inPeriod(meetings, b.from, b.to).length - previous);
    }
  });

  it('gives the right numbers around the Sunday/Monday and UTC boundaries', () => {
    expect(sel.rangeCounts(meetings, 'week', NOW)).toEqual({ range: 'week', count: 3, prev: 2 });
    expect(sel.rangeCounts(meetings, 'month', NOW)).toEqual({ range: 'month', count: 4, prev: 2 }); // Oct: Sun 4, Mon 5, Fri 9, Sun 11; Sep: 2nd and 29th
    expect(sel.rangeCounts(meetings, 'all', NOW)).toEqual({ range: 'all', count: 7, prev: null });
  });

  it('a single meeting in total can never be "Same as last week" with 1 this week', () => {
    const one = [M('Only one', '2026-10-06', '20:00')];
    const c = sel.rangeCounts(one, 'week', NOW);
    expect(c.count + (c.prev as number)).toBeLessThanOrEqual(one.length);
    expect(c).toEqual({ range: 'week', count: 1, prev: 0 });
  });

  it('without the period filter the table shows everything; tabs follow the search too', () => {
    const opts = { range: 'week', rangeFilter: false, now: NOW, query: 'monday', matchesQuery: (m: { title: string }, q: string) => !q || m.title.toLowerCase().includes(q) };
    expect(sel.rows(meetings, { ...opts, tab: ALL }).length).toBe(sel.tabCounts(meetings, opts, TABS).all);
    expect(sel.rows(meetings, { ...opts, query: '', tab: ALL }).length).toBe(meetings.length);
  });
});

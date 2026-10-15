import { actionItemKey, contentHashOf, dedupeActionItems, dedupeAttendees, findDuplicateRun, matchKnownPeople } from './dedupe';
import { ActivityItem, collapseRepeats } from '../../routes/activity';

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);

describe('duplicate rules', () => {
  it('action items: one per task + owner (case, spacing, trailing period ignored); blanks and skipped items kept', () => {
    expect(actionItemKey('  Send the  Report. ', 'SARA')).toBe(actionItemKey('send the report', 'sara'));
    const items = [
      { task: 'Send the report', owner: 'Sara' },
      { task: 'send the  report.', owner: ' sara ' },
      { task: 'Send the report', owner: 'Tom' }, // different owner → different item
      { task: '', owner: 'Sara' },
      { task: '  ', owner: 'Sara' }, // rows still being typed are not duplicates
      { task: 'Send the report', owner: 'Sara', dismissed: true },
    ];
    expect(dedupeActionItems(items, { skip: (i) => !!(i as { dismissed?: boolean }).dismissed })).toEqual([items[0], items[2], items[3], items[4], items[5]]);
    expect(dedupeActionItems([])).toEqual([]);
    const again = dedupeActionItems(items);
    expect(dedupeActionItems(again)).toEqual(again); // idempotent
  });

  it('attendees: one per email (trimmed, any case); a bare name merges with the same name given with an address', () => {
    expect(dedupeAttendees([
      { name: 'Sara', email: 'sara@x.io' },
      { name: 'SARA@X.IO ', email: ' SARA@X.IO ' },
      { name: 'sara' },
      { name: 'Tom' },
      { name: 'tom', email: 'tom@x.io' },
      { name: 'Sara', email: 'sara.other@x.io' }, // same name, different address: two people
    ])).toEqual([{ name: 'Sara', email: 'sara@x.io' }, { name: 'Tom', email: 'tom@x.io' }, { name: 'Sara', email: 'sara.other@x.io' }]);
    // A real name given later replaces a bare address used as the name.
    expect(dedupeAttendees([{ name: 'ann@x.io', email: 'ann@x.io' }, { name: 'Ann Bo', email: 'ANN@x.io' }])).toEqual([{ name: 'Ann Bo', email: 'ann@x.io' }]);
    expect(dedupeAttendees([])).toEqual([]);
  });

  it('typed names match the People list only when exactly one person has that name', () => {
    const people = [{ name: 'Dagim', email: 'dagim@x.io' }, { name: 'Sam', email: 'sam1@x.io' }, { name: 'Sam', email: 'sam2@x.io' }];
    expect(matchKnownPeople([{ name: 'dagim' }, { name: 'Sam' }, { name: 'Nobody' }], people)).toEqual([{ name: 'dagim', email: 'dagim@x.io' }, { name: 'Sam' }, { name: 'Nobody' }]);
    // Matching can make two entries the same person: still one attendee.
    expect(matchKnownPeople([{ name: 'Dagim' }, { name: 'D', email: 'DAGIM@x.io' }], people)).toEqual([{ name: 'Dagim', email: 'dagim@x.io' }]);
  });

  it('meetings: same file under another source, or same title + scheduled start; never by upload time alone', () => {
    expect(contentHashOf(`physical:phone:${H1}`)).toBe(H1);
    expect(contentHashOf('weird-id')).toBeUndefined();
    const existing = [{ runId: `physical:room_mic:${H1}`, title: 'Weekly Sync', date: '2026-10-05', time: '14:00' }];
    expect(findDuplicateRun(existing, { runId: `physical:phone:${H1}` })).toBe(existing[0].runId);
    expect(findDuplicateRun(existing, { runId: `physical:room_mic:${H1}` })).toBeUndefined(); // itself, not a duplicate
    expect(findDuplicateRun(existing, { runId: `physical:room_mic:${H2}`, title: ' weekly sync ', scheduledAt: '2026-10-05T14:00:30Z' })).toBe(existing[0].runId);
    expect(findDuplicateRun(existing, { runId: `physical:room_mic:${H2}`, title: 'Weekly Sync', scheduledAt: '2026-10-05T15:00:00Z' })).toBeUndefined();
    expect(findDuplicateRun(existing, { runId: `physical:room_mic:${H2}`, title: 'Weekly Sync' })).toBeUndefined(); // no real start time
    expect(findDuplicateRun(existing, { runId: `physical:room_mic:${H2}`, title: 'Weekly Sync', scheduledAt: 'not a date' })).toBeUndefined();
  });

  it('recent activity: a repeat of the same event within two minutes is shown once', () => {
    const e = (at: string, over: Partial<ActivityItem> = {}): ActivityItem => ({ at, kind: 'emails_sent', text: 'Minutes emailed for Kickoff to 1 participant', runId: 'r1', by: 'Sara', ...over });
    const items = [e('2026-10-05T10:00:05Z'), e('2026-10-05T10:00:01Z'), e('2026-10-05T09:50:00Z'), e('2026-10-05T10:00:00Z', { runId: 'r2' }), e('2026-10-05T09:59:59Z', { by: 'Tom' })];
    expect(collapseRepeats(items)).toEqual([items[0], items[2], items[3], items[4]]);
    expect(collapseRepeats([])).toEqual([]);
  });
});

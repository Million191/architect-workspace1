import { findViolation, UniqueConstraintError, violations, withConstraints } from './uniqueIndex';
import { peopleConstraints, recipientConstraints, repeatedActionItem, scheduleConstraints } from './constraints';
import { createPipelineStores } from '../meetingPipeline/meetingPipelineService';
import { createScheduleService } from '../schedule/scheduleService';
import { ScheduledMeeting } from '../schedule/types';
import { PersonRecord } from '../people/types';

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined); });

type Row = { email?: string; tags?: string[] };
const rules = {
  unique: [{ name: 'row_email_unique', keyOf: (r: Row) => r.email?.toLowerCase() }],
  checks: [{ name: 'row_tags_unique', problem: (r: Row) => (new Set(r.tags ?? []).size !== (r.tags ?? []).length ? 'repeated tag' : undefined) }],
};

describe('unique indexes and checks', () => {
  it('rejects a second record with the same key; the same id can be rewritten; unkeyed records are not indexed', () => {
    const store = withConstraints(new Map<string, Row>(), rules);
    store.set('a', { email: 'X@y.io' });
    store.set('a', { email: 'x@y.io', tags: ['one'] }); // same record, rewritten
    expect(() => store.set('b', { email: 'x@Y.io' })).toThrow(UniqueConstraintError);
    expect(store.has('b')).toBe(false); // nothing written
    store.set('c', {}); store.set('d', {}); // no key → partial index skips them
    expect(() => store.set('e', { email: 'e@y.io', tags: ['t', 't'] })).toThrow(/breaks a rule \(row_tags_unique\)/);
    try { store.set('b', { email: 'x@y.io' }); } catch (e) { expect(e).toMatchObject({ errorClass: 'UniqueConstraintError', constraint: 'row_email_unique', existingId: 'a' }); }
  });

  it('wrapping twice adds rules without checking twice; violations lists what is already stored', () => {
    const raw = new Map<string, Row>([['a', { email: 'x@y.io' }], ['b', { email: 'X@y.io' }], ['c', { tags: ['t', 't'] }]]);
    expect(violations(raw, rules)).toEqual([
      { constraint: 'row_tags_unique', key: 'repeated tag', ids: ['c'] },
      { constraint: 'row_email_unique', key: 'x@y.io', ids: ['a', 'b'] },
    ]);
    const store = withConstraints(withConstraints(new Map<string, Row>(), rules), { unique: [{ name: 'tag0', keyOf: (r: Row) => r.tags?.[0] }] });
    store.set('a', { email: 'a@y.io', tags: ['k'] });
    expect(() => store.set('b', { email: 'b@y.io', tags: ['k'] })).toThrow(/tag0/);
    expect(findViolation(store, 'z', { email: 'A@y.io' }, rules)?.constraint).toBe('row_email_unique');
  });

  it('people: one record per email, stored under that email', () => {
    const store = withConstraints(new Map<string, PersonRecord>(), peopleConstraints);
    const person = (email: string): PersonRecord => ({ id: email.trim().toLowerCase(), email, names: {}, photos: {}, origins: ['meeting'], createdAt: 'x', updatedAt: 'x' });
    store.set('sara@x.io', person('Sara@x.io'));
    expect(() => store.set('sara2', person('SARA@x.io'))).toThrow(/people_email_unique|people_id_is_email/);
    expect(() => store.set('tom', person('tom@x.io'))).toThrow(/people_id_is_email/);
  });

  it('schedule: "Create" twice returns the same meeting; moving a meeting onto an identical one is refused', () => {
    const store = new Map<string, ScheduledMeeting>();
    const schedule = createScheduleService({ store });
    const input = { title: 'Board review', start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T16:00:00.000Z', participants: [] };
    const a = schedule.create(input);
    const b = schedule.create({ ...input, title: ' board  REVIEW ' });
    expect(b).toMatchObject({ duplicate: true, meeting: { id: a.meeting.id } });
    expect(store.size).toBe(1);
    const c = schedule.create({ ...input, start: '2026-11-03T15:00:00.000Z', end: '2026-11-03T16:00:00.000Z' });
    expect(() => schedule.update(c.meeting.id, input)).toThrow(UniqueConstraintError);
    schedule.cancel(a.meeting.id);
    expect(schedule.create(input).duplicate).toBeUndefined(); // a cancelled meeting doesn't block a new one
    expect(violations(store, scheduleConstraints)).toEqual([]);
  });

  it('meetings: one per audio file; no repeated action items inside a meeting', () => {
    const stores = createPipelineStores();
    const hash = 'c'.repeat(64);
    const session = (items: Array<{ task: string; owner?: string }>) => ({ draft: { actionItems: items } }) as never;
    stores.minutesGate.set(`physical:room_mic:${hash}`, session([{ task: 'A' }]));
    expect(() => stores.minutesGate.set(`physical:phone:${hash}`, session([]))).toThrow(/meeting_audio_hash_unique/);
    expect(() => stores.minutesGate.set(`physical:room_mic:${'d'.repeat(64)}`, session([{ task: 'Call Ann', owner: 'Sara' }, { task: 'call ann.', owner: 'SARA' }]))).toThrow(/meeting_action_items_unique/);
    expect(repeatedActionItem([{ task: '' }, { task: '' }, { task: 'x', dismissed: true }, { task: 'x' }])).toBeUndefined();
  });

  it('proposed recipient rule finds an address listed under two names', () => {
    const store = new Map<string, Record<string, string>>([['run-1', { 'm@x.io': 'm@x.io', Million: 'M@x.io ' }], ['run-2', { Ann: 'ann@x.io' }]]);
    expect(violations(store, recipientConstraints)).toEqual([{ constraint: 'meeting_recipient_address_unique', key: 'address listed twice', ids: ['run-1'] }]);
  });
});

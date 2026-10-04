import { createScheduleService } from './scheduleService';
import { InvalidTransitionError, MeetingNotFoundError, ScheduleValidationError, StaleVersionError } from './errors';
import { buildNotices, sendNotices } from './notifications';
import { ScheduledMeeting } from './types';

const T = (h: number, m = 0) => `2026-10-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const input = (over: Partial<Parameters<ReturnType<typeof createScheduleService>['create']>[0]> = {}) => ({
  title: 'Weekly team sync', start: T(15), end: T(15, 30), participants: [{ name: 'Priya', email: 'Priya@Example.com' }], ...over,
});
const service = () => createScheduleService({ store: new Map<string, ScheduledMeeting>(), now: () => new Date('2026-10-05T12:00:00Z') });

describe('schedule service', () => {
  it('creates meetings with validation, normalised participants, history, and overlap warnings', () => {
    const s = service();
    const a = s.create(input({ title: 'Design review' }), { by: 'Million' });
    expect(a.meeting).toMatchObject({ status: 'scheduled', version: 1, participants: [{ name: 'Priya', email: 'priya@example.com' }] });
    expect(a.meeting.history[0]).toMatchObject({ action: 'created', by: 'Million' });
    expect(s.create(input({ start: T(15, 15), end: T(16) })).warnings).toEqual(['Overlaps with Design review']);
    expect(() => s.create(input({ title: '  ' }))).toThrow(ScheduleValidationError);
    expect(() => s.create(input({ end: T(14) }))).toThrow('The end time must be after the start time.');
    expect(() => s.create(input({ participants: [{ email: 'not-an-email' }] }))).toThrow('not-an-email');
  });

  it('reschedules with history and a single-step Undo; stale versions are rejected', () => {
    const s = service();
    const m = s.create(input()).meeting;
    const moved = s.update(m.id, input({ start: T(17), end: T(18) }), { by: 'Million', expectedVersion: 1 }).meeting;
    expect(moved.history.at(-1)).toMatchObject({ action: 'rescheduled', from: { start: T(15) }, to: { start: T(17) } });
    expect(() => s.update(m.id, input(), { expectedVersion: 1 })).toThrow(StaleVersionError);
    const undone = s.undo(m.id, moved.version, { by: 'Million' });
    expect(undone).toMatchObject({ start: T(15), end: T(15, 30), version: 3 });
    expect(undone.history.at(-1)?.action).toBe('undone');
    expect(() => s.undo(m.id, moved.version)).toThrow(StaleVersionError);
  });

  it('postpones to a new time (keeping the original) or to date TBD, and cancels/restores', () => {
    const s = service();
    const m = s.create(input()).meeting;
    const p = s.postpone(m.id, { start: T(18), end: T(18, 30) }, { reason: 'Client away', by: 'Million' }).meeting;
    expect(p).toMatchObject({ status: 'postponed', start: T(18), originalStart: T(15), statusReason: 'Client away', statusChangedBy: 'Million' });
    const tbd = s.postpone(m.id, null).meeting;
    expect(tbd).toMatchObject({ start: null, end: null, originalStart: T(15) });
    const c = s.cancel(m.id, { reason: 'Not needed' });
    expect(c.status).toBe('cancelled');
    expect(s.cancel(m.id).version).toBe(c.version); // idempotent
    expect(() => s.update(m.id, input())).toThrow('Restore this meeting before editing it.');
    expect(() => s.assertCanLinkRecording(m.id)).toThrow(InvalidTransitionError);
    expect(s.restore(m.id).status).toBe('scheduled');
  });

  it('locks meetings once a recording is attached; delete is idempotent; list covers moved and TBD meetings', () => {
    const s = service();
    const m = s.create(input()).meeting;
    s.linkRecording(m.id, 'run-1');
    expect(s.linkRecording(m.id, 'run-1').runId).toBe('run-1');
    expect(() => s.update(m.id, input({ title: 'x' }))).toThrow('A recording is attached');
    expect(() => s.postpone(m.id, null)).toThrow(InvalidTransitionError);
    expect(() => s.remove(m.id)).toThrow(InvalidTransitionError);

    const moved = s.create(input({ title: 'Moved' })).meeting;
    s.postpone(moved.id, { start: '2026-10-20T15:00:00.000Z', end: '2026-10-20T16:00:00.000Z' });
    const tbd = s.create(input({ title: 'TBD' })).meeting;
    s.postpone(tbd.id, null);
    const week = s.listRange('2026-10-05T00:00:00.000Z', '2026-10-10T00:00:00.000Z').map((x) => x.title);
    expect(week).toEqual(expect.arrayContaining(['Weekly team sync', 'Moved', 'TBD']));
    s.remove(tbd.id);
    s.remove(tbd.id);
    expect(() => s.get(tbd.id)).toThrow(MeetingNotFoundError);
  });
});

describe('participant notices', () => {
  it('build deterministic postponed/cancelled emails, and draft-only mode never sends', async () => {
    const s = service();
    const m = s.create(input()).meeting;
    const p = s.postpone(m.id, null, { reason: 'Client away' }).meeting;
    const [email] = buildNotices(p, 'postponed', 'UTC');
    expect(email).toMatchObject({ to: 'priya@example.com', subject: 'Postponed: Weekly team sync' });
    expect(email.body).toContain('Hi Priya,');
    expect(email.body).toContain('Was: Tuesday, October 6, 3:00 PM – 3:30 PM');
    expect(email.body).toContain('Now: a new date to be confirmed');
    expect(email.body).toContain('Reason: Client away');
    const deliver = { send: jest.fn() };
    expect(await sendNotices(p, 'postponed', { emailMode: 'draft-only', deliver, sentLog: new Map(), timeZone: 'UTC' })).toMatchObject({ outcome: 'draft_only' });
    expect(deliver.send).not.toHaveBeenCalled();
  });

  it('sending: a failure keeps the change, and a retry only sends what didn’t go out', async () => {
    const s = service();
    const m = s.create(input({ participants: [{ email: 'a@example.com' }, { email: 'b@example.com' }] })).meeting;
    const c = s.cancel(m.id);
    const log = new Map<string, string>();
    let failB = true;
    const deliver = { send: jest.fn(async (_e: unknown, meta: { to?: string }) => { if (meta.to === 'b@example.com' && failB) throw new Error('The SMTP server did not respond in time.'); }) };
    const first = await sendNotices(c, 'cancelled', { emailMode: 'send', deliver, sentLog: log, timeZone: 'UTC' });
    expect(first).toMatchObject({ outcome: 'failed', sentTo: ['a@example.com'], failedTo: ['b@example.com'] });
    failB = false;
    const retry = await sendNotices(c, 'cancelled', { emailMode: 'send', deliver, sentLog: log, timeZone: 'UTC' });
    expect(retry.outcome).toBe('sent');
    expect(deliver.send.mock.calls.filter((call) => call[1].to === 'a@example.com')).toHaveLength(1);
  });
});

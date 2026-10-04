import { randomUUID } from 'crypto';
import { InvalidTransitionError, MeetingNotFoundError, ScheduleValidationError, StaleVersionError } from './errors';
import { ChangeContext, ExternalRef, HistoryEntry, MeetingInput, ScheduledMeeting, TimeRange } from './types';

const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export interface ScheduleServiceOptions {
  /** Persistent store keyed by meeting id (a JsonFileMap in the app; a plain Map in tests). */
  store: Map<string, ScheduledMeeting>;
  now?: () => Date;
}

/** What a create/update returns: the meeting plus non-blocking warnings (e.g. overlaps). */
export interface ScheduleResult {
  meeting: ScheduledMeeting;
  warnings: string[];
}

function validateTimes(start: string, end: string): void {
  const s = Date.parse(start), e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) throw new ScheduleValidationError('Start and end must be valid dates and times.');
  if (e <= s) throw new ScheduleValidationError('The end time must be after the start time.');
}

function validateInput(input: MeetingInput): MeetingInput {
  const title = input.title.trim();
  if (!title) throw new ScheduleValidationError('Add a title for the meeting.');
  validateTimes(input.start, input.end);
  const bad = input.participants.filter((p) => !EMAIL.test(p.email.trim()));
  if (bad.length) throw new ScheduleValidationError(`These aren’t valid email addresses: ${bad.map((p) => p.email).join(', ')}.`);
  const seen = new Set<string>();
  const participants = input.participants
    .map((p) => ({ email: p.email.trim().toLowerCase(), ...(p.name && p.name.trim() ? { name: p.name.trim() } : {}) }))
    .filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)));
  return { ...input, title, participants, link: input.link?.trim() || undefined, agenda: input.agenda?.trim() || undefined };
}

const range = (m: Pick<ScheduledMeeting, 'start' | 'end'>): TimeRange => ({ start: m.start, end: m.end });
const sameRange = (a: TimeRange, b: TimeRange) => a.start === b.start && a.end === b.end;

/**
 * Rules for scheduled meetings. Every change: checks the meeting is in a state that allows it,
 * writes one history line, keeps the previous version for a single-step Undo, and bumps `version`.
 * Meetings with a recording attached (`runId`) are locked — their status belongs to the minutes workflow.
 */
export function createScheduleService({ store, now = () => new Date() }: ScheduleServiceOptions) {
  function get(id: string): ScheduledMeeting {
    const m = store.get(id);
    if (!m) throw new MeetingNotFoundError('That meeting no longer exists.', { id });
    return m;
  }

  function assertVersion(m: ScheduledMeeting, expected?: number): void {
    if (expected !== undefined && expected !== m.version) {
      throw new StaleVersionError('This meeting changed since you opened it. Reload and try again.', { id: m.id, expected, actual: m.version });
    }
  }
  function assertUnlocked(m: ScheduledMeeting, what: string): void {
    if (m.runId) throw new InvalidTransitionError(`A recording is attached to this meeting, so it can’t be ${what}.`, { id: m.id });
    // Synced meetings belong to the calendar they came from; local edits would be overwritten on the next sync.
    if (m.external) throw new InvalidTransitionError(`This meeting comes from ${m.external.provider === 'google' ? 'Google Calendar' : 'Outlook'}. Change it there — it updates here on the next sync.`, { id: m.id });
  }

  /** Saves a change: snapshot for Undo, history line, version bump. */
  function commit(before: ScheduledMeeting, after: Omit<ScheduledMeeting, 'history' | 'previous' | 'version' | 'updatedAt'>, entry: Omit<HistoryEntry, 'at'>): ScheduledMeeting {
    const at = now().toISOString();
    const { history, previous: _previous, ...snapshot } = before;
    const saved: ScheduledMeeting = { ...after, version: before.version + 1, updatedAt: at, history: [...history, { ...entry, at }], previous: snapshot };
    store.set(saved.id, saved);
    return saved;
  }

  /** Other meetings this one overlaps (cancelled and date-TBD meetings never count). */
  function overlaps(m: Pick<ScheduledMeeting, 'id' | 'start' | 'end'>): string[] {
    if (!m.start || !m.end) return [];
    const s = Date.parse(m.start), e = Date.parse(m.end);
    return [...store.values()]
      .filter((o) => o.id !== m.id && o.status !== 'cancelled' && o.start && o.end && Date.parse(o.start) < e && Date.parse(o.end) > s)
      .map((o) => `Overlaps with ${o.title}`);
  }

  return {
    get,
    overlaps,

    /** Every scheduled meeting, any status (used to build the People list). */
    listAll(): ScheduledMeeting[] {
      return [...store.values()];
    },

    /** Meetings whose time, original time, or "date TBD" status makes them relevant to [from, to). */
    listRange(from: string, to: string): ScheduledMeeting[] {
      const f = Date.parse(from), t = Date.parse(to);
      const inRange = (iso?: string | null) => !!iso && Date.parse(iso) < t && Date.parse(iso) >= f - 24 * 3600 * 1000;
      return [...store.values()]
        .filter((m) => (m.start ? (Date.parse(m.start) < t && Date.parse(m.end as string) > f) || inRange(m.originalStart) : m.status === 'postponed'))
        .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
    },

    create(input: MeetingInput, ctx: ChangeContext = {}): ScheduleResult {
      const v = validateInput(input);
      const at = now().toISOString();
      const meeting: ScheduledMeeting = {
        id: randomUUID(), title: v.title, start: v.start, end: v.end, participants: v.participants, link: v.link, agenda: v.agenda,
        status: 'scheduled', createdAt: at, updatedAt: at, version: 1, history: [{ at, by: ctx.by, action: 'created', to: { start: v.start, end: v.end } }],
      };
      store.set(meeting.id, meeting);
      return { meeting, warnings: overlaps(meeting) };
    },

    /** Edit details and/or move the meeting. Only scheduled or postponed meetings without a recording. */
    update(id: string, input: MeetingInput, ctx: ChangeContext & { expectedVersion?: number } = {}): ScheduleResult {
      const m = get(id);
      assertVersion(m, ctx.expectedVersion);
      assertUnlocked(m, 'edited');
      if (m.status === 'cancelled') throw new InvalidTransitionError('Restore this meeting before editing it.', { id });
      const v = validateInput(input);
      const moved = !sameRange(range(m), { start: v.start, end: v.end });
      const detailsChanged = v.title !== m.title || JSON.stringify(v.participants) !== JSON.stringify(m.participants) || v.link !== m.link || v.agenda !== m.agenda;
      if (!moved && !detailsChanged) return { meeting: m, warnings: overlaps(m) };
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = m;
      const saved = commit(m, { ...base, title: v.title, start: v.start, end: v.end, participants: v.participants, link: v.link, agenda: v.agenda },
        { by: ctx.by, action: moved && !detailsChanged ? 'rescheduled' : 'updated', ...(moved ? { from: range(m), to: { start: v.start, end: v.end } } : {}) });
      return { meeting: saved, warnings: overlaps(saved) };
    },

    /** Move to a new time (tagged Postponed, original time kept) or to "date to be decided" (newRange null). */
    postpone(id: string, newRange: { start: string; end: string } | null, ctx: ChangeContext & { expectedVersion?: number } = {}): ScheduleResult {
      const m = get(id);
      assertVersion(m, ctx.expectedVersion);
      assertUnlocked(m, 'postponed');
      if (m.status === 'cancelled') throw new InvalidTransitionError('A cancelled meeting can’t be postponed. Restore it first.', { id });
      if (newRange) validateTimes(newRange.start, newRange.end);
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = m;
      const at = now().toISOString();
      const saved = commit(m, {
        ...base, status: 'postponed', start: newRange?.start ?? null, end: newRange?.end ?? null,
        originalStart: m.originalStart ?? m.start ?? undefined, originalEnd: m.originalEnd ?? m.end ?? undefined,
        statusReason: ctx.reason?.trim() || undefined, statusChangedAt: at, statusChangedBy: ctx.by,
      }, { by: ctx.by, action: 'postponed', from: range(m), to: newRange ?? { start: null, end: null }, reason: ctx.reason?.trim() || undefined });
      return { meeting: saved, warnings: overlaps(saved) };
    },

    cancel(id: string, ctx: ChangeContext & { expectedVersion?: number } = {}): ScheduledMeeting {
      const m = get(id);
      assertVersion(m, ctx.expectedVersion);
      assertUnlocked(m, 'cancelled');
      if (m.status === 'cancelled') return m; // idempotent
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = m;
      return commit(m, { ...base, status: 'cancelled', statusReason: ctx.reason?.trim() || undefined, statusChangedAt: now().toISOString(), statusChangedBy: ctx.by },
        { by: ctx.by, action: 'cancelled', reason: ctx.reason?.trim() || undefined });
    },

    restore(id: string, ctx: ChangeContext = {}): ScheduledMeeting {
      const m = get(id);
      if (m.status !== 'cancelled') return m; // idempotent
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = m;
      return commit(m, { ...base, status: 'scheduled', statusReason: undefined, statusChangedAt: now().toISOString(), statusChangedBy: ctx.by }, { by: ctx.by, action: 'restored' });
    },

    /** Delete — only for meetings added by mistake, never once a recording is attached. */
    remove(id: string): void {
      const m = store.get(id);
      if (!m) return; // idempotent
      assertUnlocked(m, 'deleted');
      store.delete(id);
    },

    /** Reverts the latest change, if `version` is still the current one. */
    undo(id: string, version: number, ctx: ChangeContext = {}): ScheduledMeeting {
      const m = get(id);
      if (m.version !== version || !m.previous) throw new StaleVersionError('That change can no longer be undone.', { id });
      assertUnlocked(m, 'changed');
      const restored = { ...m.previous };
      return commit(m, { ...restored, id: m.id, createdAt: m.createdAt }, { by: ctx.by, action: 'undone', from: range(m), to: range(restored) });
    },

    /** Throws if a recording can't be attached (checked before processing starts). */
    assertCanLinkRecording(id: string, runId?: string): ScheduledMeeting {
      const m = get(id);
      if (runId && m.runId === runId) return m;
      if (m.status === 'cancelled') throw new InvalidTransitionError('This meeting was cancelled, so a recording can’t be added. Restore it first.', { id });
      if (!m.start) throw new InvalidTransitionError('Pick a new date for this postponed meeting before adding a recording.', { id });
      if (m.runId) throw new InvalidTransitionError('A different recording is already attached to this meeting.', { id });
      return m;
    },

    /** Attaches an uploaded recording. Not for cancelled or date-TBD meetings. */
    linkRecording(id: string, runId: string, ctx: ChangeContext = {}): ScheduledMeeting {
      const m = get(id);
      if (m.runId === runId) return m; // idempotent
      if (m.status === 'cancelled') throw new InvalidTransitionError('This meeting was cancelled, so a recording can’t be added. Restore it first.', { id });
      if (!m.start) throw new InvalidTransitionError('Pick a new date for this postponed meeting before adding a recording.', { id });
      if (m.runId) throw new InvalidTransitionError('A different recording is already attached to this meeting.', { id });
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = m;
      return commit(m, { ...base, runId }, { by: ctx.by, action: 'recording_linked' });
    },

    /**
     * Calendar sync: creates or updates the meeting for an external event (matched by provider +
     * event id), or marks it cancelled. Unchanged events are left alone (no history line, no version
     * bump), so syncing again is a no-op. A meeting with a recording keeps its times and status.
     */
    upsertExternal(input: MeetingInput, ref: ExternalRef, cancelled: boolean): 'added' | 'updated' | 'cancelled' | 'unchanged' {
      const existing = [...store.values()].find((m) => m.external?.provider === ref.provider && m.external.eventId === ref.eventId);
      const by = ref.provider === 'google' ? 'Google Calendar' : 'Outlook';
      if (!existing) {
        if (cancelled) return 'unchanged'; // never seen, already cancelled: nothing to show
        const v = validateInput(input);
        const at = now().toISOString();
        const id = randomUUID();
        store.set(id, {
          id, title: v.title, start: v.start, end: v.end, participants: v.participants, link: v.link, agenda: v.agenda, external: ref,
          status: 'scheduled', createdAt: at, updatedAt: at, version: 1, history: [{ at, by, action: 'synced', to: { start: v.start, end: v.end } }],
        });
        return 'added';
      }
      if (existing.runId) return 'unchanged';
      const { history: _h, previous: _p, version: _v, updatedAt: _u, ...base } = existing;
      if (cancelled) {
        if (existing.status === 'cancelled') return 'unchanged';
        commit(existing, { ...base, external: ref, status: 'cancelled', statusReason: `Cancelled in ${by}`, statusChangedAt: now().toISOString(), statusChangedBy: by }, { by, action: 'cancelled', reason: `Cancelled in ${by}` });
        return 'cancelled';
      }
      const v = validateInput(input);
      const moved = !sameRange(range(existing), { start: v.start, end: v.end });
      const changed = moved || v.title !== existing.title || JSON.stringify(v.participants) !== JSON.stringify(existing.participants) || v.link !== existing.link || v.agenda !== existing.agenda || existing.status !== 'scheduled';
      if (!changed) return 'unchanged';
      commit(existing, { ...base, external: ref, status: 'scheduled', statusReason: undefined, title: v.title, start: v.start, end: v.end, participants: v.participants, link: v.link, agenda: v.agenda },
        { by, action: existing.status === 'cancelled' ? 'restored' : moved ? 'rescheduled' : 'updated', ...(moved ? { from: range(existing), to: { start: v.start, end: v.end } } : {}) });
      return 'updated';
    },

    /** Synced meetings from one provider (optionally one calendar). */
    listExternal(provider: ExternalRef['provider'], calendarId?: string): ScheduledMeeting[] {
      return [...store.values()].filter((m) => m.external?.provider === provider && (!calendarId || m.external.calendarId === calendarId));
    },

    /** Disconnect/deselect: removes synced meetings that have no recording (those stay as normal meetings). */
    removeExternal(provider: ExternalRef['provider'], keep: (m: ScheduledMeeting) => boolean = () => false): number {
      let removed = 0;
      for (const m of [...store.values()]) {
        if (m.external?.provider !== provider || keep(m)) continue;
        if (m.runId) { const { external: _e, ...rest } = m; store.set(m.id, rest); continue; }
        store.delete(m.id);
        removed++;
      }
      return removed;
    },

    /** Appends a notification outcome to the history (no Undo snapshot change). */
    recordNote(id: string, action: 'notified' | 'notify_failed', note: string, by?: string): ScheduledMeeting {
      const m = get(id);
      const saved = { ...m, history: [...m.history, { at: now().toISOString(), by, action, note }] };
      store.set(id, saved);
      return saved;
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;

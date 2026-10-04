import { avatarColor, isEmail, normalizeEmail, readableNameFromEmail } from './identity';
import { NameSource, Person, PersonEdit, PersonRecord, PersonSighting, PhotoSource } from './types';

export class PersonNotFoundError extends Error {
  readonly errorClass = 'PersonNotFoundError';
}

const NAME_ORDER: Array<Exclude<NameSource, 'derived'>> = ['edited', 'calendar', 'entered'];
const PHOTO_ORDER: PhotoSource[] = ['edited', 'calendar'];

export interface PeopleServiceOptions {
  /** JsonFileMap in real mode (survives restarts), a plain Map in tests/demo. */
  store: Map<string, PersonRecord>;
  now?: () => Date;
}

/** The record as the app shows it: highest-precedence name and photo, plus a stable colour. */
export function toPerson(r: PersonRecord): Person {
  const nameSource = NAME_ORDER.find((s) => r.names[s]);
  const photoSource = PHOTO_ORDER.find((s) => r.photos[s]);
  return {
    id: r.id,
    email: r.email,
    name: nameSource ? (r.names[nameSource] as string) : readableNameFromEmail(r.email),
    nameSource: nameSource ?? 'derived',
    avatarUrl: photoSource ? r.photos[photoSource] : undefined,
    photoSource,
    avatarColor: avatarColor(r.email),
    origins: r.origins,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function sameRecord(a: PersonRecord, b: PersonRecord): boolean {
  return JSON.stringify([a.names, a.photos, a.origins]) === JSON.stringify([b.names, b.photos, b.origins]);
}

/**
 * The People directory. `observe` is idempotent: replaying the same sightings leaves every record
 * (including `updatedAt`) unchanged, so it is safe to call on every list request.
 */
export function createPeopleService({ store, now = () => new Date() }: PeopleServiceOptions) {
  function save(before: PersonRecord | undefined, after: PersonRecord): void {
    if (before && sameRecord(before, after)) return; // no change → no write, no new timestamp
    store.set(after.id, { ...after, updatedAt: now().toISOString() });
  }

  function observe(sightings: PersonSighting[]): void {
    for (const s of sightings) {
      if (!s.email || !isEmail(s.email)) continue; // names without an address can't be a person record
      const id = normalizeEmail(s.email);
      const before = store.get(id);
      const at = now().toISOString();
      const next: PersonRecord = before
        ? { ...before, names: { ...before.names }, photos: { ...before.photos }, origins: [...before.origins] }
        : { id, email: s.email.trim(), names: {}, photos: {}, origins: [], createdAt: at, updatedAt: at };
      const name = s.name?.trim();
      // A "name" that is just the address (e.g. "priya@x.com <priya@x.com>") is not a name.
      if (name && normalizeEmail(name) !== id) next.names[s.origin === 'calendar' ? 'calendar' : 'entered'] = name;
      if (s.origin === 'calendar' && s.avatarUrl) next.photos.calendar = s.avatarUrl;
      if (!next.origins.includes(s.origin)) next.origins.push(s.origin);
      save(before, next);
    }
  }

  function get(id: string): Person {
    const r = store.get(normalizeEmail(id));
    if (!r) throw new PersonNotFoundError('That person isn’t in your People list.');
    return toPerson(r);
  }

  return {
    observe,
    get,

    /** Everyone, sorted by display name; `query` matches name or email, case-insensitively. */
    list(query?: string): Person[] {
      const q = query?.trim().toLowerCase();
      return [...store.values()]
        .map(toPerson)
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    },

    /** A People-list edit. Empty strings and null clear the edit (the next source shows again). */
    update(id: string, edit: PersonEdit): Person {
      const before = store.get(normalizeEmail(id));
      if (!before) throw new PersonNotFoundError('That person isn’t in your People list.');
      const next: PersonRecord = { ...before, names: { ...before.names }, photos: { ...before.photos } };
      if (edit.name !== undefined) {
        if (edit.name && edit.name.trim()) next.names.edited = edit.name.trim(); else delete next.names.edited;
      }
      if (edit.avatarUrl !== undefined) {
        if (edit.avatarUrl && edit.avatarUrl.trim()) next.photos.edited = edit.avatarUrl.trim(); else delete next.photos.edited;
      }
      save(before, next);
      return toPerson(store.get(before.id) as PersonRecord);
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;

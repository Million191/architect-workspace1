/**
 * A person the app knows about, keyed by lower-cased email (`id`). Meetings and calendar entries keep
 * their participant email, which doubles as the reference to this record.
 *
 * Name precedence (highest first): edited in the People list → synced calendar contact → typed with
 * the address ("Priya <priya@x.com>") → readable version of the email. The People list edit wins over
 * the calendar because it is the one explicit correction a user makes on purpose.
 */
export type NameSource = 'edited' | 'calendar' | 'entered' | 'derived';
export type PhotoSource = 'edited' | 'calendar';

/**
 * Where a person was seen. 'manual' = added with "+ Add person" — kept even when they are in no meeting.
 * Everyone else stays in the list only while a meeting or calendar entry still includes them.
 */
export type PersonOrigin = 'meeting' | 'schedule' | 'calendar' | 'manual';

export interface Person {
  id: string;
  email: string;
  name: string;
  nameSource: NameSource;
  /** Job title or role in the meetings (e.g. "Product Manager"), typed on the People page. */
  role?: string;
  avatarUrl?: string;
  photoSource?: PhotoSource;
  avatarColor: string;
  origins: PersonOrigin[];
  createdAt: string;
  updatedAt: string;
}

/** What is stored: every source's value is kept, so clearing an edit falls back to the next source. */
export interface PersonRecord {
  id: string;
  email: string;
  names: Partial<Record<Exclude<NameSource, 'derived'>, string>>;
  photos: Partial<Record<PhotoSource, string>>;
  /** Optional, added 2026-10-09 (older records have none). */
  role?: string;
  origins: PersonOrigin[];
  createdAt: string;
  updatedAt: string;
}

/** One sighting of a person in a meeting, a scheduled meeting, or a synced calendar event. */
export interface PersonSighting {
  email: string;
  name?: string;
  avatarUrl?: string;
  origin: PersonOrigin;
}

export interface PersonEdit {
  /** null clears an edited name, falling back to the next source. */
  name?: string | null;
  /** A corrected address: the person is re-keyed (refused if someone else already has it). */
  email?: string;
  /** null clears an edited photo. */
  avatarUrl?: string | null;
  /** null or "" clears the role. */
  role?: string | null;
}

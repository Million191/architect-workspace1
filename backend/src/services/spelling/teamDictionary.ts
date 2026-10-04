import { MeetingPipeline } from '../meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../schedule/scheduleService';
import { PeopleService } from '../people/peopleService';

/** A word someone chose "Add to dictionary" for. Keyed by the lower-cased word. */
export interface TeamWord {
  word: string;
  addedBy?: string;
  addedAt: string;
}

export interface TeamDictionarySources {
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
  people?: PeopleService;
}

const WORDS = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;

/**
 * Words the team uses that a general dictionary doesn't know, gathered automatically: participant
 * names (People list, meeting attendees, calendar participants) and words from meeting titles —
 * where company and project names live. Read-only; recomputed on demand.
 */
export function automaticTeamWords(src: TeamDictionarySources): Set<string> {
  const out = new Set<string>();
  const add = (text?: string) => { for (const w of (text ?? '').match(WORDS) ?? []) out.add(w.toLowerCase().replace(/’/g, "'")); };
  for (const p of src.people?.list() ?? []) add(p.name);
  for (const m of src.pipeline?.listMeetings() ?? []) { add(m.title); m.participants.forEach(add); }
  for (const m of src.schedule?.listAll() ?? []) { add(m.title); m.participants.forEach((p) => add(p.name)); }
  return out;
}

export function createTeamDictionary(store: Map<string, TeamWord>, now: () => Date = () => new Date()) {
  return {
    list(): TeamWord[] {
      return [...store.values()].sort((a, b) => a.word.localeCompare(b.word));
    },
    /** Idempotent: adding a word that is already there keeps the original entry. */
    add(word: string, addedBy?: string): TeamWord {
      const key = word.trim().toLowerCase().replace(/’/g, "'");
      const existing = store.get(key);
      if (existing) return existing;
      const entry: TeamWord = { word: word.trim(), addedBy, addedAt: now().toISOString() };
      store.set(key, entry);
      return entry;
    },
    remove(word: string): boolean {
      return store.delete(word.trim().toLowerCase().replace(/’/g, "'"));
    },
    words(): Set<string> {
      return new Set(store.keys());
    },
  };
}

export type TeamDictionary = ReturnType<typeof createTeamDictionary>;

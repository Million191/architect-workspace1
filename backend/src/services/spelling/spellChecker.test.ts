import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { createSpellChecker } from './spellChecker';
import { automaticTeamWords, createTeamDictionary, TeamWord } from './teamDictionary';
import { JsonFileMap } from '../meetingPipeline/jsonFileMap';
import { createScheduleService } from '../schedule/scheduleService';
import { ScheduledMeeting } from '../schedule/types';

const checker = createSpellChecker();
const none = new Set<string>();

describe('spell checker (nspell + dictionary-en)', () => {
  it('flags misspellings with offsets and suggestions, and never changes the text', () => {
    const text = 'We agred to move the budjet review.';
    const issues = checker.check(text, none);
    expect(issues.map((i) => i.word)).toEqual(['agred', 'budjet']);
    const budjet = issues[1];
    expect(text.slice(budjet.offset, budjet.offset + budjet.length)).toBe('budjet');
    expect(budjet.suggestions).toContain('budget');
    expect(issues[0].suggestions.length).toBeLessThanOrEqual(5);
  });

  it('accepts correct English, contractions, possessives, capitalised words, and acronyms', () => {
    expect(checker.check("Sara's team didn't ship the API, so QA and the CEO's office waited.", new Set(['sara']))).toEqual([]);
    expect(checker.check('The Meeting Starts Monday.', none)).toEqual([]);
  });

  it('skips URLs, emails, @mentions, code, and words glued to digits', () => {
    expect(checker.check('See https://exmaple.com/xyzzq or mail tomw@acmee.io, ping @jdoee, run `npm instal`, ship Q4 v2betta', none)).toEqual([]);
  });

  it('names and project terms in the known set are not flagged', () => {
    expect(checker.check('Priyanka owns Zephyrion.', none).map((i) => i.word)).toEqual(['Priyanka', 'Zephyrion']);
    expect(checker.check('Priyanka owns Zephyrion.', new Set(['priyanka', 'zephyrion']))).toEqual([]);
  });

  it('handles empty and very long text', () => {
    expect(checker.check('', none)).toEqual([]);
    const long = 'the quick brown fox '.repeat(800) + 'jumpd';
    expect(checker.check(long, none).map((i) => i.word)).toEqual(['jumpd']);
  });
});

describe('team dictionary', () => {
  it('adds idempotently, lists, removes, and survives a restart', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'dict-')), 'team-dictionary.json');
    const a = createTeamDictionary(new JsonFileMap<TeamWord>(file), () => new Date('2026-10-04T10:00:00Z'));
    const first = a.add('Zephyrion', 'Million');
    expect(a.add('zephyrion', 'Someone else')).toEqual(first);
    expect(a.list()).toEqual([{ word: 'Zephyrion', addedBy: 'Million', addedAt: '2026-10-04T10:00:00.000Z' }]);
    const b = createTeamDictionary(new JsonFileMap<TeamWord>(file));
    expect(b.words().has('zephyrion')).toBe(true);
    expect(b.remove('ZEPHYRION')).toBe(true);
    expect(b.remove('zephyrion')).toBe(false);
  });

  it('automatically includes participant names and meeting-title words', () => {
    const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
    schedule.create({ title: 'Kubeflow migration sync', start: '2026-10-05T10:00:00Z', end: '2026-10-05T11:00:00Z', participants: [{ name: 'Priyanka Raman', email: 'p@x.io' }] });
    const words = automaticTeamWords({ schedule });
    for (const w of ['kubeflow', 'priyanka', 'raman']) expect(words.has(w)).toBe(true);
    expect(checker.check('Priyanka will finish the Kubeflow plan.', words)).toEqual([]);
  });
});

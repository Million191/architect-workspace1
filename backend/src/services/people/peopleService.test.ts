import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createPeopleService, PersonNotFoundError } from './peopleService';
import { PersonRecord } from './types';
import { JsonFileMap } from '../meetingPipeline/jsonFileMap';

function service(start = '2026-10-04T09:00:00.000Z') {
  let t = Date.parse(start);
  const store = new Map<string, PersonRecord>();
  const svc = createPeopleService({ store, now: () => new Date((t += 1000)) });
  return { svc, store };
}

describe('people service', () => {
  it('creates people from sightings with a readable name and a stable colour', () => {
    const { svc } = service();
    svc.observe([{ email: 'Sara.Lee@acme.com', origin: 'schedule' }]);
    const [sara] = svc.list();
    expect(sara).toMatchObject({ id: 'sara.lee@acme.com', email: 'Sara.Lee@acme.com', name: 'Sara Lee', nameSource: 'derived', origins: ['schedule'] });
    expect(sara.avatarColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('name precedence: People-list edit > calendar > typed with the address > derived from the email', () => {
    const { svc } = service();
    svc.observe([{ email: 'sara@acme.com', name: 'S. Lee', origin: 'meeting' }]);
    expect(svc.get('sara@acme.com')).toMatchObject({ name: 'S. Lee', nameSource: 'entered' });
    svc.observe([{ email: 'sara@acme.com', name: 'Sara Lee', avatarUrl: 'https://photos.example/sara.jpg', origin: 'calendar' }]);
    expect(svc.get('sara@acme.com')).toMatchObject({ name: 'Sara Lee', nameSource: 'calendar', avatarUrl: 'https://photos.example/sara.jpg', photoSource: 'calendar' });
    svc.update('SARA@acme.com', { name: 'Sara (Finance)' });
    expect(svc.get('sara@acme.com')).toMatchObject({ name: 'Sara (Finance)', nameSource: 'edited' });
    // A later calendar sync does not undo the explicit edit…
    svc.observe([{ email: 'sara@acme.com', name: 'Sara Lee', origin: 'calendar' }]);
    expect(svc.get('sara@acme.com').name).toBe('Sara (Finance)');
    // …and clearing the edit falls back to the calendar name.
    svc.update('sara@acme.com', { name: null });
    expect(svc.get('sara@acme.com')).toMatchObject({ name: 'Sara Lee', nameSource: 'calendar' });
  });

  it('observe is idempotent: replaying the same sightings changes nothing, not even updatedAt', () => {
    const { svc } = service();
    const sightings = [{ email: 'tom@acme.com', name: 'Tom Ward', origin: 'schedule' as const }, { email: 'tom@acme.com', name: 'Tom Ward', origin: 'schedule' as const }];
    svc.observe(sightings);
    const first = svc.get('tom@acme.com');
    svc.observe(sightings);
    svc.observe(sightings);
    expect(svc.get('tom@acme.com')).toEqual(first);
    expect(svc.list()).toHaveLength(1);
  });

  it('skips names without an address, invalid addresses, and "names" that are just the address', () => {
    const { svc } = service();
    svc.observe([
      { email: '', name: 'Nobody', origin: 'meeting' },
      { email: 'not-an-email', origin: 'schedule' },
      { email: 'ann@x.io', name: 'ann@x.io', origin: 'meeting' },
    ]);
    expect(svc.list().map((p) => [p.email, p.name, p.nameSource])).toEqual([['ann@x.io', 'Ann', 'derived']]);
  });

  it('photo edits win over calendar photos and can be cleared; unknown people are a clear error', () => {
    const { svc } = service();
    svc.observe([{ email: 'a@x.io', avatarUrl: 'https://cal.example/a.png', origin: 'calendar' }]);
    expect(svc.update('a@x.io', { avatarUrl: 'https://me.example/a.png' }).avatarUrl).toBe('https://me.example/a.png');
    expect(svc.update('a@x.io', { avatarUrl: '' })).toMatchObject({ avatarUrl: 'https://cal.example/a.png', photoSource: 'calendar' });
    expect(() => svc.update('ghost@x.io', { name: 'X' })).toThrow(PersonNotFoundError);
    expect(() => svc.get('ghost@x.io')).toThrow('isn’t in your People list');
  });

  it('lists sorted by name and filters by name or email', () => {
    const { svc } = service();
    svc.observe([{ email: 'zed@x.io', name: 'Zed', origin: 'meeting' }, { email: 'amy@corp.io', name: 'Amy', origin: 'meeting' }]);
    expect(svc.list().map((p) => p.name)).toEqual(['Amy', 'Zed']);
    expect(svc.list('CORP').map((p) => p.name)).toEqual(['Amy']);
    expect(svc.list('nobody')).toEqual([]);
  });

  it('survives a restart when backed by a JSON file', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'people-')), 'people.json');
    const a = createPeopleService({ store: new JsonFileMap<PersonRecord>(file) });
    a.observe([{ email: 'kim@x.io', name: 'Kim', origin: 'schedule' }]);
    a.update('kim@x.io', { name: 'Kim Park' });
    const b = createPeopleService({ store: new JsonFileMap<PersonRecord>(file) });
    expect(b.get('kim@x.io').name).toBe('Kim Park');
    expect(JSON.parse(readFileSync(file, 'utf8'))['kim@x.io'].names).toEqual({ entered: 'Kim', edited: 'Kim Park' });
  });
});

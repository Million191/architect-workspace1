import request from 'supertest';
import { createApp } from '../server';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';

function app() {
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  schedule.create({
    title: 'Budget sync', start: '2026-10-05T10:00:00.000Z', end: '2026-10-05T11:00:00.000Z',
    participants: [{ name: 'Sara Lee', email: 'sara.lee@acme.com' }, { email: 'tom.ward@acme.com' }],
  });
  return createApp({ schedule, people: createPeopleService({ store: new Map<string, PersonRecord>() }) });
}

describe('/api/people', () => {
  it('lists people from scheduled meetings with names, colours, and origins', async () => {
    const res = await request(app()).get('/api/people');
    expect(res.status).toBe(200);
    expect(res.body.people.map((p: { name: string; nameSource: string }) => [p.name, p.nameSource])).toEqual([['Sara Lee', 'entered'], ['Tom Ward', 'derived']]);
    expect(res.body.people[0].origins).toEqual(['schedule']);
  });

  it('filters with ?q= and is safe to call repeatedly', async () => {
    const a = app();
    await request(a).get('/api/people');
    const again = await request(a).get('/api/people?q=tom');
    expect(again.body.people).toHaveLength(1);
    expect(again.body.people[0].email).toBe('tom.ward@acme.com');
  });

  it('saves a name and photo edit, and clearing it restores the earlier name', async () => {
    const a = app();
    await request(a).get('/api/people');
    const saved = await request(a).put('/api/people/tom.ward%40acme.com').send({ name: 'Tom W.', avatarUrl: 'https://photos.example/tom.jpg' });
    expect(saved.status).toBe(200);
    expect(saved.body.person).toMatchObject({ name: 'Tom W.', nameSource: 'edited', avatarUrl: 'https://photos.example/tom.jpg' });
    const cleared = await request(a).put('/api/people/tom.ward%40acme.com').send({ name: null, avatarUrl: null });
    expect(cleared.body.person).toMatchObject({ name: 'Tom Ward', nameSource: 'derived' });
    expect(cleared.body.person.avatarUrl).toBeUndefined();
  });

  it('rejects unsafe photo links, names with markup, unknown fields, and unknown people', async () => {
    const a = app();
    await request(a).get('/api/people');
    for (const avatarUrl of ['javascript:alert(1)', 'http://insecure.example/x.png', 'data:image/png;base64,AAAA']) {
      const r = await request(a).put('/api/people/tom.ward%40acme.com').send({ avatarUrl });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain('https://');
    }
    expect((await request(a).put('/api/people/tom.ward%40acme.com').send({ name: '<b>Tom</b>' })).status).toBe(400);
    expect((await request(a).put('/api/people/tom.ward%40acme.com').send({ email: 'x@y.z' })).status).toBe(400);
    expect((await request(a).put('/api/people/tom.ward%40acme.com').send({ name: 'x'.repeat(201) })).status).toBe(400);
    const missing = await request(a).put('/api/people/ghost%40acme.com').send({ name: 'Ghost' });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('PersonNotFoundError');
  });

  it('answers 503 when the server has no People list', async () => {
    const res = await request(createApp({})).get('/api/people');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('PeopleUnavailable');
  });
});

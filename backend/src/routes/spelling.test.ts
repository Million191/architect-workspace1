import request from 'supertest';
import { createApp } from '../server';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';

function app() {
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  schedule.create({ title: 'Zephyrion launch', start: '2026-10-05T10:00:00Z', end: '2026-10-05T11:00:00Z', participants: [{ name: 'Priyanka Raman', email: 'priyanka@acme.io' }] });
  return createApp({ schedule, people: createPeopleService({ store: new Map<string, PersonRecord>() }) });
}

describe('/api/spellcheck', () => {
  it('checks several texts at once; team words (names, title terms) are known', async () => {
    const res = await request(app()).post('/api/spellcheck').send({ texts: ['Priyanka owns the Zephyrion budjet.', 'All good here.'] });
    expect(res.status).toBe(200);
    expect(res.body.results[0].map((i: { word: string }) => i.word)).toEqual(['budjet']);
    expect(res.body.results[0][0].suggestions).toContain('budget');
    expect(res.body.results[1]).toEqual([]);
  });

  it('“Add to dictionary” makes a word known for everyone, idempotently; it can be removed', async () => {
    const a = app();
    expect((await request(a).post('/api/spellcheck').send({ texts: ['Kubeflowz rocks'] })).body.results[0]).toHaveLength(1);
    const added = await request(a).post('/api/spellcheck/dictionary').send({ word: 'Kubeflowz', addedBy: 'Million' });
    expect(added.status).toBe(200);
    expect((await request(a).post('/api/spellcheck/dictionary').send({ word: 'kubeflowz' })).body.word.addedBy).toBe('Million');
    expect((await request(a).post('/api/spellcheck').send({ texts: ['Kubeflowz rocks'] })).body.results[0]).toEqual([]);
    const listed = (await request(a).get('/api/spellcheck/dictionary')).body;
    expect(listed.words.map((w: { word: string }) => w.word)).toEqual(['Kubeflowz']);
    expect(listed.automaticCount).toBeGreaterThan(0);
    expect((await request(a).delete('/api/spellcheck/dictionary/KUBEFLOWZ')).status).toBe(200);
    expect((await request(a).delete('/api/spellcheck/dictionary/kubeflowz')).status).toBe(404);
  });

  it('rejects malformed requests', async () => {
    const a = app();
    for (const body of [{}, { texts: [] }, { texts: ['x'.repeat(20001)] }, { texts: Array(101).fill('a') }, { texts: ['ok'], extra: 1 }]) {
      expect((await request(a).post('/api/spellcheck').send(body)).status).toBe(400);
    }
    for (const word of ['', 'a', 'two words', '<b>', '123', 'x'.repeat(65)]) {
      expect((await request(a).post('/api/spellcheck/dictionary').send({ word })).status).toBe(400);
    }
  });
});

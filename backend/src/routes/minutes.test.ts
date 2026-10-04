import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { demoAssistant, MinutesAssistant, AssistError } from '../services/minutesDoc/assistant';

function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 3), Buffer.from(salt)]);
}
async function setup(assistant: MinutesAssistant | null = demoAssistant()) {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const app = createApp({ meetingPipeline: createMeetingPipeline(providers, createPipelineStores()), assistant: assistant ?? undefined });
  const res = await request(app).post('/api/meetings/draft').field('title', 'Launch planning').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>').attach('audio', wav('m'), 'm.wav');
  return { app, runId: res.body.runId as string };
}

describe('/api/minutes', () => {
  it('get / save / versions / restore, with validation and conflicts', async () => {
    const { app, runId } = await setup();
    const doc = (await request(app).get(`/api/minutes/${runId}`)).body;
    expect(doc).toMatchObject({ state: 'draft', revision: 1 });
    expect((await request(app).put(`/api/minutes/${runId}`).send({ content: doc.content, baseRevision: 1 })).status).toBe(400); // no name
    doc.content.sections[0].html = '<p>Edited <img src=x onerror=alert(1)></p>';
    const saved = await request(app).put(`/api/minutes/${runId}`).send({ content: doc.content, baseRevision: 1, editedBy: 'Sara Lee' });
    expect(saved.status).toBe(200);
    expect(saved.body.content.sections[0].html).toBe('<p>Edited </p>');
    const conflict = await request(app).put(`/api/minutes/${runId}`).send({ content: doc.content, baseRevision: 1, editedBy: 'Tom Ward' });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: 'MinutesConflict', updatedBy: 'Sara Lee', revision: 2 });
    const versions = (await request(app).get(`/api/minutes/${runId}/versions`)).body.versions;
    expect(versions.map((v: { kind: string }) => v.kind)).toEqual(['edit', 'ai_draft']);
    expect((await request(app).get(`/api/minutes/${runId}/versions/1`)).body.content.sections[0].html).not.toContain('Edited');
    expect((await request(app).post(`/api/minutes/${runId}/versions/1/restore`).send({ baseRevision: 2, editedBy: 'Sara Lee' })).body.revision).toBe(3);
    expect((await request(app).get(`/api/minutes/${runId}/versions/99`)).status).toBe(404);
    expect((await request(app).get('/api/minutes/nope')).status).toBe(404);
  });

  it('AI help returns a suggestion only (nothing saved); unavailable without a provider; failures are explained', async () => {
    const { app, runId } = await setup();
    const doc = (await request(app).get(`/api/minutes/${runId}`)).body;
    const s = doc.content.sections[0];
    const shorter = await request(app).post(`/api/minutes/${runId}/assist`).send({ mode: 'shorter', title: s.title, html: '<p>One. Two. Three. Four.</p>' });
    expect(shorter.body).toEqual({ html: '<p>One. Two.</p>', provider: 'demo' });
    const regen = await request(app).post(`/api/minutes/${runId}/assist`).send({ mode: 'regenerate', title: s.title, html: s.html, startMs: 0, endMs: 10000 });
    expect(regen.body.html).toContain('launch timeline');
    expect((await request(app).get(`/api/minutes/${runId}`)).body.revision).toBe(1); // suggestion was not saved
    expect((await request(app).post(`/api/minutes/${runId}/assist`).send({ mode: 'poem' })).status).toBe(400);

    const none = await setup(null);
    expect((await request(none.app).post(`/api/minutes/${none.runId}/assist`).send({ mode: 'shorter', html: '<p>x</p>' })).body).toMatchObject({ error: 'AssistUnavailable' });
    const broken = await setup({ kind: 'claude', suggest: async () => { throw new AssistError('ModelRefused', 'Claude declined to rewrite this section.'); } });
    const refused = await request(broken.app).post(`/api/minutes/${broken.runId}/assist`).send({ mode: 'formal', html: '<p>x</p>' });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toBe('Claude declined to rewrite this section.');
  });

  it('transcript corrections: words and speaker renames; original kept; history line; search follows', async () => {
    const { app, runId } = await setup();
    const run = (await request(app).get(`/api/meetings/${runId}`)).body;
    const from = run.transcript[0].speakerLabel;
    const renamed = await request(app).put(`/api/minutes/${runId}/transcript`).send({ rename: { from, to: 'Priya Raman' }, lines: [{ index: 1, text: 'Design is done; engineering needs two more weeks for the Zephyrion work.' }], editedBy: 'Sara Lee' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.reason).toMatch(new RegExp(`^Renamed ${from} to Priya Raman and corrected 1 line$`));
    const fresh = (await request(app).get(`/api/meetings/${runId}`)).body;
    expect(fresh.transcript.filter((s: { speakerLabel: string }) => s.speakerLabel === 'Priya Raman').length).toBeGreaterThan(0);
    expect(fresh.transcript[1].text).toContain('Zephyrion');
    const versions = (await request(app).get(`/api/minutes/${runId}/versions`)).body.versions;
    expect(versions[0]).toMatchObject({ kind: 'transcript_correction', author: 'Sara Lee' });
    expect((await request(app).get('/api/search?q=zephyrion')).body.groups[1].total).toBe(1);
    expect((await request(app).put(`/api/minutes/${runId}/transcript`).send({ lines: [{ index: 999, text: 'x' }], editedBy: 'Sara' })).status).toBe(400);
    expect((await request(app).put(`/api/minutes/${runId}/transcript`).send({ rename: { from, to: '' }, editedBy: 'Sara' })).status).toBe(400);
  });

  it('presence: each viewer sees the others (not themselves); old pings expire', async () => {
    const { app, runId } = await setup();
    const ping = (viewerId: string, name: string) => request(app).post(`/api/minutes/${runId}/presence`).send({ viewerId, name });
    expect((await ping('viewer-aaaa-1', 'Sara Lee')).body.viewers).toEqual([]);
    expect((await ping('viewer-bbbb-2', 'Tom Ward')).body.viewers).toEqual([{ name: 'Sara Lee' }]);
    expect((await ping('viewer-aaaa-1', 'Sara Lee')).body.viewers).toEqual([{ name: 'Tom Ward' }]);
    expect((await request(app).post(`/api/minutes/${runId}/presence`).send({ viewerId: 'x' })).status).toBe(400);
  });
});

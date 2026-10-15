import express from 'express';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { createMinutesDocService } from '../services/minutesDoc/minutesDocService';
import { MinutesDocument } from '../services/minutesDoc/types';

/** /api/meetings/:runId — request-changes, emails, participants, DELETE (validation, states, clean-up). */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + 4000, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(4000, 40);
  const samples = Buffer.alloc(4000);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 5) * 6000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function setup() {
  const pipeline = createMeetingPipeline(Object.assign(createDemoProviders(), { emailMode: 'draft-only' as const }), createPipelineStores());
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  const minutesStore = new Map<string, MinutesDocument>();
  const minutes = createMinutesDocService({ store: minutesStore, pipeline });
  return { pipeline, schedule, minutesStore, app: createApp({ meetingPipeline: pipeline, schedule, minutes }) };
}
async function draft(app: express.Express, salt: string): Promise<string> {
  const res = await request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>, Tom Ward <tom@x.io>').field('title', 'Budget review').attach('audio', wav(salt), 'm.wav');
  expect(res.status).toBe(201);
  return res.body.runId as string;
}
const path = (runId: string) => `/api/meetings/${encodeURIComponent(runId)}`;

describe('POST /:runId/request-changes', () => {
  it('records the note (status In progress) and validates input', async () => {
    const { app } = setup();
    const runId = await draft(app, 'r-1');
    const res = await request(app).post(`${path(runId)}/request-changes`).send({ note: 'Add the figures', requestedBy: 'Sara Lee' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'in_progress', stage: 'minutes_pending_approval', changeRequest: { note: 'Add the figures', by: 'Sara Lee' } });
    for (const body of [{}, { note: '   ' }, { note: 'x'.repeat(2001) }, { note: 'ok', extra: 1 }, { note: 'ok', requestedBy: '<b>' }]) {
      expect((await request(app).post(`${path(runId)}/request-changes`).send(body)).status).toBe(400);
    }
    expect((await request(app).post(`${path('nope')}/request-changes`).send({ note: 'x' })).status).toBe(404);
  });
});

describe('PUT /:runId/emails', () => {
  it('409 before the minutes are approved; then saves the edit; validates subject and body', async () => {
    const { app } = setup();
    const runId = await draft(app, 'e-1');
    const edit = { emails: [{ participantName: 'Sara Lee', subject: 'Minutes: Budget review', body: 'Hi Sara,\nEdited.' }], editedBy: 'Sara Lee' };
    expect((await request(app).put(`${path(runId)}/emails`).send(edit)).status).toBe(409);
    await request(app).post(`${path(runId)}/approve-minutes`).send({ approvedBy: 'Sara Lee' });
    const res = await request(app).put(`${path(runId)}/emails`).send(edit);
    expect(res.status).toBe(200);
    expect(res.body.emails.emails.find((e: { participantName: string }) => e.participantName === 'Sara Lee')).toMatchObject({ subject: 'Minutes: Budget review', body: 'Hi Sara,\nEdited.' });
    for (const bad of [{ emails: [] }, { emails: [{ participantName: 'Sara Lee', subject: 'a\nb', body: 'x' }] }, { emails: [{ participantName: 'Sara Lee', subject: 's', body: ' ' }] }]) {
      expect((await request(app).put(`${path(runId)}/emails`).send(bad)).status).toBe(400);
    }
    expect((await request(app).put(`${path(runId)}/emails`).send({ emails: [{ participantName: 'Nobody', subject: 's', body: 'b' }] })).status).toBe(409);
  });
});

describe('PUT /:runId/participants', () => {
  it('renames and adds participants; rejects duplicates, bad addresses and markup', async () => {
    const { app } = setup();
    const runId = await draft(app, 'p-1');
    const res = await request(app).put(`${path(runId)}/participants`).send({ participants: [{ from: 'Sara Lee', name: 'Sara Lee' }, { from: 'Tom Ward', name: 'Thomas Ward' }, { name: 'Priya', email: 'priya@x.io' }] });
    expect(res.status).toBe(200);
    expect(res.body.minutes.meetingSummary.attendees).toEqual(['Sara Lee', 'Thomas Ward', 'Priya']);
    expect(res.body.recipients).toMatchObject({ 'Thomas Ward': 'tom@x.io', Priya: 'priya@x.io' });
    for (const bad of [{ participants: [] }, { participants: [{ name: 'A' }, { name: 'a' }] }, { participants: [{ name: 'A', email: 'nope' }] }, { participants: [{ name: '<A>' }] }]) {
      expect((await request(app).put(`${path(runId)}/participants`).send(bad)).status).toBe(400);
    }
  });
});

describe('DELETE /:runId', () => {
  it('removes the meeting, its minutes document and its calendar link; deleting again still answers 204', async () => {
    const { app, schedule, minutesStore, pipeline } = setup();
    const runId = await draft(app, 'd-1');
    await request(app).get(`/api/minutes/${encodeURIComponent(runId)}`); // the minutes document exists once opened
    expect(minutesStore.has(runId)).toBe(true);
    const m = schedule.create({ title: 'Budget review', start: '2026-10-06T15:00:00.000Z', end: '2026-10-06T16:00:00.000Z', participants: [] }).meeting;
    schedule.linkRecording(m.id, runId);

    expect((await request(app).delete(path(runId))).status).toBe(204);
    expect((await request(app).get('/api/meetings')).body.meetings).toHaveLength(0);
    expect((await request(app).get(path(runId))).status).toBe(404);
    expect(minutesStore.has(runId)).toBe(false);
    expect(schedule.get(m.id).runId).toBeUndefined(); // the calendar entry stays, unlocked
    expect(schedule.get(m.id).history.at(-1)).toMatchObject({ note: 'Recording deleted' });
    expect(pipeline.listMeetings()).toHaveLength(0);
    expect((await request(app).delete(path(runId))).status).toBe(204);
  });

  it('updates the counts the dashboard reads (meetings and action items)', async () => {
    const { app } = setup();
    const a = await draft(app, 'd-2a');
    await draft(app, 'd-2b');
    await request(app).post(`${path(a)}/approve-minutes`).send({ approvedBy: 'Sara' });
    await request(app).post(`${path(a)}/approve-emails`).send({ approvedBy: 'Sara' });
    expect((await request(app).get('/api/meetings/action-items/all')).body.actionItems.length).toBeGreaterThan(0);
    await request(app).delete(path(a));
    expect((await request(app).get('/api/meetings')).body.meetings).toHaveLength(1);
    expect((await request(app).get('/api/meetings/action-items/all')).body.actionItems).toHaveLength(0);
  });
});

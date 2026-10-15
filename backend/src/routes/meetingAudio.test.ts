import { existsSync, mkdtempSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createMeetingAudioStore } from '../services/meetingAudio/meetingAudioStore';
import { applyRetention } from './recordings';
import { createRecordingService } from '../services/recording/recordingService';
import { RecordingStore } from '../services/recording/recordingStore';

/** The audio behind a meeting, played on the Summary step: uploads are kept, deleted with the meeting, and follow retention. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 9), Buffer.from(salt)]);
}
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ma-audio-'));
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'draft-only' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const meetingAudio = createMeetingAudioStore(dir);
  const recordings = createRecordingService({ store: new RecordingStore(mkdtempSync(path.join(os.tmpdir(), 'ma-rec-'))) });
  const settings = new Map<string, string>();
  return { dir, pipeline, meetingAudio, recordings, settings, app: createApp({ meetingPipeline: pipeline, meetingAudio, recordings, settings }) };
}
const upload = (app: ReturnType<typeof setup>['app'], salt: string, name = 'meeting.wav') =>
  request(app).post('/api/meetings/draft').field('attendees', 'Sara Lee <sara@x.io>').field('title', 'Audio test').attach('audio', wav(salt), name);

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('meeting audio', () => {
  it('an uploaded file is kept and played back; uploading it again keeps one copy; unknown meetings say there is no audio', async () => {
    const { app, dir } = setup();
    const runId = (await upload(app, 'a-1')).body.runId as string;
    const res = await request(app).get(`/api/meetings/${encodeURIComponent(runId)}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^audio\/wav/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body as Buffer, wav('a-1'))).toBe(0);
    await upload(app, 'a-1');
    expect(readdirSync(dir).filter((f) => !f.endsWith('.tmp'))).toHaveLength(1);
    expect(readdirSync(dir)[0]).toMatch(/^[a-f0-9]{64}\.wav$/); // named by a hash, never by the uploaded file name
    const none = await request(app).get('/api/meetings/nope/audio');
    expect(none.status).toBe(404);
    expect(none.body).toEqual({ error: 'NoAudio', message: 'No audio is kept for this meeting.' });
  });

  it('deleting the meeting deletes its audio', async () => {
    const { app, meetingAudio } = setup();
    const runId = (await upload(app, 'a-2')).body.runId as string;
    expect(meetingAudio.find(runId)).toBeDefined();
    expect((await request(app).delete(`/api/meetings/${encodeURIComponent(runId)}`)).status).toBe(204);
    expect(meetingAudio.find(runId)).toBeUndefined();
    expect((await request(app).get(`/api/meetings/${encodeURIComponent(runId)}/audio`)).status).toBe(404);
  });

  it('the "Keep raw meeting audio" setting applies to kept uploads too', async () => {
    const { app, pipeline, meetingAudio, recordings, settings } = setup();
    const runId = (await upload(app, 'a-3')).body.runId as string;
    settings.set('rawAudioRetention', 'after_approval');
    expect(applyRetention({ recordings, pipeline, settings, meetingAudio })).toEqual([]); // not reviewed yet
    await pipeline.approveMinutes(runId, 'Sara Lee');
    await pipeline.approveEmailsAndSend(runId, 'Sara Lee');
    expect(applyRetention({ recordings, pipeline, settings, meetingAudio })).toEqual([runId]);
    expect(meetingAudio.find(runId)).toBeUndefined();
    expect(applyRetention({ recordings, pipeline, settings, meetingAudio })).toEqual([]); // idempotent
    settings.set('rawAudioRetention', 'keep');
    const kept = (await upload(app, 'a-4')).body.runId as string;
    await pipeline.approveMinutes(kept, 'Sara Lee');
    await pipeline.approveEmailsAndSend(kept, 'Sara Lee');
    expect(applyRetention({ recordings, pipeline, settings, meetingAudio })).toEqual([]);
    expect(meetingAudio.find(kept)).toBeDefined();
  });

  it('only playable types are kept', () => {
    const store = createMeetingAudioStore(mkdtempSync(path.join(os.tmpdir(), 'ma-audio-t-')));
    expect(store.save('run-1', Buffer.from('x'), 'notes.txt')).toBe(false);
    expect(store.save('run-1', Buffer.from('x'), 'call.MP3')).toBe(true);
    expect(store.find('run-1')).toMatchObject({ mime: 'audio/mpeg' });
    expect(existsSync(store.find('run-1')!.path)).toBe(true);
    expect(store.save('run-1', Buffer.from('y'), 'call.mp3')).toBe(false); // first copy kept
  });
});

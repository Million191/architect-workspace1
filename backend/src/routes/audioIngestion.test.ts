import express from 'express';
import request from 'supertest';
import { createAudioIngestionRouter } from './audioIngestion';
import { PlatformClient, PlatformRecording } from '../services/audioIngestion/types';
import { UpstreamUnavailableError, UpstreamTimeoutError } from '../services/audioIngestion/errors';

function clientReturning(recording: PlatformRecording): PlatformClient {
  return { fetchRecording: jest.fn().mockResolvedValue(recording) };
}

function clientRejectingWith(error: unknown): PlatformClient {
  return { fetchRecording: jest.fn().mockRejectedValue(error) };
}

function appWith(deps: {
  zoomClientFactory?: () => PlatformClient;
  teamsClientFactory?: () => PlatformClient;
  meetClientFactory?: () => PlatformClient;
}) {
  const app = express();
  app.use(express.json());
  app.use('/api/audio', createAudioIngestionRouter(deps));
  return app;
}

describe.each([
  { platform: 'zoom', path: '/api/audio/ingest/zoom', factoryKey: 'zoomClientFactory' as const },
  { platform: 'teams', path: '/api/audio/ingest/teams', factoryKey: 'teamsClientFactory' as const },
  { platform: 'meet', path: '/api/audio/ingest/meet', factoryKey: 'meetClientFactory' as const },
])('POST $path', ({ path, factoryKey }) => {
  it('acceptance: a virtual meeting recording becomes available for transcription (201)', async () => {
    const client = clientReturning({
      files: [{ id: 'file-happy', fileExtension: 'm4a', fileSizeBytes: 4096, downloadUrl: 'https://example.com/f' }],
    });
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({ meetingRef: 'meeting-happy' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('available_for_transcription');
  });

  it('acceptance: rejects a non-supported audio format with a clear error message (422)', async () => {
    const client = clientReturning({
      files: [{ id: 'file-format', fileExtension: 'mov', fileSizeBytes: 4096, downloadUrl: 'https://example.com/f' }],
    });
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({ meetingRef: 'meeting-format' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('UnsupportedFormatError');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it('failure path: a corrupted recording file is rejected, not passed through as available (422)', async () => {
    const client = clientReturning({
      files: [{ id: 'file-corrupt', fileExtension: 'm4a', fileSizeBytes: 0, downloadUrl: null }],
    });
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({ meetingRef: 'meeting-corrupt' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('CorruptedAudioError');
  });

  it('failure path: an upstream timeout surfaces as a clear error, not a crash (504)', async () => {
    const client = clientRejectingWith(new UpstreamTimeoutError('timed out'));
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({ meetingRef: 'meeting-timeout' });

    expect(res.status).toBe(504);
    expect(res.body.error).toBe('UpstreamTimeoutError');
  });

  it('failure path: an upstream 5xx surfaces as a clear error (502)', async () => {
    const client = clientRejectingWith(new UpstreamUnavailableError('platform is down'));
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({ meetingRef: 'meeting-unavailable' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('UpstreamUnavailableError');
  });

  it('validation: missing meetingRef is rejected before any upstream call (400)', async () => {
    const client = clientReturning({ files: [] });
    const app = appWith({ [factoryKey]: () => client });

    const res = await request(app).post(path).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(client.fetchRecording).not.toHaveBeenCalled();
  });
});

describe('missing platform credentials fail loud, not silently', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('Zoom: 500 ConfigurationError naming the missing env vars', async () => {
    delete process.env.ZOOM_ACCOUNT_ID;
    delete process.env.ZOOM_CLIENT_ID;
    delete process.env.ZOOM_CLIENT_SECRET;

    const app = express();
    app.use(express.json());
    app.use('/api/audio', createAudioIngestionRouter()); // no override: real env-based factory

    const res = await request(app).post('/api/audio/ingest/zoom').send({ meetingRef: 'meeting-1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ConfigurationError');
    expect(res.body.message).toMatch(/ZOOM_ACCOUNT_ID/);
  });

  it('Teams: 500 ConfigurationError naming the missing env vars', async () => {
    delete process.env.TEAMS_TENANT_ID;
    delete process.env.TEAMS_CLIENT_ID;
    delete process.env.TEAMS_CLIENT_SECRET;
    delete process.env.TEAMS_ORGANIZER_USER_ID;

    const app = express();
    app.use(express.json());
    app.use('/api/audio', createAudioIngestionRouter()); // no override: real env-based factory

    const res = await request(app).post('/api/audio/ingest/teams').send({ meetingRef: 'online-meeting-1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ConfigurationError');
    expect(res.body.message).toMatch(/TEAMS_TENANT_ID/);
  });

  it('Meet: 500 ConfigurationError naming the missing env vars', async () => {
    delete process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_MEET_PRIVATE_KEY;
    delete process.env.GOOGLE_MEET_IMPERSONATED_USER_EMAIL;

    const app = express();
    app.use(express.json());
    app.use('/api/audio', createAudioIngestionRouter()); // no override: real env-based factory

    const res = await request(app).post('/api/audio/ingest/meet').send({ meetingRef: 'conference-record-1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ConfigurationError');
    expect(res.body.message).toMatch(/GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL/);
  });
});

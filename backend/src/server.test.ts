import request from 'supertest';
import { createApp } from './server';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('malformed request bodies', () => {
  it('rejects invalid JSON with a clear 400, not a crash or a bare error page', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/audio/ingest/zoom')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'ValidationError', message: 'Request body is not valid JSON.' });
  });
});

import { createTeamsClient } from './teamsClient';
import { UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError, ContractViolationError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headResponse(status: number, contentLength: string | null): Response {
  const headers = new Headers();
  if (contentLength !== null) headers.set('content-length', contentLength);
  return new Response(null, { status, headers });
}

const baseConfig = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  organizerUserId: 'organizer@example.com',
  timeoutMs: 50,
  maxAttempts: 3,
};

describe('createTeamsClient (real Microsoft Graph OAuth + recordings API shape, network mocked)', () => {
  it('exchanges credentials for a token, lists recordings, and HEADs each for its size', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-abc' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { value: [{ id: 'rec-1', recordingContentUrl: 'https://graph.example/content/rec-1' }] })
      )
      .mockResolvedValueOnce(headResponse(200, '10240'));

    const client = createTeamsClient({ ...baseConfig, fetchImpl });
    const recording = await client.fetchRecording('online-meeting-1');

    expect(recording).toEqual({
      files: [{ id: 'rec-1', fileExtension: 'mp4', fileSizeBytes: 10240, downloadUrl: 'https://graph.example/content/rec-1' }],
    });

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(String(tokenUrl)).toContain('/oauth2/v2.0/token');
    expect(tokenInit.body).toContain('grant_type=client_credentials');

    const [listUrl, listInit] = fetchImpl.mock.calls[1];
    expect(String(listUrl)).toContain('/users/organizer%40example.com/onlineMeetings/online-meeting-1/recordings');
    expect((listInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-abc');

    const [headUrl, headInit] = fetchImpl.mock.calls[2];
    expect(String(headUrl)).toBe('https://graph.example/content/rec-1');
    expect(headInit.method).toBe('HEAD');
  });

  it('treats a recording with no content URL as zero-size (caught as corrupted upstream by the service layer)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-abc' }))
      .mockResolvedValueOnce(jsonResponse(200, { value: [{ id: 'rec-2' }] }));

    const client = createTeamsClient({ ...baseConfig, fetchImpl });
    const recording = await client.fetchRecording('online-meeting-2');

    expect(recording.files).toEqual([{ id: 'rec-2', fileExtension: 'mp4', fileSizeBytes: 0, downloadUrl: null }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no HEAD call when there's no content URL
  });

  it('wraps a 5xx from Graph as UpstreamUnavailableError and retries up to maxAttempts', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { message: 'Service unavailable' }));

    const client = createTeamsClient({ ...baseConfig, fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('online-meeting-1')).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('wraps a 4xx from Graph as UpstreamRejectedError and does not retry', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-abc' }))
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' }));

    const client = createTeamsClient({ ...baseConfig, fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('online-meeting-1')).rejects.toBeInstanceOf(UpstreamRejectedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('raises ContractViolationError when the recordings response has no value array', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-abc' }))
      .mockResolvedValueOnce(jsonResponse(200, { unexpected: true }));

    const client = createTeamsClient({ ...baseConfig, fetchImpl, maxAttempts: 1 });

    await expect(client.fetchRecording('online-meeting-1')).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('times out and wraps as UpstreamTimeoutError when Graph never responds', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => new Promise(() => {})); // hangs forever

    const client = createTeamsClient({ ...baseConfig, fetchImpl, timeoutMs: 10, maxAttempts: 1 });

    await expect(client.fetchRecording('online-meeting-1')).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});

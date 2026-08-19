import { createZoomClient } from './zoomClient';
import { UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError, ContractViolationError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const baseConfig = {
  accountId: 'acct-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  timeoutMs: 50,
  maxAttempts: 3,
};

describe('createZoomClient (real Zoom OAuth + recordings API shape, network mocked)', () => {
  it('exchanges credentials for a token then fetches and maps recording files', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-123' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uuid: 'meeting-uuid',
          id: 555,
          recording_files: [
            { id: 'file-1', file_type: 'M4A', file_extension: 'M4A', file_size: 2048, download_url: 'https://zoom.example/file-1' },
          ],
        })
      );

    const client = createZoomClient({ ...baseConfig, fetchImpl });
    const recording = await client.fetchRecording('meeting-123');

    expect(recording).toEqual({
      files: [{ id: 'file-1', fileExtension: 'M4A', fileSizeBytes: 2048, downloadUrl: 'https://zoom.example/file-1' }],
    });

    // First call is the OAuth token exchange, using Basic auth over client id/secret.
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(String(tokenUrl)).toContain('/oauth/token');
    expect((tokenInit.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    // Second call is the recordings fetch, authorized with the token from step one.
    const [recordingsUrl, recordingsInit] = fetchImpl.mock.calls[1];
    expect(String(recordingsUrl)).toContain('/meetings/meeting-123/recordings');
    expect((recordingsInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('wraps a 5xx from Zoom as UpstreamUnavailableError and retries up to maxAttempts', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { message: 'Service unavailable' }));

    const client = createZoomClient({ ...baseConfig, fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('meeting-123')).rejects.toBeInstanceOf(UpstreamUnavailableError);
    // Each attempt makes one OAuth call; the 503 comes back from the OAuth step itself here.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('wraps a 4xx from Zoom as UpstreamRejectedError and does not retry', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-123' }))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Meeting not found' }));

    const client = createZoomClient({ ...baseConfig, fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('missing-meeting')).rejects.toBeInstanceOf(UpstreamRejectedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one OAuth call + one rejected recordings call, no retry
  });

  it('raises ContractViolationError when the OAuth response has no access_token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { scope: 'recording:read' }));

    const client = createZoomClient({ ...baseConfig, fetchImpl, maxAttempts: 1 });

    await expect(client.fetchRecording('meeting-123')).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('times out and wraps as UpstreamTimeoutError when Zoom never responds', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => new Promise(() => {})); // hangs forever

    const client = createZoomClient({ ...baseConfig, fetchImpl, timeoutMs: 10, maxAttempts: 1 });

    await expect(client.fetchRecording('meeting-123')).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});

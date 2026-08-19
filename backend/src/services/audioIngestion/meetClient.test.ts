import { generateKeyPairSync } from 'crypto';
import { createMeetClient } from './meetClient';
import { UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError, ContractViolationError } from './errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A throwaway keypair generated fresh per test run — never a checked-in secret.
let privateKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  privateKey = pair.privateKey;
});

function baseConfig() {
  return {
    serviceAccountEmail: 'meeting-assistant@example.iam.gserviceaccount.com',
    privateKey,
    impersonatedUserEmail: 'organizer@example.com',
    timeoutMs: 50,
    maxAttempts: 3,
  };
}

describe('createMeetClient (real Google Meet OAuth + recordings API shape, network mocked)', () => {
  it('signs a JWT assertion for a token, lists recordings, and reads size from Drive metadata', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-xyz' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          recordings: [
            {
              name: 'conferenceRecords/cr-1/recordings/rec-1',
              driveDestination: { file: 'drive-file-1', exportUri: 'https://drive.google.com/file/d/drive-file-1' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { size: '20480' }));

    const client = createMeetClient({ ...baseConfig(), fetchImpl });
    const recording = await client.fetchRecording('cr-1');

    expect(recording).toEqual({
      files: [
        {
          id: 'conferenceRecords/cr-1/recordings/rec-1',
          fileExtension: 'mp4',
          fileSizeBytes: 20480,
          downloadUrl: 'https://drive.google.com/file/d/drive-file-1',
        },
      ],
    });

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(String(tokenUrl)).toContain('oauth2.googleapis.com/token');
    expect(tokenInit.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    const assertion = new URLSearchParams(tokenInit.body).get('assertion');
    expect(assertion?.split('.')).toHaveLength(3); // header.payload.signature

    const [listUrl] = fetchImpl.mock.calls[1];
    expect(String(listUrl)).toContain('/conferenceRecords/cr-1/recordings');

    const [driveUrl] = fetchImpl.mock.calls[2];
    expect(String(driveUrl)).toContain('/files/drive-file-1');
  });

  it('skips a recording with no Drive destination yet (still processing) rather than erroring', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-xyz' }))
      .mockResolvedValueOnce(jsonResponse(200, { recordings: [{ name: 'conferenceRecords/cr-2/recordings/rec-2' }] }));

    const client = createMeetClient({ ...baseConfig(), fetchImpl });
    const recording = await client.fetchRecording('cr-2');

    expect(recording.files).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no Drive lookup without a file id
  });

  it('wraps a 5xx from Google as UpstreamUnavailableError and retries up to maxAttempts', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { message: 'Service unavailable' }));

    const client = createMeetClient({ ...baseConfig(), fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('cr-1')).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('wraps a 4xx from Google as UpstreamRejectedError and does not retry', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-xyz' }))
      .mockResolvedValueOnce(jsonResponse(404, { message: 'Not found' }));

    const client = createMeetClient({ ...baseConfig(), fetchImpl, maxAttempts: 3 });

    await expect(client.fetchRecording('missing-cr')).rejects.toBeInstanceOf(UpstreamRejectedError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('raises ContractViolationError when the recordings response has no recordings array', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-xyz' }))
      .mockResolvedValueOnce(jsonResponse(200, { unexpected: true }));

    const client = createMeetClient({ ...baseConfig(), fetchImpl, maxAttempts: 1 });

    await expect(client.fetchRecording('cr-1')).rejects.toBeInstanceOf(ContractViolationError);
  });

  it('times out and wraps as UpstreamTimeoutError when Google never responds', async () => {
    const fetchImpl = jest.fn().mockImplementation(() => new Promise(() => {})); // hangs forever

    const client = createMeetClient({ ...baseConfig(), fetchImpl, timeoutMs: 10, maxAttempts: 1 });

    await expect(client.fetchRecording('cr-1')).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});

import { createSign } from 'crypto';
import { ContractViolationError, UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError } from './errors';
import { withTimeoutAndRetry } from './withTimeoutAndRetry';
import { PlatformClient, PlatformRecording, PlatformRecordingFile } from './types';

export interface MeetClientConfig {
  /** Workspace service account with domain-wide delegation. */
  serviceAccountEmail: string;
  /** PEM-encoded RSA private key for that service account. */
  privateKey: string;
  /** The delegated subject (an admin or the meeting organizer) the service account acts as. */
  impersonatedUserEmail: string;
  /** Overrides for tests; default to Google's real endpoints. */
  tokenUrl?: string;
  meetApiBaseUrl?: string;
  driveApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_MEET_API_BASE_URL = 'https://meet.googleapis.com/v2';
const DEFAULT_DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const JWT_LIFETIME_SECONDS = 3600;
const MEET_SCOPES = 'https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/drive.readonly';

function isRetryableMeetError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError || error instanceof UpstreamUnavailableError;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds and signs the JWT-bearer assertion for Google's service-account OAuth2 flow (RFC 7523). */
function buildSignedAssertion(config: {
  serviceAccountEmail: string;
  privateKey: string;
  impersonatedUserEmail: string;
  tokenUrl: string;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.serviceAccountEmail,
    scope: MEET_SCOPES,
    aud: config.tokenUrl,
    sub: config.impersonatedUserEmail,
    iat: nowSeconds,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(config.privateKey);

  return `${unsigned}.${base64url(signature)}`;
}

interface GoogleTokenResponse {
  access_token?: string;
}

interface MeetRecordingsResponse {
  recordings?: Array<{
    name: string;
    driveDestination?: { file?: string; exportUri?: string };
  }>;
}

interface DriveFileMetadataResponse {
  size?: string;
}

export function createMeetClient(config: MeetClientConfig): PlatformClient {
  const {
    serviceAccountEmail,
    privateKey,
    impersonatedUserEmail,
    tokenUrl = DEFAULT_TOKEN_URL,
    meetApiBaseUrl = DEFAULT_MEET_API_BASE_URL,
    driveApiBaseUrl = DEFAULT_DRIVE_API_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = config;

  async function rejectOnHttpError(response: Response, context: Record<string, unknown>): Promise<void> {
    if (response.ok) return;
    if (response.status >= 500) {
      throw new UpstreamUnavailableError('Google API returned a server error', { ...context, status: response.status });
    }
    throw new UpstreamRejectedError('Google API rejected the request', { ...context, status: response.status });
  }

  async function getAccessToken(signal: AbortSignal): Promise<string> {
    const assertion = buildSignedAssertion({ serviceAccountEmail, privateKey, impersonatedUserEmail, tokenUrl });
    const formBody = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      signal,
    });
    await rejectOnHttpError(response, { step: 'oauth_token' });

    const body = (await response.json()) as GoogleTokenResponse;
    if (!body.access_token) {
      throw new ContractViolationError('Google OAuth response was missing access_token', { step: 'oauth_token' });
    }
    return body.access_token;
  }

  /** The Meet API only points at a Drive file; Drive's own metadata endpoint has the real size. */
  async function fetchDriveFileSize(fileId: string, accessToken: string, signal: AbortSignal): Promise<number> {
    const url = `${driveApiBaseUrl}/files/${encodeURIComponent(fileId)}?fields=size`;
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
    if (!response.ok) return 0;
    const body = (await response.json()) as DriveFileMetadataResponse;
    return body.size ? Number(body.size) : 0;
  }

  async function fetchRecordingOnce(conferenceRecordId: string, signal: AbortSignal): Promise<PlatformRecording> {
    const accessToken = await getAccessToken(signal);
    const url = `${meetApiBaseUrl}/conferenceRecords/${encodeURIComponent(conferenceRecordId)}/recordings`;

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    await rejectOnHttpError(response, { step: 'fetch_recordings', conferenceRecordId });

    const body = (await response.json()) as MeetRecordingsResponse;
    if (!body.recordings) {
      throw new ContractViolationError('Meet recordings response was missing the recordings array', {
        step: 'fetch_recordings',
        conferenceRecordId,
      });
    }

    const files: PlatformRecordingFile[] = [];
    for (const item of body.recordings) {
      const driveFileId = item.driveDestination?.file;
      if (!driveFileId) continue; // recording not yet exported to Drive

      const fileSizeBytes = await fetchDriveFileSize(driveFileId, accessToken, signal);
      files.push({
        id: item.name,
        // Meet recordings, like Teams, are always MP4 (video container, AAC audio track) —
        // see the SUPPORTED_AUDIO_FORMATS comment in types.ts.
        fileExtension: 'mp4',
        fileSizeBytes,
        downloadUrl: item.driveDestination?.exportUri ?? null,
      });
    }

    return { files };
  }

  return {
    fetchRecording(conferenceRecordId: string): Promise<PlatformRecording> {
      return withTimeoutAndRetry((signal) => fetchRecordingOnce(conferenceRecordId, signal), {
        timeoutMs,
        maxAttempts,
        isRetryable: isRetryableMeetError,
        operationName: `meet.fetchRecording(${conferenceRecordId})`,
      });
    },
  };
}

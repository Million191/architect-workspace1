import { ContractViolationError, UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError } from './errors';
import { withTimeoutAndRetry } from './withTimeoutAndRetry';
import { PlatformClient, PlatformRecording } from './types';

export interface ZoomClientConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
  /** Override for tests; defaults to Zoom's real endpoints. */
  oauthBaseUrl?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

const DEFAULT_OAUTH_BASE_URL = 'https://zoom.us';
const DEFAULT_API_BASE_URL = 'https://api.zoom.us/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableZoomError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError || error instanceof UpstreamUnavailableError;
}

interface ZoomOAuthResponse {
  access_token?: string;
}

interface ZoomRecordingsResponse {
  uuid?: string;
  id?: number | string;
  recording_files?: Array<{
    id: string;
    file_type: string;
    file_extension: string;
    file_size: number;
    download_url?: string;
  }>;
}

export function createZoomClient(config: ZoomClientConfig): PlatformClient {
  const {
    accountId,
    clientId,
    clientSecret,
    oauthBaseUrl = DEFAULT_OAUTH_BASE_URL,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = config;

  async function rejectOnHttpError(response: Response, context: Record<string, unknown>): Promise<void> {
    if (response.ok) return;
    if (response.status >= 500) {
      throw new UpstreamUnavailableError('Zoom API returned a server error', {
        ...context,
        status: response.status,
      });
    }
    throw new UpstreamRejectedError('Zoom API rejected the request', {
      ...context,
      status: response.status,
    });
  }

  async function getAccessToken(signal: AbortSignal): Promise<string> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const url = `${oauthBaseUrl}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}` },
      signal,
    });
    await rejectOnHttpError(response, { step: 'oauth_token' });

    const body = (await response.json()) as ZoomOAuthResponse;
    if (!body.access_token) {
      throw new ContractViolationError('Zoom OAuth response was missing access_token', { step: 'oauth_token' });
    }
    return body.access_token;
  }

  async function fetchRecordingOnce(meetingId: string, signal: AbortSignal): Promise<PlatformRecording> {
    const accessToken = await getAccessToken(signal);
    const url = `${apiBaseUrl}/meetings/${encodeURIComponent(meetingId)}/recordings`;

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    await rejectOnHttpError(response, { step: 'fetch_recordings', meetingId });

    const body = (await response.json()) as ZoomRecordingsResponse;
    if (!body.uuid || body.id === undefined) {
      throw new ContractViolationError('Zoom recordings response was missing uuid/id', { step: 'fetch_recordings', meetingId });
    }

    return {
      files: (body.recording_files ?? []).map((file) => ({
        id: file.id,
        fileExtension: file.file_extension,
        fileSizeBytes: file.file_size,
        downloadUrl: file.download_url ?? null,
      })),
    };
  }

  return {
    fetchRecording(meetingId: string): Promise<PlatformRecording> {
      return withTimeoutAndRetry((signal) => fetchRecordingOnce(meetingId, signal), {
        timeoutMs,
        maxAttempts,
        isRetryable: isRetryableZoomError,
        operationName: `zoom.fetchRecording(${meetingId})`,
      });
    },
  };
}

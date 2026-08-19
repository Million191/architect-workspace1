import { ContractViolationError, UpstreamRejectedError, UpstreamUnavailableError, UpstreamTimeoutError } from './errors';
import { withTimeoutAndRetry } from './withTimeoutAndRetry';
import { PlatformClient, PlatformRecording, PlatformRecordingFile } from './types';

export interface TeamsClientConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Graph app-only calls act on a specific mailbox; the meeting organizer's user id or UPN. */
  organizerUserId: string;
  /** Overrides for tests; default to Microsoft's real endpoints. */
  authorityBaseUrl?: string;
  graphBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

const DEFAULT_AUTHORITY_BASE_URL = 'https://login.microsoftonline.com';
const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableTeamsError(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError || error instanceof UpstreamUnavailableError;
}

interface GraphTokenResponse {
  access_token?: string;
}

interface GraphRecordingListResponse {
  value?: Array<{ id: string; recordingContentUrl?: string }>;
}

export function createTeamsClient(config: TeamsClientConfig): PlatformClient {
  const {
    tenantId,
    clientId,
    clientSecret,
    organizerUserId,
    authorityBaseUrl = DEFAULT_AUTHORITY_BASE_URL,
    graphBaseUrl = DEFAULT_GRAPH_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = config;

  async function rejectOnHttpError(response: Response, context: Record<string, unknown>): Promise<void> {
    if (response.ok) return;
    if (response.status >= 500) {
      throw new UpstreamUnavailableError('Microsoft Graph returned a server error', { ...context, status: response.status });
    }
    throw new UpstreamRejectedError('Microsoft Graph rejected the request', { ...context, status: response.status });
  }

  async function getAccessToken(signal: AbortSignal): Promise<string> {
    const url = `${authorityBaseUrl}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const formBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
      signal,
    });
    await rejectOnHttpError(response, { step: 'oauth_token' });

    const body = (await response.json()) as GraphTokenResponse;
    if (!body.access_token) {
      throw new ContractViolationError('Microsoft Graph OAuth response was missing access_token', { step: 'oauth_token' });
    }
    return body.access_token;
  }

  /** The recordings list doesn't include file size; a HEAD request against the content URL does. */
  async function fetchContentLength(url: string, accessToken: string, signal: AbortSignal): Promise<number> {
    const response = await fetchImpl(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!response.ok) return 0;
    const length = response.headers.get('content-length');
    return length ? Number(length) : 0;
  }

  async function fetchRecordingOnce(onlineMeetingId: string, signal: AbortSignal): Promise<PlatformRecording> {
    const accessToken = await getAccessToken(signal);
    const url = `${graphBaseUrl}/users/${encodeURIComponent(organizerUserId)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/recordings`;

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    await rejectOnHttpError(response, { step: 'fetch_recordings', onlineMeetingId });

    const body = (await response.json()) as GraphRecordingListResponse;
    if (!body.value) {
      throw new ContractViolationError('Microsoft Graph recordings response was missing the value array', {
        step: 'fetch_recordings',
        onlineMeetingId,
      });
    }

    const files: PlatformRecordingFile[] = [];
    for (const item of body.value) {
      const downloadUrl = item.recordingContentUrl ?? null;
      const fileSizeBytes = downloadUrl ? await fetchContentLength(downloadUrl, accessToken, signal) : 0;
      files.push({
        id: item.id,
        // Teams cloud recordings are always MP4 (video container, AAC audio track) — see
        // the SUPPORTED_AUDIO_FORMATS comment in types.ts for why mp4 is accepted here.
        fileExtension: 'mp4',
        fileSizeBytes,
        downloadUrl,
      });
    }

    return { files };
  }

  return {
    fetchRecording(onlineMeetingId: string): Promise<PlatformRecording> {
      return withTimeoutAndRetry((signal) => fetchRecordingOnce(onlineMeetingId, signal), {
        timeoutMs,
        maxAttempts,
        isRetryable: isRetryableTeamsError,
        operationName: `teams.fetchRecording(${onlineMeetingId})`,
      });
    },
  };
}

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ingestVirtualMeetingRecording } from '../services/audioIngestion/audioIngestionService';
import { createZoomClient } from '../services/audioIngestion/zoomClient';
import { createTeamsClient } from '../services/audioIngestion/teamsClient';
import { createMeetClient } from '../services/audioIngestion/meetClient';
import { PlatformClient, VirtualMeetingPlatform } from '../services/audioIngestion/types';
import {
  CorruptedAudioError,
  UnsupportedFormatError,
  UpstreamRejectedError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  ContractViolationError,
  ConfigurationError,
  IngestionError,
} from '../services/audioIngestion/errors';

function requireEnv(names: string[]): Record<string, string> | ConfigurationError {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (!value) missing.push(name);
    else values[name] = value;
  }
  if (missing.length > 0) {
    return new ConfigurationError(`Missing required configuration: ${missing.join(', ')}.`);
  }
  return values;
}

function buildZoomClientFromEnv(): PlatformClient {
  const env = requireEnv(['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET']);
  if (env instanceof ConfigurationError) throw env;
  return createZoomClient({ accountId: env.ZOOM_ACCOUNT_ID, clientId: env.ZOOM_CLIENT_ID, clientSecret: env.ZOOM_CLIENT_SECRET });
}

function buildTeamsClientFromEnv(): PlatformClient {
  const env = requireEnv(['TEAMS_TENANT_ID', 'TEAMS_CLIENT_ID', 'TEAMS_CLIENT_SECRET', 'TEAMS_ORGANIZER_USER_ID']);
  if (env instanceof ConfigurationError) throw env;
  return createTeamsClient({
    tenantId: env.TEAMS_TENANT_ID,
    clientId: env.TEAMS_CLIENT_ID,
    clientSecret: env.TEAMS_CLIENT_SECRET,
    organizerUserId: env.TEAMS_ORGANIZER_USER_ID,
  });
}

function buildMeetClientFromEnv(): PlatformClient {
  const env = requireEnv(['GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_MEET_PRIVATE_KEY', 'GOOGLE_MEET_IMPERSONATED_USER_EMAIL']);
  if (env instanceof ConfigurationError) throw env;
  return createMeetClient({
    serviceAccountEmail: env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL,
    // Env vars can't hold real newlines; PEM keys are stored with literal "\n" escapes.
    privateKey: env.GOOGLE_MEET_PRIVATE_KEY.replace(/\\n/g, '\n'),
    impersonatedUserEmail: env.GOOGLE_MEET_IMPERSONATED_USER_EMAIL,
  });
}

function statusForError(error: unknown): { status: number; message: string } {
  if (error instanceof UnsupportedFormatError) return { status: 422, message: error.message };
  if (error instanceof CorruptedAudioError) return { status: 422, message: error.message };
  if (error instanceof ConfigurationError) return { status: 500, message: error.message };
  if (error instanceof UpstreamRejectedError) return { status: 502, message: 'The meeting platform rejected the request.' };
  if (error instanceof ContractViolationError) return { status: 502, message: 'The meeting platform returned an unexpected response.' };
  if (error instanceof UpstreamTimeoutError) return { status: 504, message: 'The meeting platform timed out.' };
  if (error instanceof UpstreamUnavailableError) return { status: 502, message: 'The meeting platform is unavailable.' };
  return { status: 500, message: 'Audio ingestion failed unexpectedly.' };
}

const meetingRefRequestSchema = z.object({
  meetingRef: z.string().min(1, 'meetingRef is required'),
});

async function handleIngestRequest(
  req: Request,
  res: Response,
  platform: VirtualMeetingPlatform,
  clientFactory: () => PlatformClient
): Promise<void> {
  const parsed = meetingRefRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'ValidationError', message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    return;
  }

  const { meetingRef } = parsed.data;

  try {
    const client = clientFactory();
    const ingested = await ingestVirtualMeetingRecording(platform, meetingRef, { client });
    res.status(201).json(ingested);
  } catch (error) {
    const errorClass = error instanceof IngestionError ? error.errorClass : 'UnknownError';
    const { status, message } = statusForError(error);

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'audio-ingestion',
        event: 'audio_ingestion_failed',
        outcome: 'failure',
        error_class: errorClass,
        context: {
          platform,
          meetingRef,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
    );

    res.status(status).json({ error: errorClass, message });
  }
}

export interface AudioIngestionRouterDeps {
  zoomClientFactory?: () => PlatformClient;
  teamsClientFactory?: () => PlatformClient;
  meetClientFactory?: () => PlatformClient;
}

export function createAudioIngestionRouter(deps: AudioIngestionRouterDeps = {}): Router {
  const router = Router();
  const zoomClientFactory = deps.zoomClientFactory ?? buildZoomClientFromEnv;
  const teamsClientFactory = deps.teamsClientFactory ?? buildTeamsClientFromEnv;
  const meetClientFactory = deps.meetClientFactory ?? buildMeetClientFromEnv;

  router.post('/ingest/zoom', (req: Request, res: Response) => {
    void handleIngestRequest(req, res, 'zoom', zoomClientFactory);
  });

  router.post('/ingest/teams', (req: Request, res: Response) => {
    void handleIngestRequest(req, res, 'teams', teamsClientFactory);
  });

  router.post('/ingest/meet', (req: Request, res: Response) => {
    void handleIngestRequest(req, res, 'meet', meetClientFactory);
  });

  return router;
}

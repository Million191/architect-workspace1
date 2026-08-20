import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ingestPhysicalRecording } from '../services/audioIngestion/physicalAudioIngestionService';
import { IngestedAudio } from '../services/audioIngestion/types';
import { statusForIngestionError, errorClassOf } from './errorResponse';

// Generous for a single meeting recording; arbitrary otherwise — revisit once real usage exists.
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const physicalSourceSchema = z.enum(['room_mic', 'phone']);

function logIngestionFailure(source: unknown, originalFilename: string | undefined, error: unknown): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'audio-ingestion',
      event: 'audio_ingestion_failed',
      outcome: 'failure',
      error_class: errorClassOf(error),
      context: {
        source,
        originalFilename,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    })
  );
}

export interface PhysicalAudioIngestionRouterDeps {
  idempotencyStore?: Map<string, IngestedAudio>;
  maxUploadBytes?: number;
}

export function createPhysicalAudioIngestionRouter(deps: PhysicalAudioIngestionRouterDeps = {}): Router {
  const router = Router();
  const maxUploadBytes = deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes } });

  router.post('/ingest/physical', (req: Request, res: Response, _next: NextFunction) => {
    upload.single('audio')(req, res, (uploadError: unknown) => {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
          res
            .status(413)
            .json({ error: 'PayloadTooLarge', message: `Uploaded file exceeds the ${maxUploadBytes}-byte limit.` });
          return;
        }
        res.status(400).json({ error: 'ValidationError', message: 'Could not parse the uploaded file.' });
        return;
      }

      const parsedSource = physicalSourceSchema.safeParse(req.body.source);
      if (!parsedSource.success) {
        res.status(400).json({ error: 'ValidationError', message: 'source must be "room_mic" or "phone".' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'ValidationError', message: 'An "audio" file is required.' });
        return;
      }

      try {
        const ingested = ingestPhysicalRecording(parsedSource.data, req.file.originalname, req.file.buffer, {
          idempotencyStore: deps.idempotencyStore,
        });
        res.status(201).json(ingested);
      } catch (error) {
        logIngestionFailure(parsedSource.data, req.file.originalname, error);
        const { status, message } = statusForIngestionError(error);
        res.status(status).json({ error: errorClassOf(error), message });
      }
    });
  });

  return router;
}

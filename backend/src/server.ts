import express, { Express, Request, Response, NextFunction } from 'express';
import { createAudioIngestionRouter } from './routes/audioIngestion';
import { createPhysicalAudioIngestionRouter } from './routes/physicalAudioIngestion';

function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400 && 'body' in err;
}

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // express.json() rejects malformed bodies with a bare SyntaxError; without this handler
  // it falls through to Express's default error page instead of our usual {error, message} shape.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (isJsonParseError(err)) {
      res.status(400).json({ error: 'ValidationError', message: 'Request body is not valid JSON.' });
      return;
    }
    next(err);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/audio', createAudioIngestionRouter());
  app.use('/api/audio', createPhysicalAudioIngestionRouter());

  return app;
}

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(JSON.stringify({ event: 'server_started', port, outcome: 'success' }));
  });
}

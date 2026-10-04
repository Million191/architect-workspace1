import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PeopleService, PersonNotFoundError } from '../services/people/peopleService';
import { PersonSighting } from '../services/people/types';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../services/schedule/scheduleService';

const editSchema = z
  .object({
    name: z.string().max(200).regex(/^[^<>\r\n]*$/, 'Names can’t contain < > or line breaks.').nullable().optional(),
    // Photos are shown as <img src>, so only https URLs (no javascript:, data:, or plain http).
    avatarUrl: z.string().max(2048).regex(/^(https:\/\/\S+)?$/, 'Photo links must start with https://').nullable().optional(),
  })
  .strict();

export interface PeopleRouterDeps {
  people?: PeopleService;
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
}

/** Everyone currently appearing in meetings and scheduled meetings (calendar sync adds its own sightings). */
function currentSightings(deps: PeopleRouterDeps): PersonSighting[] {
  const fromMeetings = (deps.pipeline?.listMeetings() ?? []).flatMap((m) =>
    m.people.filter((p) => p.email).map((p) => ({ email: p.email as string, name: p.name, origin: 'meeting' as const }))
  );
  const fromSchedule = (deps.schedule?.listAll() ?? []).flatMap((m) =>
    m.participants.map((p) => ({ email: p.email, name: p.name, origin: 'schedule' as const }))
  );
  return [...fromMeetings, ...fromSchedule];
}

export function createPeopleRouter(deps: PeopleRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => (deps.people ? next() : res.status(503).json({ error: 'PeopleUnavailable', message: 'The People list isn’t set up on this server.' })));
  const svc = () => deps.people as PeopleService;

  // Lists everyone. Refreshing from meetings first is idempotent (unchanged people aren't rewritten).
  router.get('/', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined;
    svc().observe(currentSightings(deps));
    res.status(200).json({ people: svc().list(q) });
  });

  router.put('/:id', (req: Request, res: Response) => {
    const body = editSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    try {
      res.status(200).json({ person: svc().update(req.params.id, body.data) });
    } catch (error) {
      if (error instanceof PersonNotFoundError) { res.status(404).json({ error: error.errorClass, message: error.message }); return; }
      res.status(500).json({ error: 'UnknownError', message: 'Couldn’t save that change. Try again.' });
    }
  });

  return router;
}

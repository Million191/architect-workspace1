import { UniqueConstraintError } from '../services/storage/uniqueIndex';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PeopleService, PersonConflictError, PersonNotFoundError, PersonValidationError } from '../services/people/peopleService';
import { PersonSighting } from '../services/people/types';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../services/schedule/scheduleService';

const nameField = z.string().max(200).regex(/^[^<>\r\n]*$/, 'Names can’t contain < > or line breaks.');
// Photos are shown as <img src>, so only https URLs (no javascript:, data:, or plain http).
const photoField = z.string().max(2048).regex(/^(https:\/\/\S+)?$/, 'Photo links must start with https://');
const roleField = z.string().trim().max(100, 'Keep the role under 100 characters.').regex(/^[^<>\r\n]*$/, 'Roles can’t contain < > or line breaks.');
const emailField = z.string().trim().max(320).regex(/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/, 'Type a valid email address, like name@example.com.');
const editSchema = z
  .object({ name: nameField.nullable().optional(), avatarUrl: photoField.nullable().optional(), email: emailField.optional(), role: roleField.nullable().optional() })
  .strict();
const addSchema = z.object({ name: nameField.trim().min(1, 'Type the person’s name.'), email: emailField, avatarUrl: photoField.optional(), role: roleField.optional() }).strict();

export interface PeopleRouterDeps {
  people?: PeopleService;
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
  /** A corrected address: carried into unsent meetings and calendar entries created in the app. */
  onEmailChanged?: (from: string, to: string) => void;
  /** A corrected name: carried into meetings not yet emailed to that person. Returns how many meetings changed. */
  onNameChanged?: (email: string, name: string) => number;
}

function sendPeopleError(res: Response, error: unknown): void {
  if (error instanceof PersonNotFoundError) { res.status(404).json({ error: error.errorClass, message: error.message }); return; }
  if (error instanceof PersonConflictError) { res.status(409).json({ error: error.errorClass, message: error.message }); return; }
  if (error instanceof UniqueConstraintError) { res.status(409).json({ error: error.errorClass, message: 'That email address is already in your People list.' }); return; }
  if (error instanceof PersonValidationError) { res.status(400).json({ error: error.errorClass, message: error.message }); return; }
  console.error(JSON.stringify({ event: 'people_route_failed', error_class: (error as Error)?.name ?? 'UnknownError', outcome: 'failure' }));
  res.status(500).json({ error: 'UnknownError', message: 'Couldn’t save that change. Try again.' });
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

  // Lists everyone. Refreshing from meetings first is idempotent (unchanged people aren't rewritten);
  // people no longer in any meeting or calendar entry are removed unless added by hand or corrected.
  router.get('/', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined;
    const sightings = currentSightings(deps);
    svc().observe(sightings);
    svc().prune(sightings.map((s) => s.email));
    res.status(200).json({ people: svc().list(q) });
  });

  // "+ Add person" (the same address again updates that person).
  router.post('/', (req: Request, res: Response) => {
    const body = addSchema.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') }); return; }
    try { res.status(201).json({ person: svc().add({ name: body.data.name, email: body.data.email, avatarUrl: body.data.avatarUrl || undefined, role: body.data.role || undefined }) }); } catch (e) { sendPeopleError(res, e); }
  });

  router.put('/:id', (req: Request, res: Response) => {
    const body = editSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') });
      return;
    }
    try {
      const before = svc().get(req.params.id);
      const person = svc().update(req.params.id, body.data);
      if (person.id !== before.id) {
        try { deps.onEmailChanged?.(before.email, person.email); } catch (error) {
          console.error(JSON.stringify({ event: 'person_email_propagation_failed', error_class: (error as Error).name, outcome: 'partial' }));
        }
      }
      let syncedMeetings = 0;
      if (person.name !== before.name) {
        try { syncedMeetings = deps.onNameChanged?.(person.email, person.name) ?? 0; } catch (error) {
          console.error(JSON.stringify({ event: 'person_name_propagation_failed', error_class: (error as Error).name, outcome: 'partial' }));
        }
      }
      res.status(200).json({ person, syncedMeetings });
    } catch (error) { sendPeopleError(res, error); }
  });

  return router;
}

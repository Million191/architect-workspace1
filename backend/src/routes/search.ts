import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { collectSearchDocs } from '../services/search/searchDocuments';
import { SearchService } from '../services/search/searchService';
import { MeetingPipeline } from '../services/meetingPipeline/meetingPipelineService';
import { ScheduleService } from '../services/schedule/scheduleService';
import { PeopleService } from '../services/people/peopleService';

const querySchema = z.object({
  q: z.string().max(200).default(''),
  group: z.enum(['meetings', 'transcripts', 'actionItems']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(3),
  exact: z.enum(['1', 'true']).optional(),
});

export interface SearchRouterDeps {
  search: SearchService;
  pipeline?: MeetingPipeline;
  schedule?: ScheduleService;
  people?: PeopleService;
}

export function createSearchRouter(deps: SearchRouterDeps): Router {
  const router = Router();

  // GET /api/search?q=budjet[&group=transcripts&limit=50&exact=1]
  router.get('/', (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'ValidationError', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ') });
      return;
    }
    const started = Date.now();
    try {
      const people = deps.people;
      // Bring the index up to date with whatever changed since the last search (only changed documents are touched).
      deps.search.sync(collectSearchDocs({
        pipeline: deps.pipeline,
        schedule: deps.schedule,
        nameFor: people ? (email) => { try { return people.get(email).name; } catch { return undefined; } } : undefined,
      }));
      const { q, group, limit, exact } = parsed.data;
      res.status(200).json(deps.search.search(q, { group, limit, exact: !!exact }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'search_failed', error_class: error instanceof Error ? error.name : 'UnknownError', duration_ms: Date.now() - started, outcome: 'failure' }));
      res.status(500).json({ error: 'SearchFailed', message: 'Search isn’t working right now. Try again.' });
    }
  });

  return router;
}

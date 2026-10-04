import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DictionaryUnavailableError, SpellChecker } from '../services/spelling/spellChecker';
import { automaticTeamWords, TeamDictionary, TeamDictionarySources } from '../services/spelling/teamDictionary';

const checkSchema = z.object({ texts: z.array(z.string().max(20000)).min(1).max(100) }).strict();
const wordSchema = z.object({
  word: z.string().trim().min(2).max(64).regex(/^[\p{L}][\p{L}'’-]*$/u, 'Only letters, apostrophes, and hyphens can be added.'),
  addedBy: z.string().trim().max(200).optional(),
}).strict();

export interface SpellingRouterDeps extends TeamDictionarySources {
  checker: SpellChecker;
  team: TeamDictionary;
}

export function createSpellingRouter(deps: SpellingRouterDeps): Router {
  const router = Router();
  const known = () => new Set([...deps.team.words(), ...automaticTeamWords(deps)]);

  // POST /api/spellcheck { texts: [...] } → { results: [[issue…] per text] }. Reports only; never changes text.
  router.post('/', (req: Request, res: Response) => {
    const body = checkSchema.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') }); return; }
    try {
      const words = known();
      res.status(200).json({ results: body.data.texts.map((t) => deps.checker.check(t, words)) });
    } catch (error) {
      if (error instanceof DictionaryUnavailableError) { res.status(503).json({ error: error.errorClass, message: error.message }); return; }
      console.error(JSON.stringify({ event: 'spellcheck_failed', error_class: error instanceof Error ? error.name : 'UnknownError', outcome: 'failure' }));
      res.status(500).json({ error: 'SpellcheckFailed', message: 'Spell check isn’t working right now.' });
    }
  });

  router.get('/dictionary', (_req: Request, res: Response) => {
    res.status(200).json({ words: deps.team.list(), automaticCount: automaticTeamWords(deps).size });
  });

  router.post('/dictionary', (req: Request, res: Response) => {
    const body = wordSchema.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'ValidationError', message: body.error.issues.map((i) => i.message).join(' ') }); return; }
    res.status(200).json({ word: deps.team.add(body.data.word, body.data.addedBy) });
  });

  router.delete('/dictionary/:word', (req: Request, res: Response) => {
    const removed = deps.team.remove(String(req.params.word).slice(0, 64));
    res.status(removed ? 200 : 404).json(removed ? { removed: true } : { error: 'WordNotFound', message: 'That word isn’t in the team dictionary.' });
  });

  return router;
}

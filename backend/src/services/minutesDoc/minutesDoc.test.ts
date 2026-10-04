import { createMeetingPipeline, createPipelineStores } from '../meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../meetingPipeline/demoProviders';
import { createMinutesDocService, MinutesError } from './minutesDocService';
import { htmlToText, listItems, sanitizeHtml } from './html';
import { contentFromDraft, draftFromContent } from './convert';
import { MinutesContent, MinutesDocument } from './types';

function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 3), Buffer.from(salt)]);
}

async function setup(emailMode: 'send' | 'draft-only' = 'draft-only') {
  let t = Date.parse('2026-10-04T10:00:00Z');
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode });
  const send = jest.spyOn(providers.emailDeliveryClient, 'send');
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const run = await pipeline.draftMinutes({ originalFilename: 'm.wav', buffer: wav('doc'), source: 'room_mic', attendeeNames: ['Sara Lee', 'Tom Ward'], attendeeEmails: { 'Sara Lee': 'sara@x.io', 'Tom Ward': 'tom@x.io' }, meetingContext: { title: 'Launch planning' } });
  const store = new Map<string, MinutesDocument>();
  const svc = createMinutesDocService({ store, pipeline, now: () => new Date(t) });
  return { svc, pipeline, runId: run.runId, store, send, advance: (ms: number) => { t += ms; } };
}
const clone = (c: MinutesContent): MinutesContent => JSON.parse(JSON.stringify(c));
type Edited = { edited?: boolean };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('minutes HTML', () => {
  it('keeps the editor’s formatting and strips everything else', () => {
    expect(sanitizeHtml('<h2>Plan</h2><p><strong>Bold</strong> <em>it</em> <a href="https://x.io">link</a></p><ol><li data-list="bullet">a</li></ol>'))
      .toBe('<h2>Plan</h2><p><strong>Bold</strong> <em>it</em> <a href="https://x.io" target="_blank" rel="noopener noreferrer">link</a></p><ol><li data-list="bullet">a</li></ol>');
    expect(sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><img src=x onerror=alert(1)></p>')).toBe('<p>hi</p>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">bad</a> <a href=data:text/html,x>also</a>')).toBe('bad also');
    expect(sanitizeHtml('<b>b</b><i>i</i><h1>t</h1><div>d</div>')).toBe('<strong>b</strong><em>i</em><h2>t</h2><p>d</p>');
    expect(sanitizeHtml('<p>unclosed <strong>bold')).toBe('<p>unclosed <strong>bold</strong></p>');
    expect(sanitizeHtml('<p>5 < 6 & "ok"</p>')).toBe('<p>5 &lt; 6 &amp; "ok"</p>');
  });
  it('reads plain text and list items back out', () => {
    expect(htmlToText('<h2>T</h2><p>a &amp; b</p><ul><li>one</li><li>two</li></ul>')).toBe('T\na & b\n\n• one\n• two');
    expect(listItems('<ul><li>One</li><li><strong>Two</strong> — why</li></ul>')).toEqual(['One', 'Two — why']);
    expect(listItems('<p>Line one</p><p>Line two</p>')).toEqual(['Line one', 'Line two']);
  });
});

describe('minutes document', () => {
  it('opens the AI draft as sections + action items (version 1, by AI), nothing marked edited', async () => {
    const { svc, runId } = await setup();
    const v = svc.get(runId);
    expect(v).toMatchObject({ state: 'draft', revision: 1, updatedBy: 'AI', versionCount: 1 });
    expect(v.content.sections.length).toBeGreaterThan(1);
    expect(v.content.sections.some((s) => s.kind === 'decisions')).toBe(true);
    expect(v.content.sections.every((s) => !s.edited)).toBe(true);
    expect(v.content.actionItems.length).toBeGreaterThan(0);
    expect(svc.versions(runId)[0]).toMatchObject({ number: 1, kind: 'ai_draft', author: 'AI' });
  });

  it('save: sanitises, marks edits, updates the pipeline draft (so emails/search follow), folds quick autosaves into one version', async () => {
    const { svc, pipeline, runId, advance } = await setup();
    const v = svc.get(runId);
    const c = clone(v.content);
    c.sections[0].html = '<p>Rewritten <strong>summary</strong><script>x</script></p>';
    c.sections.push({ id: 'next-steps-1', kind: 'next_steps', title: 'Next steps', html: '<ul><li>Ship it</li></ul>' });
    c.actionItems.push({ id: 'new-item-1', task: 'Write the release note', owner: 'Tom Ward', dueDate: '2026-10-10', priority: 'high', status: 'open' });
    c.actionItems[0].dismissed = true;
    const saved = svc.save(runId, c, 1, 'Sara Lee');
    expect(saved.revision).toBe(2);
    expect(saved.content.sections[0]).toMatchObject({ html: '<p>Rewritten <strong>summary</strong></p>', edited: true });
    expect(saved.content.sections.at(-1)).toMatchObject({ title: 'Next steps', edited: true });
    const draft = pipeline.getRun(runId).minutes;
    expect(draft.discussionTopics[0].summary).toBe('Rewritten summary');
    expect(draft.discussionTopics.at(-1)).toMatchObject({ topic: 'Next steps', summary: '• Ship it' });
    expect(draft.actionItems.map((a) => a.task)).toContain('Write the release note');
    expect(draft.actionItems).toHaveLength(c.actionItems.length - 1); // dismissed one left out

    advance(30000);
    const c2 = clone(saved.content as MinutesContent);
    c2.sections[0].html = '<p>Rewritten again</p>';
    svc.save(runId, c2, 2, 'Sara Lee');
    expect(svc.versions(runId).map((x) => [x.number, x.kind, x.author])).toEqual([[2, 'edit', 'Sara Lee'], [1, 'ai_draft', 'AI']]);
    advance(6 * 60000);
    const c3 = clone(svc.get(runId).content as MinutesContent);
    c3.sections[0].title = 'Renamed';
    svc.save(runId, c3, 3, 'Sara Lee');
    expect(svc.versions(runId)).toHaveLength(3);
    // Identical content is a no-op (autosave can repeat).
    expect(svc.save(runId, c3, 4, 'Sara Lee').revision).toBe(4);
  });

  it('someone else’s newer save is a conflict naming them, never an overwrite', async () => {
    const { svc, runId } = await setup();
    const base = clone(svc.get(runId).content);
    const mine = clone(base);
    mine.sections[0].html = '<p>Tom’s version</p>';
    svc.save(runId, mine, 1, 'Tom Ward');
    const theirs = clone(base);
    theirs.sections[0].html = '<p>Sara’s version</p>';
    expect(() => svc.save(runId, theirs, 1, 'Sara Lee')).toThrow(MinutesError);
    try { svc.save(runId, theirs, 1, 'Sara Lee'); } catch (e) { expect((e as MinutesError).details).toMatchObject({ revision: 2, updatedBy: 'Tom Ward' }); expect((e as Error).message).toBe('Tom Ward updated this draft. Reload to see their changes.'); }
  });

  it('the client can’t forge AI originals or bad values', async () => {
    const { svc, runId } = await setup();
    const c = clone(svc.get(runId).content);
    c.sections[0].aiHtml = '<p>fake</p>';
    c.actionItems[0].priority = 'urgent' as never;
    c.actionItems[0].dueDate = 'tomorrow';
    c.actionItems[0].sourceTimestampMs = 999999;
    const before = svc.get(runId).content;
    const v = svc.save(runId, c, 1, 'Sara');
    expect(v.content.sections[0].aiHtml).toBe(before.sections[0].aiHtml);
    expect(v.content.actionItems[0]).toMatchObject({ priority: undefined, dueDate: undefined, sourceTimestampMs: before.actionItems[0].sourceTimestampMs });
    const dup = clone(c);
    dup.sections[1].id = dup.sections[0].id;
    expect(() => svc.save(runId, dup, 2, 'Sara')).toThrow('duplicate id');
  });

  it('restore makes a new version from an old one (history is never rewritten)', async () => {
    const { svc, runId, advance } = await setup();
    const original = clone(svc.get(runId).content);
    const c = clone(original);
    c.sections[0].html = '<p>Edited</p>';
    svc.save(runId, c, 1, 'Sara');
    advance(1000);
    const restored = svc.restore(runId, 1, 2, 'Sara');
    expect(restored.content.sections[0].html).toBe(original.sections[0].html);
    expect((restored.content.sections[0] as Edited).edited).toBe(false);
    expect(svc.versions(runId)[0]).toMatchObject({ number: 3, kind: 'restore', restoredFrom: 1 });
    expect(() => svc.version(runId, 99)).toThrow('doesn’t exist');
  });

  it('approval locks; editing approved minutes needs a reason, makes a new version, and sends “Updated minutes” once', async () => {
    const { svc, pipeline, runId, send } = await setup('send');
    await pipeline.approveMinutes(runId, 'Sara Lee');
    expect(svc.get(runId).state).toBe('locked');
    expect(() => svc.save(runId, clone(svc.get(runId).content), 1, 'Sara')).toThrow('waiting for approval');
    await pipeline.approveEmailsAndSend(runId, 'Sara Lee');
    send.mockClear();
    const approved = svc.get(runId);
    expect(approved).toMatchObject({ state: 'approved', approval: { by: 'Sara Lee', stage: 'final' } });
    expect(() => svc.save(runId, clone(approved.content), approved.revision, 'Sara')).toThrow('Edit approved minutes');
    expect(() => svc.startAmendment(runId, 'x', 'Sara')).toThrow('why');

    const amending = svc.startAmendment(runId, 'Fixed the launch date', 'Sara Lee');
    expect(amending).toMatchObject({ state: 'amending', amending: { reason: 'Fixed the launch date' } });
    const c = clone(amending.content);
    c.sections[0].html = '<p>Launch moves to Nov 3.</p>';
    const saved = svc.save(runId, c, amending.revision, 'Sara Lee');
    expect(saved.pendingUpdateEmail).toMatchObject({ reason: 'Fixed the launch date' });
    expect(pipeline.getRun(runId).minutes.discussionTopics[0].summary).toBe('Launch moves to Nov 3.');
    expect(svc.versions(runId)[0]).toMatchObject({ kind: 'amendment', reason: 'Fixed the launch date', author: 'Sara Lee' });
    expect(svc.finishAmendment(runId).state).toBe('approved');

    const result = await svc.sendUpdate(runId, 'Sara Lee');
    expect(result.sentTo.sort()).toEqual(['Sara Lee', 'Tom Ward']);
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0][0] as { subject: string }).subject).toBe('Updated minutes: Launch planning');
    expect((send.mock.calls[0][0] as { body: string }).body).toContain('What changed: Fixed the launch date');
    await expect(svc.sendUpdate(runId, 'Sara Lee')).rejects.toThrow('no changes to send');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('round-trips the AI draft through content without losing topics, decisions, or items', async () => {
    const { pipeline, runId } = await setup();
    const draft = pipeline.getRun(runId).minutes;
    const back = draftFromContent(draft, contentFromDraft(draft));
    expect(back.discussionTopics.map((t) => [t.topic, t.summary])).toEqual(draft.discussionTopics.map((t) => [t.topic, t.summary]));
    expect(back.decisions).toHaveLength(draft.decisions.length);
    expect(back.actionItems.map((a) => [a.task, a.owner, a.sourceTimestampMs])).toEqual(draft.actionItems.map((a) => [a.task, a.owner, a.sourceTimestampMs]));
  });
});

import request from 'supertest';
import { createApp } from '../server';
import { createMeetingPipeline, createPipelineStores } from '../services/meetingPipeline/meetingPipelineService';
import { createDemoProviders } from '../services/meetingPipeline/demoProviders';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';

/** A name corrected on People reaches every meeting not yet emailed to that person — never one already sent. */
function wav(salt: string): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + 4000, 4); header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(4000, 40);
  return Buffer.concat([header, Buffer.alloc(4000, 4), Buffer.from(salt)]);
}
function setup() {
  const providers = Object.assign(createDemoProviders(), { mode: 'live' as const, emailMode: 'send' as const });
  const pipeline = createMeetingPipeline(providers, createPipelineStores());
  const app = createApp({ meetingPipeline: pipeline, people: createPeopleService({ store: new Map<string, PersonRecord>() }), email: { mode: 'send', deliver: providers.emailDeliveryClient } });
  return { app, pipeline, outbox: providers.outbox };
}
const upload = async (app: ReturnType<typeof setup>['app'], title: string, salt: string) =>
  (await request(app).post('/api/meetings/draft').field('attendees', 'Sara <sara@x.io>, Tom <tom@x.io>').field('title', title).attach('audio', wav(salt), 'm.wav')).body.runId as string;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('renaming on People updates drafts and unsent emails (name + greeting), leaves sent emails alone, and is idempotent', async () => {
  const { app, pipeline, outbox } = setup();
  const inReview = await upload(app, 'Still in review', 'ps-1');
  const drafted = await upload(app, 'Email drafted', 'ps-2');
  await pipeline.approveMinutes(drafted, 'Million');
  const sent = await upload(app, 'Already sent', 'ps-3');
  await pipeline.approveMinutes(sent, 'Million');
  await pipeline.approveEmailsAndSend(sent, 'Million', { recipients: ['Sara'] });
  await request(app).get('/api/people'); // the People list picks up the participants

  const res = await request(app).put('/api/people/sara@x.io').send({ name: 'Sara Lee' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ person: { name: 'Sara Lee' }, syncedMeetings: 2 });

  // In review: renamed everywhere in the draft.
  const a = pipeline.getRun(inReview);
  expect(a.minutes.meetingSummary.attendees).toEqual(['Sara Lee', 'Tom']);
  expect(a.recipients).toEqual({ 'Sara Lee': 'sara@x.io', Tom: 'tom@x.io' });

  // Email drafted: recipient and greeting renamed; Tom untouched.
  const b = pipeline.getRun(drafted);
  const saraEmail = b.emails!.emails.find((e) => e.participantName === 'Sara Lee')!;
  expect(saraEmail.body.startsWith('Hi Sara Lee,')).toBe(true);
  expect(b.emails!.emails.find((e) => e.participantName === 'Tom')!.body.startsWith('Hi Tom,')).toBe(true);
  expect(b.recipients!['Sara Lee']).toBe('sara@x.io');

  // Already sent to Sara: nothing changes (the email that went out stays as it was).
  const c = pipeline.getRun(sent);
  expect(c.emails!.emails.find((e) => e.participantName === 'Sara')!.body.startsWith('Hi Sara,')).toBe(true);
  expect(outbox.map((e) => e.participantName)).toEqual(['Sara']);

  // The renamed person then receives the email under the new name.
  await pipeline.approveEmailsAndSend(drafted, 'Million', { recipients: ['Sara Lee'] });
  expect(outbox[outbox.length - 1]).toMatchObject({ participantName: 'Sara Lee' });
  expect(outbox[outbox.length - 1].body.startsWith('Hi Sara Lee,')).toBe(true);

  // Saving the same name again changes nothing.
  expect((await request(app).put('/api/people/sara@x.io').send({ name: 'Sara Lee', role: 'Analyst' })).body.syncedMeetings).toBe(0);
});

import request from 'supertest';
import { createApp } from '../server';
import { createPeopleService } from '../services/people/peopleService';
import { PersonRecord } from '../services/people/types';
import { createScheduleService } from '../services/schedule/scheduleService';
import { ScheduledMeeting } from '../services/schedule/types';
import { openPage, Page, waitFor } from './__testutils__/pageHarness';

/** Double-submits: the second click of a double-click is ignored, busy buttons can't fire, identical writes are merged. */
let page: Page | undefined;
afterEach(() => page?.close());
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

type Win = { MouseEvent: typeof MouseEvent; MA: { ui: { button(label: string, variant: string, onClick: () => unknown, opts?: object): HTMLButtonElement }; api: { people: { add(p: object): Promise<unknown> }; schedule: { create(b: object): Promise<{ meeting: { id: string } }> } } } };

function app() {
  const people = createPeopleService({ store: new Map<string, PersonRecord>() });
  const schedule = createScheduleService({ store: new Map<string, ScheduledMeeting>() });
  return { people, schedule, app: createApp({ people, schedule }) };
}

it('buttons: a double-click runs once; a pending action keeps the button disabled; repeatable buttons still repeat', async () => {
  page = openPage(app().app, '/');
  const win = page.dom.window as unknown as Win;
  await waitFor(() => !!win.MA && !!win.MA.ui, 'scripts');
  let runs = 0, finish: () => void = () => undefined;
  const b = win.MA.ui.button('Send', 'primary', () => { runs++; return new Promise<void>((r) => { finish = r; }); });
  page.doc.body.appendChild(b);
  const click = (detail: number) => b.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail } as MouseEventInit));
  click(1); click(2); // a real double-click: second event has detail 2
  expect(runs).toBe(1);
  expect(b.disabled).toBe(true);
  expect(b.getAttribute('aria-busy')).toBe('true');
  b.disabled = false; click(1); // even if something re-enables it, a busy button doesn't fire
  expect(runs).toBe(1);
  finish();
  await waitFor(() => b.getAttribute('aria-busy') === null, 'done');
  expect(b.disabled).toBe(false);
  click(1);
  expect(runs).toBe(2); // a new click after the first finished is a new action

  let steps = 0;
  const next = win.MA.ui.button('Next', 'ghost', () => { steps++; }, { repeatable: true });
  page.doc.body.appendChild(next);
  next.dispatchEvent(new win.MouseEvent('click', { detail: 1 } as MouseEventInit));
  next.dispatchEvent(new win.MouseEvent('click', { detail: 2 } as MouseEventInit));
  expect(steps).toBe(2);
});

it('the same write sent twice before the first answers is one request; the server also keeps one record', async () => {
  const { app: server, people, schedule } = app();
  page = openPage(server, '/');
  const win = page.dom.window as unknown as Win;
  await waitFor(() => !!win.MA && !!win.MA.api, 'scripts');
  const before = page.calls.filter((c) => c.startsWith('POST /api/people')).length;
  await Promise.all([win.MA.api.people.add({ name: 'Ann', email: 'ann@x.io' }), win.MA.api.people.add({ name: 'Ann', email: 'ann@x.io' })]);
  expect(page.calls.filter((c) => c.startsWith('POST /api/people')).length - before).toBe(1);
  expect(people.list().map((p) => p.email)).toEqual(['ann@x.io']);

  // Sent again later (not merged on the page): the server still creates one meeting.
  const body = { title: 'Board review', start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T16:00:00.000Z', participants: [] };
  const first = await request(server).post('/api/schedule').send(body);
  const again = await request(server).post('/api/schedule').send(body);
  expect([first.status, again.status]).toEqual([201, 200]);
  expect(again.body).toMatchObject({ duplicate: true, meeting: { id: first.body.meeting.id } });
  expect(schedule.listAll()).toHaveLength(1);
});

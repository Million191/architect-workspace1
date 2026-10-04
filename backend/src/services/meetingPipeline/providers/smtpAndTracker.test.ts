import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Transporter } from 'nodemailer';
import { createSmtpEmailClient, readSmtpConfig } from './smtpEmailClient';
import { createJsonActionItemTracker } from './jsonActionItemTracker';
import { JsonFileMap } from '../jsonFileMap';
import { DraftedEmail } from '../../emailDrafting/types';

const FULL_ENV = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'me@example.com', SMTP_PASS: 'app-password', MAIL_FROM: 'me@example.com' };
const EMAIL: DraftedEmail = { participantName: 'Me', subject: 'Recap', body: 'Hello', actionItems: [] };

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** A stand-in transport: records what would be sent. No network connection is ever opened. */
function fakeTransport(sendMail: jest.Mock = jest.fn(async () => ({ messageId: '<m1>', accepted: ['me@example.com'] }))) {
  return { sendMail, transport: { sendMail } as unknown as Transporter };
}

describe('readSmtpConfig', () => {
  it('names exactly which variables are missing and never returns a half-configured sender', () => {
    const { config, problems } = readSmtpConfig({ SMTP_HOST: 'smtp.example.com' });
    expect(config).toBeUndefined();
    expect(problems).toEqual(['Email: set SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (SMTP settings for sending).']);
  });

  it('rejects a bad port or sender address', () => {
    expect(readSmtpConfig({ ...FULL_ENV, SMTP_PORT: 'abc' }).problems.join(' ')).toMatch(/SMTP_PORT must be a port number/);
    expect(readSmtpConfig({ ...FULL_ENV, MAIL_FROM: 'Me <me@example.com>' }).problems.join(' ')).toMatch(/MAIL_FROM must be a plain email address/);
  });

  it('accepts a complete configuration and an optional recipient allowlist', () => {
    const { config, problems } = readSmtpConfig({ ...FULL_ENV, SMTP_ALLOWED_RECIPIENTS: 'Me@Example.com, other@example.com' });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ host: 'smtp.example.com', port: 465, allowedRecipients: ['me@example.com', 'other@example.com'] });
  });
});

describe('createSmtpEmailClient', () => {
  const config = readSmtpConfig(FULL_ENV).config!;

  it('sends one message to the resolved address with the idempotency key header', async () => {
    const { sendMail, transport } = fakeTransport();
    await createSmtpEmailClient(config, transport).send(EMAIL, { idempotencyKey: 'run:Me', to: 'me@example.com' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: 'me@example.com',
      to: { name: 'Me', address: 'me@example.com' },
      subject: 'Recap',
      text: 'Hello',
      headers: { 'X-Meeting-Assistant-Key': 'run:Me' },
    });
  });

  it('refuses without an address or outside the allowlist, without contacting the server', async () => {
    const { sendMail, transport } = fakeTransport();
    const client = createSmtpEmailClient({ ...config, allowedRecipients: ['me@example.com'] }, transport);
    await expect(client.send(EMAIL, { idempotencyKey: 'k' })).rejects.toMatchObject({ errorClass: 'MissingRecipientAddress' });
    await expect(client.send(EMAIL, { idempotencyKey: 'k', to: 'someone@else.com' })).rejects.toMatchObject({ errorClass: 'RecipientNotAllowed' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('classifies login and connection failures without leaking the password', async () => {
    const auth = fakeTransport(jest.fn(async () => Promise.reject(Object.assign(new Error('535 bad creds app-password'), { code: 'EAUTH' }))));
    const failure = createSmtpEmailClient(config, auth.transport).send(EMAIL, { idempotencyKey: 'k', to: 'me@example.com' });
    await expect(failure).rejects.toMatchObject({ errorClass: 'SmtpAuthError' });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('app-password') });

    const down = fakeTransport(jest.fn(async () => Promise.reject(Object.assign(new Error('connect refused'), { code: 'ECONNECTION' }))));
    await expect(createSmtpEmailClient(config, down.transport).send(EMAIL, { idempotencyKey: 'k', to: 'me@example.com' })).rejects.toMatchObject({
      errorClass: 'SmtpUnavailable',
    });
  });
});

describe('local JSON storage', () => {
  it('the tracker appends readable records to its file', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'tracker-')), 'action-items.json');
    const tracker = createJsonActionItemTracker(file);
    const item = { task: 'Send contract', owner: 'Priya', status: 'open' as const, sourceTimestampMs: 10080, missingFields: ['dueDate' as const], flaggedForReview: true };
    await tracker.logActionItems([{ actionItem: item, status: 'Not Started', loggedAt: '2026-10-04T00:00:00.000Z' }]);
    await tracker.logActionItems([{ actionItem: { ...item, task: 'Second' }, status: 'Not Started', loggedAt: '2026-10-04T00:00:00.000Z' }]);
    const records = JSON.parse(readFileSync(file, 'utf8'));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ task: 'Send contract', owner: 'Priya', dueDate: null, status: 'Not Started', needsReview: true });
  });

  it('JsonFileMap survives a reload (a server restart)', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'jfm-')), 'sent.json');
    const first = new JsonFileMap<string>(file);
    first.set('run:Me', '2026-10-04T00:00:00.000Z');
    const reloaded = new JsonFileMap<string>(file);
    expect(reloaded.get('run:Me')).toBe('2026-10-04T00:00:00.000Z');
    reloaded.delete('run:Me');
    expect(new JsonFileMap<string>(file).has('run:Me')).toBe(false);
  });
});

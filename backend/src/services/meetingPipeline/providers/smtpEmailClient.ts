import nodemailer, { Transporter } from 'nodemailer';
import { EmailDeliveryClient } from '../types';
import { recordAuditEvent } from '../auditLog';
import { ProviderCallError } from './providerErrors';

export const REQUIRED_SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;

export interface SmtpEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
  /** Optional safety list: when set, mail may only go to these addresses (comma separated). */
  SMTP_ALLOWED_RECIPIENTS?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  allowedRecipients?: string[];
}

const EMAIL_PATTERN = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** Reads SMTP settings from the environment. Returns the exact problems instead of a half-configured sender. */
export function readSmtpConfig(env: SmtpEnv): { config?: SmtpConfig; problems: string[] } {
  const missing = REQUIRED_SMTP_VARS.filter((name) => !env[name]?.trim());
  const problems = missing.length > 0 ? [`Email: set ${missing.join(', ')} (SMTP settings for sending).`] : [];
  const port = Number(env.SMTP_PORT);
  if (env.SMTP_PORT && (!Number.isInteger(port) || port <= 0 || port > 65535)) problems.push(`Email: SMTP_PORT must be a port number, got "${env.SMTP_PORT}".`);
  if (env.MAIL_FROM && !EMAIL_PATTERN.test(env.MAIL_FROM.trim())) problems.push('Email: MAIL_FROM must be a plain email address, e.g. you@gmail.com.');
  if (problems.length > 0) return { problems };

  const allowed = env.SMTP_ALLOWED_RECIPIENTS?.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  return {
    problems,
    config: {
      host: env.SMTP_HOST!.trim(),
      port,
      user: env.SMTP_USER!.trim(),
      pass: env.SMTP_PASS!,
      from: env.MAIL_FROM!.trim(),
      allowedRecipients: allowed && allowed.length > 0 ? allowed : undefined,
    },
  };
}

/** Nodemailer error codes → stable classes with messages that never include the password or the server's raw reply. */
function classifySmtpError(error: unknown): ProviderCallError {
  const code = (error as { code?: string })?.code;
  const responseCode = (error as { responseCode?: number })?.responseCode;
  if (code === 'EAUTH') return new ProviderCallError('SmtpAuthError', 'The SMTP server rejected the login — check SMTP_USER and SMTP_PASS (Gmail needs an app password).');
  if (code === 'ETIMEDOUT') return new ProviderCallError('UpstreamTimeoutError', 'The SMTP server did not respond in time.');
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') {
    return new ProviderCallError('SmtpUnavailable', 'Could not connect to the SMTP server — check SMTP_HOST and SMTP_PORT.');
  }
  if (code === 'EENVELOPE' || (responseCode !== undefined && responseCode >= 500)) {
    return new ProviderCallError('SmtpRejected', `The SMTP server refused the message${responseCode ? ` (code ${responseCode})` : ''}.`);
  }
  return new ProviderCallError('SmtpError', `Sending failed${code ? ` (${code})` : ''}.`);
}

/**
 * Real email delivery over SMTP. Only ever called by the pipeline after Gate #2 approval, once per
 * (run, participant) — the pipeline's persisted sent-log is the duplicate guard. Explicit
 * connection/greeting/socket timeouts; no automatic retry here (a retried send can duplicate).
 */
export function createSmtpEmailClient(config: SmtpConfig, transporter?: Transporter): EmailDeliveryClient {
  const transport =
    transporter ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465, // implicit TLS on 465; STARTTLS is negotiated on 587
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });

  return {
    async send(email, { idempotencyKey, to }) {
      if (!to) {
        throw new ProviderCallError('MissingRecipientAddress', `No email address for ${email.participantName}.`);
      }
      if (config.allowedRecipients && !config.allowedRecipients.includes(to.toLowerCase())) {
        throw new ProviderCallError('RecipientNotAllowed', `${to} is not in SMTP_ALLOWED_RECIPIENTS, so it was not sent.`);
      }
      const started = Date.now();
      try {
        const info = await transport.sendMail({
          from: config.from,
          to: { name: email.participantName, address: to },
          subject: email.subject,
          text: email.body,
          headers: { 'X-Meeting-Assistant-Key': idempotencyKey },
        });
        recordAuditEvent({
          event: 'smtp_email_sent',
          outcome: 'success',
          resourceId: idempotencyKey,
          durationMs: Date.now() - started,
          context: { messageId: info.messageId, accepted: info.accepted?.length ?? 0 },
        });
      } catch (error) {
        const classified = classifySmtpError(error);
        recordAuditEvent({
          event: 'smtp_email_failed',
          outcome: 'failure',
          resourceId: idempotencyKey,
          errorClass: classified.errorClass,
          durationMs: Date.now() - started,
          context: { message: classified.message },
        });
        throw classified;
      }
    },
  };
}

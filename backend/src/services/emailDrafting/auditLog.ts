import { randomUUID } from 'crypto';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEventInput {
  event: string;
  outcome: AuditOutcome;
  /** The `EmailDraftBatch.id` (== `reviewGateSessionId`) this interaction is for. Not unique
   * across attempts — a blocked gate-check and a successful drafting run on the same session both
   * share it — so `auditEventId` is what makes each entry distinct. */
  resourceId: string;
  /** Stable failure tag (CLAUDE.md Observability Framework). Required context for `outcome: 'failure'`. */
  errorClass?: string;
  context?: Record<string, unknown>;
}

/** Injectable so tests can capture output instead of hitting the real console. */
export type AuditLogWriter = (level: 'info' | 'error', line: string) => void;

const defaultWriter: AuditLogWriter = (level, line) => {
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

/**
 * Single write path for the email-drafting audit trail (STORY-013), mirroring
 * `reviewGate/auditLog.ts` and every other service's audit module in this project. Every call
 * gets its own fresh `auditEventId` (UUID v4), so multiple interactions about the same session
 * stay individually traceable even though they share `resourceId`. Satisfies the story's Trust
 * criterion: every drafting attempt and result — success, gate-blocked, or logic failure — is
 * logged through this one path.
 */
export function recordAuditEvent(input: AuditEventInput, writer: AuditLogWriter = defaultWriter): string {
  const auditEventId = randomUUID();
  const { event, outcome, resourceId, errorClass, context = {} } = input;

  writer(
    outcome === 'failure' ? 'error' : 'info',
    JSON.stringify({
      auditEventId,
      timestamp: new Date().toISOString(),
      level: outcome === 'failure' ? 'error' : 'info',
      service: 'emailDrafting',
      event,
      outcome,
      resourceId,
      ...(errorClass ? { error_class: errorClass } : {}),
      context,
    })
  );

  return auditEventId;
}

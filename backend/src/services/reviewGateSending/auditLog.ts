import { randomUUID } from 'crypto';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEventInput {
  event: string;
  outcome: AuditOutcome;
  /** The `SendingReviewGateSession.id` (== `EmailDraftBatch.id`) this interaction is for. Not
   * unique across attempts — a submit, a revision, and an approval on the same session all share
   * it — so `auditEventId` is what makes each entry distinct. */
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
 * Single write path for the Gate #2 (review-before-sending) audit trail (STORY-014), mirroring
 * `reviewGate/auditLog.ts` and every other service's audit module in this project. Every call gets
 * its own fresh `auditEventId` (UUID v4), so multiple interactions about the same session stay
 * individually traceable even though they share `resourceId`. Satisfies the story's Trust
 * criterion: every submit, revision, approval, and blocked gate-check is logged through this one
 * path. `service: 'reviewGateSending'` keeps these entries distinguishable from Gate #1's in a
 * shared log stream.
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
      service: 'reviewGateSending',
      event,
      outcome,
      resourceId,
      ...(errorClass ? { error_class: errorClass } : {}),
      context,
    })
  );

  return auditEventId;
}

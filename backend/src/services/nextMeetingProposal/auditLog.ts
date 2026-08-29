import { randomUUID } from 'crypto';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEventInput {
  event: string;
  outcome: AuditOutcome;
  /** The `meetingId` this proposal run is for. Not unique across attempts — dedup hits share it —
   * so `auditEventId` is what makes each entry distinct. */
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
 * Single write path for the next-meeting-proposal audit trail (STORY-019), mirroring
 * `actionItemExtraction/auditLog.ts`. Every call gets its own fresh `auditEventId` (UUID v4), so
 * multiple entries about the same meeting stay individually traceable even though they share
 * `resourceId`. Satisfies the story's Trust criterion: the proposed date/time and carried-over
 * items are both logged through this path, whether or not a proposal was actually made.
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
      service: 'nextMeetingProposal',
      event,
      outcome,
      resourceId,
      ...(errorClass ? { error_class: errorClass } : {}),
      context,
    })
  );

  return auditEventId;
}

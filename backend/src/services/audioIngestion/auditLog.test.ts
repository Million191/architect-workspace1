import { recordAuditEvent } from './auditLog';

describe('recordAuditEvent', () => {
  it('returns a unique auditEventId on every call, even for the same resourceId', () => {
    const lines: string[] = [];
    const writer = (_level: 'info' | 'error', line: string) => lines.push(line);

    const firstId = recordAuditEvent(
      { event: 'audio_ingested', outcome: 'success', resourceId: 'zoom:abc123' },
      writer
    );
    const secondId = recordAuditEvent(
      { event: 'audio_ingestion_deduplicated', outcome: 'success', resourceId: 'zoom:abc123' },
      writer
    );

    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firstId).not.toBe(secondId);
  });

  it('writes a structured entry carrying the auditEventId, resourceId, event, outcome, and context', () => {
    const lines: string[] = [];
    const writer = (_level: 'info' | 'error', line: string) => lines.push(line);

    const auditEventId = recordAuditEvent(
      {
        event: 'audio_ingested',
        outcome: 'success',
        resourceId: 'zoom:abc123',
        context: { platform: 'zoom', meetingRef: 'ref-1' },
      },
      writer
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      auditEventId,
      level: 'info',
      service: 'audio-ingestion',
      event: 'audio_ingested',
      outcome: 'success',
      resourceId: 'zoom:abc123',
      context: { platform: 'zoom', meetingRef: 'ref-1' },
    });
    expect(typeof parsed.timestamp).toBe('string');
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it('routes failure outcomes to the "error" level and success to "info"', () => {
    const levels: Array<'info' | 'error'> = [];
    const writer = (level: 'info' | 'error') => levels.push(level);

    recordAuditEvent({ event: 'audio_ingestion_failed', outcome: 'failure', resourceId: 'zoom:abc123' }, writer);
    recordAuditEvent({ event: 'audio_ingested', outcome: 'success', resourceId: 'zoom:abc123' }, writer);

    expect(levels).toEqual(['error', 'info']);
  });

  it('includes error_class at the top level for failures, and omits it for successes', () => {
    const lines: string[] = [];
    const writer = (_level: 'info' | 'error', line: string) => lines.push(line);

    recordAuditEvent(
      { event: 'audio_ingestion_failed', outcome: 'failure', resourceId: 'zoom:ref-1', errorClass: 'CorruptedAudioError' },
      writer
    );
    recordAuditEvent({ event: 'audio_ingested', outcome: 'success', resourceId: 'zoom:abc123' }, writer);

    expect(JSON.parse(lines[0]).error_class).toBe('CorruptedAudioError');
    expect(JSON.parse(lines[1])).not.toHaveProperty('error_class');
  });

  it('defaults context to an empty object when none is provided', () => {
    const lines: string[] = [];
    const writer = (_level: 'info' | 'error', line: string) => lines.push(line);

    recordAuditEvent({ event: 'audio_ingested', outcome: 'success', resourceId: 'zoom:abc123' }, writer);

    expect(JSON.parse(lines[0]).context).toEqual({});
  });
});

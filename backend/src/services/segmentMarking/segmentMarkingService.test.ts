import { markSegments, SegmentMarkingLogger } from './segmentMarkingService';
import { ContractViolationError } from './errors';
import { INAUDIBLE_LABEL, MarkedTranscript, UNCLEAR_LABEL } from './types';
import { Transcript, TranscriptSegment } from '../transcription/types';

function fakeTranscript(id: string, segments: TranscriptSegment[]): Transcript {
  return { id, audioId: 'audio-1', generatedAt: new Date().toISOString(), segments };
}

function fakeLogger(): SegmentMarkingLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('markSegments', () => {
  it('happy path: a clear segment (non-empty text, no confidence reported) is not marked inaudible', () => {
    const transcript = fakeTranscript('t-clear', [{ startMs: 0, endMs: 1000, text: 'Hello everyone.' }]);

    const marked = markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() });

    expect(marked.segments[0].audibility).toBe('clear');
    expect(marked.segments[0].marker).toBeUndefined();
  });

  it('happy path: a clear segment with high confidence is not marked inaudible', () => {
    const transcript = fakeTranscript('t-clear-conf', [{ startMs: 0, endMs: 1000, text: 'Hello everyone.', confidence: 0.95 }]);

    const marked = markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() });

    expect(marked.segments[0].audibility).toBe('clear');
    expect(marked.segments[0].marker).toBeUndefined();
  });

  it('given an inaudible segment (empty text), when the system processes it, it marks it as [inaudible]', () => {
    const transcript = fakeTranscript('t-empty', [{ startMs: 0, endMs: 1000, text: '   ' }]);

    const marked = markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() });

    expect(marked.segments[0].audibility).toBe('inaudible');
    expect(marked.segments[0].marker).toBe(INAUDIBLE_LABEL);
  });

  it('given an inaudible segment (low confidence), when the system processes it, it marks it as [inaudible]', () => {
    const transcript = fakeTranscript('t-lowconf', [{ startMs: 0, endMs: 1000, text: 'mumble mumble', confidence: 0.1 }]);

    const marked = markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() });

    expect(marked.segments[0].audibility).toBe('inaudible');
    expect(marked.segments[0].marker).toBe(INAUDIBLE_LABEL);
  });

  it('a mid-confidence segment is marked [unclear — verify], distinct from [inaudible]', () => {
    const transcript = fakeTranscript('t-midconf', [{ startMs: 0, endMs: 1000, text: 'something garbled', confidence: 0.45 }]);

    const marked = markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() });

    expect(marked.segments[0].audibility).toBe('unclear');
    expect(marked.segments[0].marker).toBe(UNCLEAR_LABEL);
  });

  it('failure path: a segment with an out-of-range confidence throws ContractViolationError rather than guessing a mark', () => {
    const transcript = fakeTranscript('t-badconf', [{ startMs: 0, endMs: 1000, text: 'hello', confidence: 1.5 }]);

    expect(() => markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() })).toThrow(
      ContractViolationError
    );
  });

  it('failure path: a segment with non-string text throws ContractViolationError', () => {
    const transcript = fakeTranscript('t-badtext', [
      { startMs: 0, endMs: 1000, text: undefined as unknown as string },
    ]);

    expect(() => markSegments(transcript, { idempotencyStore: new Map<string, MarkedTranscript>() })).toThrow(
      ContractViolationError
    );
  });

  it('idempotency: marking the same transcript twice returns the same result without re-computing', () => {
    const transcript = fakeTranscript('t-dup', [{ startMs: 0, endMs: 1000, text: 'Hello.' }]);
    const idempotencyStore = new Map<string, MarkedTranscript>();
    const logger = fakeLogger();

    const first = markSegments(transcript, { idempotencyStore, logger });
    const second = markSegments(transcript, { idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'segment_marking_attempted',
      'segment_marking_completed',
      'segment_marking_deduplicated',
    ]);
  });

  it('trust: marking attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      markSegments(fakeTranscript('t-ok', [{ startMs: 0, endMs: 1000, text: 'fine' }]), {
        idempotencyStore: new Map<string, MarkedTranscript>(),
      });

      expect(() =>
        markSegments(fakeTranscript('t-fail', [{ startMs: 0, endMs: 1000, text: 'x', confidence: -1 }]), {
          idempotencyStore: new Map<string, MarkedTranscript>(),
        })
      ).toThrow(ContractViolationError);

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'segment_marking_attempted' && e.service === 'segmentMarking')).toBe(
        true
      );
      expect(successEntries.some((e) => e.event === 'segment_marking_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'segment_marking_failed');
      expect(failureEntry).toBeDefined();
      expect(failureEntry.outcome).toBe('failure');
      expect(failureEntry.error_class).toBe('ContractViolationError');

      const allIds = [...successEntries, ...failureEntries].map((e) => e.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

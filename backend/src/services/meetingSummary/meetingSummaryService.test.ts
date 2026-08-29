/**
 * Note on the "summary generation timeout" failure path: `SummaryGenerationTimeoutError` is
 * real, reachable code (see `meetingSummaryService.ts`'s catch block), but assembly today is
 * purely synchronous with no `await` — its wrapping promise always settles in a microtask
 * before `withTimeoutAndRetry`'s timer (a macrotask) can fire, so it isn't independently
 * triggerable through the public API yet. Documented here rather than faked with a test that
 * doesn't actually exercise the path — the same call STORY-007 made for its untuned confidence
 * thresholds.
 */
import { generateMeetingSummary, MeetingSummaryLogger } from './meetingSummaryService';
import { ContractViolationError } from './errors';
import { GenerateSummaryInput, MeetingSummary } from './types';
import { Attendee } from '../diarization/types';
import { buildOutputTag } from '../audioIngestion/outputTagging';
import { IngestedAudio } from '../audioIngestion/types';
import { Transcript } from '../transcription/types';

function fakeTranscript(id: string): Transcript {
  return {
    id,
    audioId: `${id}-audio`,
    generatedAt: new Date().toISOString(),
    segments: [{ startMs: 0, endMs: 1000, text: 'Hello everyone.' }],
  };
}

function fakeIngestedAudio(
  audioId: string,
  source: Parameters<typeof buildOutputTag>[0],
  location?: string,
  ingestedAt = '2026-08-28T14:05:00.000Z'
): IngestedAudio {
  return {
    id: audioId,
    source,
    sourceRecordingId: `${audioId}-recording`,
    format: 'mp3',
    sizeBytes: 1000,
    ingestedAt,
    status: 'available_for_transcription',
    outputTag: buildOutputTag(source, location),
  };
}

function fakeLogger(): MeetingSummaryLogger & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, info: (event, context) => calls.push([event, context]) };
}

describe('generateMeetingSummary', () => {
  it('happy path: given a full meeting context, the summary includes title, date, time, format, platform/location, attendees, and objective', async () => {
    const transcript = fakeTranscript('t-full');
    const ingestedAudio = fakeIngestedAudio('t-full-audio', 'zoom');
    const attendees: Attendee[] = [{ name: 'Alice' }, { name: 'Bob' }];

    const summary = await generateMeetingSummary(
      {
        transcript,
        ingestedAudio,
        attendees,
        meetingContext: { title: 'Sprint Planning', objective: 'Plan the r2 release', scheduledAt: '2026-08-28T14:05:00.000Z' },
      },
      { idempotencyStore: new Map<string, MeetingSummary>() }
    );

    expect(summary.title).toBe('Sprint Planning');
    expect(summary.date).toBe('2026-08-28');
    expect(summary.time).toBe('14:05');
    expect(summary.format).toBe('Virtual');
    expect(summary.platformOrLocation).toBe('Zoom');
    expect(summary.attendees).toEqual(['Alice', 'Bob']);
    expect(summary.objective).toBe('Plan the r2 release');
    expect(summary.missingFields).toEqual([]);
  });

  it('given missing information (no context, no attendees, unknown physical location), the summary flags the missing fields for manual input', async () => {
    const transcript = fakeTranscript('t-missing');
    const ingestedAudio = fakeIngestedAudio('t-missing-audio', 'room_mic');

    const summary = await generateMeetingSummary(
      { transcript, ingestedAudio, attendees: [] },
      { idempotencyStore: new Map<string, MeetingSummary>() }
    );

    expect(summary.missingFields).toEqual(
      expect.arrayContaining(['title', 'platformOrLocation', 'attendees', 'objective'])
    );
    expect(summary.title).toBeUndefined();
    expect(summary.platformOrLocation).toBeUndefined();
    expect(summary.attendees).toEqual([]);
    expect(summary.objective).toBeUndefined();
    // date/time still resolve from IngestedAudio.ingestedAt, so they aren't flagged here.
    expect(summary.missingFields).not.toContain('date');
    expect(summary.missingFields).not.toContain('time');
  });

  it('given an unparseable meeting timestamp, date and time are flagged missing rather than a bad value being shipped', async () => {
    const transcript = fakeTranscript('t-badtime');
    const ingestedAudio = fakeIngestedAudio('t-badtime-audio', 'zoom', undefined, 'not-a-real-timestamp');

    const summary = await generateMeetingSummary(
      { transcript, ingestedAudio, attendees: [{ name: 'Alice' }] },
      { idempotencyStore: new Map<string, MeetingSummary>() }
    );

    expect(summary.date).toBeUndefined();
    expect(summary.time).toBeUndefined();
    expect(summary.missingFields).toEqual(expect.arrayContaining(['date', 'time']));
  });

  it('failure path: malformed input (attendees not an array) throws ContractViolationError rather than guessing a summary', async () => {
    const transcript = fakeTranscript('t-badinput');
    const ingestedAudio = fakeIngestedAudio('t-badinput-audio', 'teams');
    const input = {
      transcript,
      ingestedAudio,
      attendees: 'not-an-array' as unknown as Attendee[],
    } as GenerateSummaryInput;

    await expect(generateMeetingSummary(input, { idempotencyStore: new Map<string, MeetingSummary>() })).rejects.toThrow(
      ContractViolationError
    );
  });

  it('idempotency: summarizing the same transcript twice returns the same result without re-computing', async () => {
    const transcript = fakeTranscript('t-dup');
    const ingestedAudio = fakeIngestedAudio('t-dup-audio', 'meet');
    const idempotencyStore = new Map<string, MeetingSummary>();
    const logger = fakeLogger();

    const first = await generateMeetingSummary({ transcript, ingestedAudio, attendees: [] }, { idempotencyStore, logger });
    const second = await generateMeetingSummary({ transcript, ingestedAudio, attendees: [] }, { idempotencyStore, logger });

    expect(second).toEqual(first);
    expect(logger.calls.map(([event]) => event)).toEqual([
      'summary_generation_attempted',
      'summary_generation_completed',
      'summary_generation_deduplicated',
    ]);
  });

  it('trust: summary generation attempts and results (success and failure) are written to the audit trail with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await generateMeetingSummary(
        { transcript: fakeTranscript('t-ok'), ingestedAudio: fakeIngestedAudio('t-ok-audio', 'zoom'), attendees: [] },
        { idempotencyStore: new Map<string, MeetingSummary>() }
      );

      const badInput = {
        transcript: fakeTranscript('t-fail'),
        ingestedAudio: fakeIngestedAudio('t-fail-audio', 'zoom'),
        attendees: 'not-an-array' as unknown as Attendee[],
      } as GenerateSummaryInput;

      await expect(generateMeetingSummary(badInput, { idempotencyStore: new Map<string, MeetingSummary>() })).rejects.toThrow(
        ContractViolationError
      );

      const successEntries = logSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls
        .map(([line]) => JSON.parse(line as string))
        .filter((entry) => typeof entry.auditEventId === 'string');

      expect(successEntries.some((e) => e.event === 'summary_generation_attempted' && e.service === 'meetingSummary')).toBe(
        true
      );
      expect(successEntries.some((e) => e.event === 'summary_generation_completed')).toBe(true);

      const failureEntry = failureEntries.find((e) => e.event === 'summary_generation_failed');
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

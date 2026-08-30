import { exportMeetingData } from './dataExportService';
import { ContractViolationError, DataOutputFailedError, InvalidJsonFormatError } from './errors';
import { DataOutputClient, ExportResult, JsonExportPayload, MeetingDataExportInput } from './types';

function meetingData(meetingId: string, overrides: Partial<MeetingDataExportInput> = {}): MeetingDataExportInput {
  return {
    meetingId,
    decisions: [{ decision: 'Ship the beta', rationale: 'Deadline is fixed', approver: 'Ali', timestampMs: 4200, missingFields: [], flaggedForReview: false }],
    ...overrides,
  };
}

describe('exportMeetingData', () => {
  it('happy path: formats meeting data as JSON and sends it to the output client', async () => {
    const received: JsonExportPayload[] = [];
    const dataOutputClient: DataOutputClient = {
      outputData: async (payload) => {
        received.push(payload);
      },
    };

    const result = await exportMeetingData({ meetingData: meetingData('m-happy') }, { dataOutputClient, idempotencyStore: new Map() });

    expect(result.meetingId).toBe('m-happy');
    expect(received).toHaveLength(1);
    expect(received[0].meetingId).toBe('m-happy');
    expect(() => JSON.parse(received[0].json)).not.toThrow();
    expect(JSON.parse(received[0].json).data).toEqual(meetingData('m-happy'));
  });

  it('input boundary: meeting data missing meetingId throws ContractViolationError without calling the client', async () => {
    const dataOutputClient: DataOutputClient = { outputData: jest.fn().mockResolvedValue(undefined) };
    const badInput = { meetingData: { decisions: [] } } as unknown as { meetingData: MeetingDataExportInput };

    await expect(exportMeetingData(badInput, { dataOutputClient, idempotencyStore: new Map() })).rejects.toThrow(ContractViolationError);
    expect(dataOutputClient.outputData).not.toHaveBeenCalled();
  });

  it('incorrect JSON formatting: a circular reference throws InvalidJsonFormatError without calling the client, and is never retried', async () => {
    const dataOutputClient: DataOutputClient = { outputData: jest.fn().mockResolvedValue(undefined) };
    const circular: Record<string, unknown> = { meetingId: 'm-circular' };
    circular.self = circular;

    await expect(
      exportMeetingData({ meetingData: circular as unknown as MeetingDataExportInput }, { dataOutputClient, idempotencyStore: new Map() })
    ).rejects.toThrow(InvalidJsonFormatError);
    expect(dataOutputClient.outputData).not.toHaveBeenCalled();
  });

  it('idempotency: re-exporting the same meetingId is a no-op returning the existing result, without calling the client again', async () => {
    const idempotencyStore = new Map<string, ExportResult>();
    let callCount = 0;
    const dataOutputClient: DataOutputClient = {
      outputData: async () => {
        callCount += 1;
      },
    };

    const first = await exportMeetingData({ meetingData: meetingData('m-dup') }, { dataOutputClient, idempotencyStore });
    const second = await exportMeetingData({ meetingData: meetingData('m-dup') }, { dataOutputClient, idempotencyStore });

    expect(second).toEqual(first);
    expect(callCount).toBe(1);
  });

  it('data output service failure: retries a failing output client and succeeds once it stops failing', async () => {
    let attempts = 0;
    const dataOutputClient: DataOutputClient = {
      outputData: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('tracker temporarily unavailable');
        }
      },
    };

    const result = await exportMeetingData(
      { meetingData: meetingData('m-retry') },
      { dataOutputClient, idempotencyStore: new Map(), maxAttempts: 3, backoffMs: () => 0, timeoutMs: 1000 }
    );

    expect(attempts).toBe(2);
    expect(result.meetingId).toBe('m-retry');
  });

  it('data output retry failure: exhausts retries, throws DataOutputFailedError, and notifies the user', async () => {
    let attempts = 0;
    const dataOutputClient: DataOutputClient = {
      outputData: async () => {
        attempts += 1;
        throw new Error('tracker down');
      },
    };
    const notified: Array<{ meetingId: string; error: DataOutputFailedError }> = [];

    await expect(
      exportMeetingData(
        { meetingData: meetingData('m-fail') },
        {
          dataOutputClient,
          idempotencyStore: new Map(),
          maxAttempts: 3,
          backoffMs: () => 0,
          timeoutMs: 1000,
          notifyUserOfFailure: (context) => notified.push(context),
        }
      )
    ).rejects.toThrow(DataOutputFailedError);

    expect(attempts).toBe(3);
    expect(notified).toHaveLength(1);
    expect(notified[0].meetingId).toBe('m-fail');
    expect(notified[0].error).toBeInstanceOf(DataOutputFailedError);
  });
});

describe('trust: audit trail', () => {
  it('records an attempted+completed success and a failed+notified run, all with distinct auditEventIds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const okClient: DataOutputClient = { outputData: async () => {} };
      await exportMeetingData({ meetingData: meetingData('m-audit-ok') }, { dataOutputClient: okClient, idempotencyStore: new Map() });

      const failingClient: DataOutputClient = {
        outputData: async () => {
          throw new Error('nope');
        },
      };
      await expect(
        exportMeetingData(
          { meetingData: meetingData('m-audit-fail') },
          { dataOutputClient: failingClient, idempotencyStore: new Map(), maxAttempts: 1, backoffMs: () => 0 }
        )
      ).rejects.toThrow(DataOutputFailedError);

      const successEntries = logSpy.mock.calls.map(([line]) => JSON.parse(line as string)).filter((entry) => typeof entry.auditEventId === 'string');
      const failureEntries = errorSpy.mock.calls.map(([line]) => JSON.parse(line as string)).filter((entry) => typeof entry.auditEventId === 'string');

      const attemptedEntry = successEntries.find((entry) => entry.event === 'data_export_attempted' && entry.resourceId === 'm-audit-ok');
      expect(attemptedEntry).toBeDefined();
      expect(attemptedEntry.service).toBe('dataExport');

      const completedEntry = successEntries.find((entry) => entry.event === 'data_export_completed' && entry.resourceId === 'm-audit-ok');
      expect(completedEntry).toBeDefined();

      const failedEntry = failureEntries.find((entry) => entry.event === 'data_export_failed' && entry.resourceId === 'm-audit-fail');
      expect(failedEntry).toBeDefined();
      expect(failedEntry.outcome).toBe('failure');
      expect(failedEntry.error_class).toBe('DataOutputFailedError');

      const notifiedEntry = successEntries.find((entry) => entry.event === 'user_notified_of_export_failure' && entry.resourceId === 'm-audit-fail');
      expect(notifiedEntry).toBeDefined();

      const allIds = [...successEntries, ...failureEntries].map((entry) => entry.auditEventId);
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

import { formatMeetingDataAsJson } from './jsonFormatter';
import { InvalidJsonFormatError } from './errors';
import { MeetingDataExportInput } from './types';

const EXPORTED_AT = '2026-08-30T00:00:00.000Z';

describe('formatMeetingDataAsJson', () => {
  it('happy path: produces a JSON payload suitable for integration, wrapped with meetingId/exportedAt/data', () => {
    const meetingData: MeetingDataExportInput = {
      meetingId: 'meeting-1',
      decisions: [
        { decision: 'Ship the beta', rationale: 'Deadline is fixed', approver: 'Ali', timestampMs: 4200, missingFields: [], flaggedForReview: false },
      ],
    };

    const payload = formatMeetingDataAsJson(meetingData, EXPORTED_AT);

    expect(payload.meetingId).toBe('meeting-1');
    expect(payload.exportedAt).toBe(EXPORTED_AT);
    expect(() => JSON.parse(payload.json)).not.toThrow();
    expect(JSON.parse(payload.json)).toEqual({
      meetingId: 'meeting-1',
      exportedAt: EXPORTED_AT,
      data: meetingData,
    });
  });

  it('incorrect JSON formatting: a circular reference is rejected before anything is serialized', () => {
    const circular: Record<string, unknown> = { meetingId: 'meeting-2' };
    circular.self = circular;

    expect(() => formatMeetingDataAsJson(circular as unknown as MeetingDataExportInput, EXPORTED_AT)).toThrow(InvalidJsonFormatError);
  });

  it('incorrect JSON formatting: NaN is rejected rather than silently becoming null', () => {
    const meetingData = {
      meetingId: 'meeting-3',
      actionItems: [
        {
          actionItem: { task: 'x', owner: 'y', dueDate: '2026-09-01', priority: 'low', status: 'open', sourceTimestampMs: NaN, missingFields: [], flaggedForReview: false },
          status: 'Not Started',
          loggedAt: EXPORTED_AT,
        },
      ],
    } as unknown as MeetingDataExportInput;

    expect(() => formatMeetingDataAsJson(meetingData, EXPORTED_AT)).toThrow(InvalidJsonFormatError);
  });

  it('incorrect JSON formatting: Infinity is rejected rather than silently becoming null', () => {
    const meetingData = { meetingId: 'meeting-4', decisions: [{ decision: 'x', timestampMs: Infinity, missingFields: [], flaggedForReview: false }] } as unknown as MeetingDataExportInput;

    expect(() => formatMeetingDataAsJson(meetingData, EXPORTED_AT)).toThrow(InvalidJsonFormatError);
  });

  it('a shared (non-circular) reference between two array entries is not mistaken for a cycle', () => {
    const sharedDecision = { decision: 'Shared decision', missingFields: [], flaggedForReview: false };
    const meetingData: MeetingDataExportInput = {
      meetingId: 'meeting-5',
      decisions: [sharedDecision, sharedDecision] as MeetingDataExportInput['decisions'],
    };

    expect(() => formatMeetingDataAsJson(meetingData, EXPORTED_AT)).not.toThrow();
  });
});

import { MeetingSummary } from '../meetingSummary/types';
import { Decision } from '../decisionExtraction/types';
import { TrackedActionItem } from '../actionItemTracker/types';

/**
 * Whatever structured meeting data the caller already has, for REQ-018's "output structured data
 * in JSON format for integration with external trackers." No "Meeting Records Store" aggregate
 * exists yet in this project (the architecture doc's dual text/JSON output at every stage is a
 * cross-cutting concern with no data layer built for it) — same governance boundary
 * STORY-015/016 drew for the tracker's own persistence. Rather than invent that aggregate here,
 * every field is optional and the caller supplies whatever pieces of the pipeline's own already-
 * structured output (`meetingSummary`, `decisionExtraction`, `actionItemTracker`) it wants
 * exported; nothing is fabricated or re-derived. `meetingId` is the one required field — it is
 * this export's idempotency key.
 */
export interface MeetingDataExportInput {
  meetingId: string;
  meetingSummary?: MeetingSummary;
  decisions?: Decision[];
  actionItems?: TrackedActionItem[];
}

export interface ExportMeetingDataInput {
  meetingData: MeetingDataExportInput;
}

/**
 * The validated, ready-to-send output: `json` is the actual serialized text (a real
 * `JSON.stringify` round-trip already proven safe — see `jsonFormatter.ts`), not just the
 * in-memory object, since "output ... in JSON format" means the on-the-wire representation an
 * external tracker consumes.
 */
export interface JsonExportPayload {
  meetingId: string;
  exportedAt: string;
  json: string;
}

/**
 * What any external-tracker output integration must implement (Jira, Asana, a webhook, a file
 * drop — undecided). No implementation exists yet — wiring one is a deliberate external-
 * dependency decision outside this story's scope, the same boundary STORY-005/006/009/010/011/015
 * already drew for their own provider seams. Tests supply a fake; production wiring is a future
 * story.
 */
export interface DataOutputClient {
  outputData(payload: JsonExportPayload): Promise<void>;
}

export interface ExportResult {
  /** Idempotency key — equals `MeetingDataExportInput.meetingId`. Re-exporting the same meeting
   * is a no-op against the existing result, not a fresh output call, mirroring every other
   * service's id-equals-source-key convention. */
  id: string;
  meetingId: string;
  payload: JsonExportPayload;
  exportedAt: string;
}

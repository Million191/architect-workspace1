import { RawTranscriptSegment } from '../transcription/types';
import { RawSpeakerSegment } from '../diarization/types';
import { DraftedEmail } from '../emailDrafting/types';
import { TrackedActionItem } from '../actionItemTracker/types';
import { recordAuditEvent } from './auditLog';
import { MeetingPipelineProviders } from './types';

/**
 * DEMO ONLY — stand-ins for the outside providers that have not been chosen yet (speech-to-text,
 * speaker diarization, LLM extraction, mail delivery, action-item tracker). Picking real ones is
 * a paid-external-dependency decision (CLAUDE.md "Strategic decisions"), so this file exists only
 * so the pipeline and review page can be exercised end to end today.
 *
 * Every run returns the SAME sample meeting regardless of the uploaded audio, the page shows a
 * "demo mode" banner whenever these are in use, and nothing is ever actually emailed — the
 * "delivery" client only writes to an in-memory outbox and an audit line.
 */
const SAMPLE_SEGMENTS: Array<RawTranscriptSegment & { speaker: string }> = [
  { startMs: 0, endMs: 8000, speaker: 'SPEAKER_00', text: "Let's review the launch timeline for the new onboarding flow." },
  { startMs: 8000, endMs: 17000, speaker: 'SPEAKER_01', text: 'Design is done; engineering needs two more weeks for the integration work.' },
  { startMs: 17000, endMs: 26000, speaker: 'SPEAKER_00', text: "Then let's move the launch to the end of the month so QA has a full week." },
  { startMs: 26000, endMs: 35000, speaker: 'SPEAKER_01', text: "Agreed. I'll update the project plan and tell the stakeholders by Friday." },
  { startMs: 35000, endMs: 44000, speaker: 'SPEAKER_01', text: 'Next, the support team asked for a short training session before launch.' },
  { startMs: 44000, endMs: 52000, speaker: 'SPEAKER_00', text: "I'll schedule the training session for support next week." },
];

/** "Alice: text" -> "Alice" (the pipeline prefixes speaker names before extraction). */
function speakerOf(text: string): string | undefined {
  const match = /^([^:]+):\s/.exec(text);
  return match ? match[1] : undefined;
}

export interface DemoProviders extends MeetingPipelineProviders {
  /** What the demo "delivery" client would have sent — inspectable by tests. Never actually sent. */
  outbox: DraftedEmail[];
  trackerLog: TrackedActionItem[];
}

export function createDemoProviders(): DemoProviders {
  const outbox: DraftedEmail[] = [];
  const trackerLog: TrackedActionItem[] = [];

  return {
    mode: 'demo',
    outbox,
    trackerLog,
    transcriptionClient: {
      async transcribe() {
        return SAMPLE_SEGMENTS.map(({ startMs, endMs, text }) => ({ startMs, endMs, text, confidence: 0.95 }));
      },
    },
    diarizationClient: {
      async diarize(): Promise<RawSpeakerSegment[]> {
        return SAMPLE_SEGMENTS.map(({ startMs, endMs, speaker }) => ({ startMs, endMs, speakerTag: speaker }));
      },
    },
    nameMappingClient: {
      // Maps speakers to attendees in list order — a real provider would use voice or context.
      async mapSpeakersToNames(speakerTags, attendees) {
        const map: Record<string, string> = {};
        [...new Set(speakerTags)].sort().forEach((tag, index) => {
          if (attendees[index]) map[tag] = attendees[index].name;
        });
        return map;
      },
    },
    topicSummarizationClient: {
      async summarizeTopics({ segments }) {
        const end = segments[segments.length - 1].endMs;
        return [
          { topic: 'Launch timeline', startMs: segments[0].startMs, endMs: 35000, summary: 'Engineering needs two more weeks; launch moves to month end.' },
          { topic: 'Support training', startMs: 35000, endMs: end, summary: 'Support asked for training before launch.' },
        ];
      },
    },
    decisionExtractionClient: {
      async extractDecisions({ segments }) {
        const segment = segments.find((s) => s.text.includes('move the launch'));
        if (!segment) return [];
        return [
          {
            decision: 'Move the launch to the end of the month',
            rationale: 'Gives QA a full week after the integration work',
            approver: speakerOf(segment.text),
            timestampMs: segment.startMs,
          },
        ];
      },
    },
    actionItemExtractionClient: {
      // No due dates are invented: "by Friday" / "next week" are not dates, so they stay unset and get flagged.
      async extractActionItems({ segments }) {
        return segments
          .filter((s) => s.text.includes("I'll "))
          .map((s) => ({
            task: s.text.slice(s.text.indexOf("I'll ") + 5).replace(/\.$/, ''),
            owner: speakerOf(s.text),
            priority: 'medium' as const,
            status: 'open' as const,
            sourceTimestampMs: s.startMs,
          }));
      },
    },
    emailDeliveryClient: {
      async send(email, { idempotencyKey }) {
        outbox.push(email);
        recordAuditEvent({
          event: 'demo_email_not_actually_sent',
          outcome: 'success',
          resourceId: idempotencyKey,
          context: { participantName: email.participantName, subject: email.subject },
        });
      },
    },
    actionItemTrackerClient: {
      async logActionItems(items) {
        trackerLog.push(...items);
      },
    },
  };
}

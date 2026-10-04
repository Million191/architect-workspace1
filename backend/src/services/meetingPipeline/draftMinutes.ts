import { ingestPhysicalRecording } from '../audioIngestion/physicalAudioIngestionService';
import { transcribeAudio } from '../transcription/transcriptionService';
import { diarizeAndMapSpeakers } from '../diarization/diarizationService';
import { SpeakerMapping } from '../diarization/types';
import { generateMeetingSummary } from '../meetingSummary/meetingSummaryService';
import { markSegments } from '../segmentMarking/segmentMarkingService';
import { MarkedTranscript } from '../segmentMarking/types';
import { summarizeDiscussionPoints } from '../discussionSummary/discussionSummaryService';
import { listDecisions } from '../decisionExtraction/decisionExtractionService';
import { extractActionItems } from '../actionItemExtraction/actionItemExtractionService';
import { submitForReview } from '../reviewGate/reviewGateService';
import { ProviderNotConfiguredError } from './errors';
import { runStage } from './runStage';
import { DraftMinutesInput, MeetingPipelineProviders, MeetingPipelineStores } from './types';

/** Upload problems the route reports as 422 rather than as a failed pipeline stage. */
const INGESTION_CLIENT_ERRORS = ['UnsupportedFormatError', 'CorruptedAudioError'];

/**
 * Prefixes each segment's text with its resolved speaker ("Alice: ...") so the summary, decision,
 * and action-item extractors can see who said what — they only accept segment text, not the
 * diarization result. Empty (inaudible) segments are left empty so their marking is unchanged.
 */
export function withSpeakerLabels(marked: MarkedTranscript, speakers: SpeakerMapping): MarkedTranscript {
  return {
    ...marked,
    segments: marked.segments.map((segment, index) => {
      const label = speakers.segments[index]?.speakerLabel;
      const hasText = segment.text.trim().length > 0;
      return hasText && label ? { ...segment, text: `${label}: ${segment.text}` } : segment;
    }),
  };
}

/**
 * Steps 1-6 of the meeting workflow, in order: ingest the audio, transcribe it, identify speakers,
 * summarize, extract decisions, extract action items — then STOP by opening Gate #1 with the draft.
 * Nothing past the draft happens here; emails can only be drafted after `approveMinutes`.
 *
 * Idempotent: every wrapped stage dedupes on the audio/transcript id, so re-uploading the same
 * file re-uses earlier results. If those minutes were already approved, the existing run id is
 * returned rather than re-opening a decided gate. Returns the run id (== transcriptId).
 */
export async function draftMinutesFromAudio(
  input: DraftMinutesInput,
  providers: MeetingPipelineProviders,
  stores: MeetingPipelineStores
): Promise<string> {
  const ref = input.originalFilename;
  // Reports each stage as it starts (for the page's live progress), then runs it exactly as before.
  const stage = <T>(runRef: string, name: string, operation: () => T | Promise<T>, passThrough?: string[]): Promise<T> => {
    input.onProgress?.(name);
    return runStage(runRef, name, operation, passThrough);
  };
  const attendees = input.attendeeNames.map((name) => ({ name }));
  const { transcription = {}, diarization = {}, analysis = {} } = providers.stageOptions ?? {};
  if (providers.readiness && providers.readiness.draft.length > 0) {
    throw new ProviderNotConfiguredError(providers.readiness.draft);
  }

  const audio = await stage(
    ref,
    'audio ingestion',
    () => ingestPhysicalRecording(input.source, input.originalFilename, input.buffer, { idempotencyStore: stores.audio, location: input.location }),
    INGESTION_CLIENT_ERRORS
  );
  // An approved meeting is a saved record: re-uploading it just reopens that record (no Whisper or Claude call).
  // Transcript ids equal audio ids, so the run id is known as soon as the audio is ingested.
  if (stores.finalApprovals.get(audio.id)?.minutes) {
    return audio.id;
  }
  const transcript = await stage(audio.id, 'transcription', () =>
    transcribeAudio(audio.id, audio.format, input.buffer, { client: providers.transcriptionClient, idempotencyStore: stores.transcripts, ...transcription })
  );
  const runId = transcript.id;
  if (stores.minutesGate.has(runId)) {
    return runId; // same recording already drafted — never re-open or duplicate its review
  }

  const speakers = await stage(runId, 'speaker identification', () =>
    diarizeAndMapSpeakers(transcript, input.buffer, attendees, {
      diarizationClient: providers.diarizationClient,
      nameMappingClient: providers.nameMappingClient,
      idempotencyStore: stores.speakers,
      ...diarization,
    })
  );
  const meetingSummary = await stage(runId, 'meeting summary', () =>
    generateMeetingSummary({ transcript, ingestedAudio: audio, attendees, meetingContext: input.meetingContext }, { idempotencyStore: stores.summaries })
  );
  const marked = await stage(runId, 'unclear-audio marking', () => markSegments(transcript, { idempotencyStore: stores.marked }));
  const markedTranscript = withSpeakerLabels(marked, speakers);

  const discussion = await stage(runId, 'discussion summary', () =>
    summarizeDiscussionPoints(
      { markedTranscript },
      { topicSummarizationClient: providers.topicSummarizationClient, idempotencyStore: stores.discussions, ...analysis }
    )
  );
  const decisions = await stage(runId, 'decision extraction', () =>
    listDecisions({ markedTranscript }, { decisionExtractionClient: providers.decisionExtractionClient, idempotencyStore: stores.decisions, ...analysis })
  );
  const actionItems = await stage(runId, 'action item extraction', () =>
    extractActionItems(
      { markedTranscript },
      { actionItemExtractionClient: providers.actionItemExtractionClient, idempotencyStore: stores.actionItems, ...analysis }
    )
  );

  await stage(runId, 'minutes review gate', () =>
    submitForReview(
      {
        draft: {
          transcriptId: runId,
          meetingSummary,
          discussionTopics: discussion.topics,
          decisions: decisions.decisions,
          actionItems: actionItems.actionItems,
        },
      },
      { sessionStore: stores.minutesGate }
    )
  );
  return runId;
}

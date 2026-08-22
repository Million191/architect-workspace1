import { CorruptedAudioError, UnsupportedFormatError } from './errors';
import { buildOutputTag } from './outputTagging';
import {
  IngestedAudio,
  PlatformClient,
  PlatformRecordingFile,
  SUPPORTED_AUDIO_FORMATS,
  SupportedAudioFormat,
  VirtualMeetingPlatform,
} from './types';

export interface AudioIngestionLogger {
  info(event: string, context: Record<string, unknown>): void;
}

const defaultLogger: AudioIngestionLogger = {
  info(event, context) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'audio-ingestion',
        event,
        outcome: 'success',
        context,
      })
    );
  },
};

/**
 * Ingested-audio records keyed by their deterministic idempotency id (`${platform}:${fileId}`,
 * so different platforms can never collide). Production runs share `defaultIdempotencyStore`;
 * tests inject their own Map to stay isolated.
 * TODO(pre-persistence): move to a DB-backed unique constraint on (source, sourceRecordingId)
 * per CLAUDE.md's Idempotency & Replayability rules once a data layer exists for this
 * project — this only dedupes within a single running process, not across restarts.
 */
const defaultIdempotencyStore = new Map<string, IngestedAudio>();

/**
 * In-flight requests keyed by (platform, meetingRef). Coalesces concurrent duplicate
 * requests (e.g. a double-click) into a single upstream call instead of hitting the
 * platform's API — and its rate limits — twice for the same meeting.
 */
const defaultInFlightRequests = new Map<string, Promise<IngestedAudio>>();

function toSupportedFormat(fileExtension: string): SupportedAudioFormat | null {
  const normalized = fileExtension.trim().toLowerCase();
  return (SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(normalized)
    ? (normalized as SupportedAudioFormat)
    : null;
}

function pickAudioFile(files: PlatformRecordingFile[]): PlatformRecordingFile | undefined {
  return files.find((file) => toSupportedFormat(file.fileExtension) !== null);
}

export interface IngestOptions {
  client: PlatformClient;
  logger?: AudioIngestionLogger;
  idempotencyStore?: Map<string, IngestedAudio>;
  inFlightRequests?: Map<string, Promise<IngestedAudio>>;
}

/**
 * Fetches a recording from any virtual-meeting platform client, validates it, and returns
 * it as available-for-transcription — deduping on (platform, recording file id) so ingesting
 * the same recording twice never creates a second record, and coalescing concurrent calls
 * for the same (platform, meetingRef) so they share one upstream fetch.
 */
export async function ingestVirtualMeetingRecording(
  platform: VirtualMeetingPlatform,
  meetingRef: string,
  options: IngestOptions
): Promise<IngestedAudio> {
  const inFlightRequests = options.inFlightRequests ?? defaultInFlightRequests;
  const inFlightKey = `${platform}:${meetingRef}`;

  const alreadyInFlight = inFlightRequests.get(inFlightKey);
  if (alreadyInFlight) {
    (options.logger ?? defaultLogger).info('audio_ingestion_coalesced', { platform, meetingRef });
    return alreadyInFlight;
  }

  const resultPromise = performIngest(platform, meetingRef, options);
  inFlightRequests.set(inFlightKey, resultPromise);
  try {
    return await resultPromise;
  } finally {
    inFlightRequests.delete(inFlightKey);
  }
}

async function performIngest(
  platform: VirtualMeetingPlatform,
  meetingRef: string,
  { client, logger = defaultLogger, idempotencyStore = defaultIdempotencyStore }: IngestOptions
): Promise<IngestedAudio> {
  const recording = await client.fetchRecording(meetingRef);

  const audioFile = pickAudioFile(recording.files);
  if (!audioFile) {
    throw new UnsupportedFormatError(
      `No supported audio format found among ${recording.files.length} recording file(s) for ${platform} meeting ${meetingRef}`,
      { platform, meetingRef, availableExtensions: recording.files.map((f) => f.fileExtension) }
    );
  }

  if (!audioFile.downloadUrl || !audioFile.fileSizeBytes || audioFile.fileSizeBytes <= 0) {
    throw new CorruptedAudioError(
      `Recording file ${audioFile.id} for ${platform} meeting ${meetingRef} is missing a download URL or has zero size`,
      { platform, meetingRef, recordingFileId: audioFile.id, fileSizeBytes: audioFile.fileSizeBytes }
    );
  }

  const id = `${platform}:${audioFile.id}`;
  const existing = idempotencyStore.get(id);
  if (existing) {
    logger.info('audio_ingestion_deduplicated', { platform, meetingRef, sourceRecordingId: audioFile.id, id });
    return existing;
  }

  const outputTag = buildOutputTag(platform);

  const ingested: IngestedAudio = {
    id,
    source: platform,
    sourceRecordingId: audioFile.id,
    format: toSupportedFormat(audioFile.fileExtension) as SupportedAudioFormat,
    sizeBytes: audioFile.fileSizeBytes,
    downloadUrl: audioFile.downloadUrl,
    ingestedAt: new Date().toISOString(),
    status: 'available_for_transcription',
    outputTag,
  };

  idempotencyStore.set(id, ingested);
  logger.info('audio_ingested', {
    platform,
    meetingRef,
    sourceRecordingId: audioFile.id,
    id,
    format: ingested.format,
  });
  logger.info('output_tagged', {
    platform,
    meetingRef,
    id,
    meetingType: outputTag.meetingType,
    header: outputTag.header,
    locationUnknown: outputTag.locationUnknown,
  });

  return ingested;
}

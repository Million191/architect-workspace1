import { createHash } from 'crypto';
import { CorruptedAudioError, UnsupportedFormatError } from './errors';
import { extractClaimedFormat, sniffAudioFormat } from './audioFormatSniffer';
import { assessAudioQuality } from './audioQualityAssessment';
import { IngestedAudio, PhysicalAudioSource } from './types';
import { AudioIngestionLogger } from './audioIngestionService';

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
 * Ingested-audio records keyed by a content hash, so re-uploading identical bytes is a
 * no-op instead of creating a duplicate record. Production runs share this Map; tests
 * inject their own to stay isolated.
 * TODO(pre-persistence): move to a DB-backed unique constraint per CLAUDE.md's Idempotency
 * & Replayability rules once a data layer exists — this only dedupes within one process.
 */
const defaultIdempotencyStore = new Map<string, IngestedAudio>();

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface IngestPhysicalOptions {
  logger?: AudioIngestionLogger;
  idempotencyStore?: Map<string, IngestedAudio>;
}

/**
 * Validates an uploaded physical-source recording (room mic or phone) and returns it as
 * available-for-transcription. Two checks, kept deliberately distinct: the claimed file
 * extension must be one we support (else UnsupportedFormatError); the file's actual bytes
 * must match a real signature for a supported format, and that signature must agree with
 * the claimed extension (else CorruptedAudioError) — catches empty files, truncated
 * uploads, and mislabeled files alike.
 */
export function ingestPhysicalRecording(
  source: PhysicalAudioSource,
  originalFilename: string,
  fileBuffer: Buffer,
  { logger = defaultLogger, idempotencyStore = defaultIdempotencyStore }: IngestPhysicalOptions = {}
): IngestedAudio {
  const claimedFormat = extractClaimedFormat(originalFilename);
  if (!claimedFormat) {
    throw new UnsupportedFormatError(`Unsupported or unrecognized file extension in "${originalFilename}"`, {
      source,
      originalFilename,
    });
  }

  const sniffedFormat = sniffAudioFormat(fileBuffer);
  if (!sniffedFormat) {
    throw new CorruptedAudioError(
      `File "${originalFilename}" claims to be ${claimedFormat} but its contents don't match any known audio format signature`,
      { source, originalFilename, claimedFormat, byteLength: fileBuffer.length }
    );
  }

  if (sniffedFormat !== claimedFormat) {
    throw new CorruptedAudioError(
      `File "${originalFilename}" claims to be ${claimedFormat} but its contents look like ${sniffedFormat}`,
      { source, originalFilename, claimedFormat, sniffedFormat }
    );
  }

  const id = `physical:${source}:${sha256Hex(fileBuffer)}`;
  const existing = idempotencyStore.get(id);
  if (existing) {
    logger.info('audio_ingestion_deduplicated', { source, originalFilename, id });
    return existing;
  }

  const quality = assessAudioQuality(sniffedFormat, fileBuffer);

  const ingested: IngestedAudio = {
    id,
    source,
    sourceRecordingId: id,
    format: sniffedFormat,
    sizeBytes: fileBuffer.length,
    ingestedAt: new Date().toISOString(),
    status: 'available_for_transcription',
    lowConfidence: quality.lowConfidence,
    lowConfidenceReason: quality.lowConfidence ? quality.reason : undefined,
  };

  idempotencyStore.set(id, ingested);
  logger.info('audio_ingested', {
    source,
    originalFilename,
    id,
    format: ingested.format,
    sizeBytes: ingested.sizeBytes,
    lowConfidence: ingested.lowConfidence,
    qualityReason: quality.reason,
  });

  if (quality.lowConfidence) {
    logger.info('audio_segment_flagged_for_review', {
      source,
      originalFilename,
      id,
      reason: quality.reason,
    });
  }

  return ingested;
}

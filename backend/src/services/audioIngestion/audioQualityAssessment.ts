import { SupportedAudioFormat } from './types';

export interface AudioQualityAssessment {
  lowConfidence: boolean;
  reason: string;
}

interface WavFormat {
  audioFormat: number;
  bitsPerSample: number;
}

interface ParsedWav {
  fmt: WavFormat;
  dataStart: number;
  dataLength: number;
}

const PCM_FORMAT_CODE = 1;

/** Walks WAV's chunk structure to find 'fmt ' and 'data' — skips any other chunk (LIST, fact, ...). */
function parseWavChunks(buffer: Buffer): ParsedWav | null {
  if (buffer.length < 12) return null;

  let offset = 12;
  let fmt: WavFormat | null = null;
  let dataStart: number | null = null;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === 'fmt ' && chunkDataStart + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataStart),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
      };
    } else if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataLength = Math.max(0, Math.min(chunkSize, buffer.length - chunkDataStart));
    }

    // Chunks are word-aligned: an odd-sized chunk has one byte of padding after it.
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataStart === null) return null;
  return { fmt, dataStart, dataLength };
}

const SILENCE_RMS_THRESHOLD = 0.02; // fraction of full-scale amplitude
const CLIPPING_SAMPLE_THRESHOLD = 0.995; // a sample this close to full-scale counts as clipped
const CLIPPING_RATIO_THRESHOLD = 0.01; // more than 1% of samples clipped is audibly distorted
const FULL_SCALE_16BIT = 32768;

function assessPcm16(buffer: Buffer, dataStart: number, sampleCount: number): AudioQualityAssessment {
  if (sampleCount === 0) {
    return { lowConfidence: true, reason: 'WAV file has no audio samples in its data chunk' };
  }

  let sumSquares = 0;
  let clippedCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const normalized = buffer.readInt16LE(dataStart + i * 2) / FULL_SCALE_16BIT;
    sumSquares += normalized * normalized;
    if (Math.abs(normalized) >= CLIPPING_SAMPLE_THRESHOLD) clippedCount++;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  const clippingRatio = clippedCount / sampleCount;

  if (rms < SILENCE_RMS_THRESHOLD) {
    return {
      lowConfidence: true,
      reason: `Signal is very quiet (RMS ${rms.toFixed(4)}, below the ${SILENCE_RMS_THRESHOLD} threshold) — likely too much background noise relative to speech`,
    };
  }

  if (clippingRatio > CLIPPING_RATIO_THRESHOLD) {
    return {
      lowConfidence: true,
      reason: `${(clippingRatio * 100).toFixed(1)}% of samples are clipped (above the ${CLIPPING_RATIO_THRESHOLD * 100}% threshold) — audio is distorted`,
    };
  }

  return { lowConfidence: false, reason: `Signal levels within normal range (RMS ${rms.toFixed(4)}, ${(clippingRatio * 100).toFixed(2)}% clipped)` };
}

/**
 * Flags a recording as low-confidence when its signal quality looks bad enough to hurt
 * transcription accuracy. Only WAV/PCM16 is actually analyzed (readable with plain Buffer
 * math); compressed formats need a real decoder we don't have, so they're flagged
 * conservatively with an honest reason rather than given a fabricated pass.
 */
export function assessAudioQuality(format: SupportedAudioFormat, buffer: Buffer): AudioQualityAssessment {
  if (format !== 'wav') {
    return {
      lowConfidence: true,
      reason: `Cannot analyze signal quality for compressed ${format} audio without a decoder — flagged conservatively pending a real decoder`,
    };
  }

  const parsed = parseWavChunks(buffer);
  if (!parsed) {
    return { lowConfidence: true, reason: 'Could not locate a valid fmt/data chunk structure in the WAV file' };
  }

  if (parsed.fmt.audioFormat !== PCM_FORMAT_CODE || parsed.fmt.bitsPerSample !== 16) {
    return {
      lowConfidence: true,
      reason: `Only 16-bit PCM WAV is analyzed today (found format code ${parsed.fmt.audioFormat}, ${parsed.fmt.bitsPerSample}-bit) — flagged conservatively`,
    };
  }

  const sampleCount = Math.floor(parsed.dataLength / 2);
  return assessPcm16(buffer, parsed.dataStart, sampleCount);
}

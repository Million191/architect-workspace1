import { SupportedAudioFormat } from './types';

export interface AudioQualityAssessment {
  lowConfidence: boolean;
  reason: string;
}

interface WavFormat {
  audioFormat: number;
  numChannels: number;
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
        numChannels: buffer.readUInt16LE(chunkDataStart + 2),
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

const CROSSTALK_FRAME_COUNT = 10; // segment is split into this many equal time windows for concurrent-energy analysis
const CROSSTALK_ACTIVE_RMS_THRESHOLD = SILENCE_RMS_THRESHOLD; // a channel counts as "active" in a frame using the same loudness bar as silence detection
const CROSSTALK_OVERLAP_RATIO_THRESHOLD = 0.6; // >60% of active frames having both channels active reads as overlapping speakers, not just loud audio

/**
 * Proxy for crosstalk (overlapping speakers): only detectable when there are separate
 * channels to compare. Splits the segment into equal frames and checks how often BOTH
 * channels carry above-silence energy in the same frame — sustained simultaneous energy
 * across channels is consistent with two sources talking over each other. This is a signal-
 * level heuristic, not real speaker diarization: it cannot tell "two overlapping speakers"
 * apart from "two microphones both picking up the same loud source" with certainty.
 */
function assessStereoCrosstalk(buffer: Buffer, dataStart: number, dataLength: number): AudioQualityAssessment {
  const pairCount = Math.floor(dataLength / 4); // 2 bytes/sample * 2 channels, interleaved L,R,L,R,...
  const frameSize = Math.max(1, Math.floor(pairCount / CROSSTALK_FRAME_COUNT));

  let activeFrames = 0;
  let bothActiveFrames = 0;

  for (let frameStart = 0; frameStart < pairCount; frameStart += frameSize) {
    const frameEnd = Math.min(frameStart + frameSize, pairCount);
    let leftSumSquares = 0;
    let rightSumSquares = 0;

    for (let i = frameStart; i < frameEnd; i++) {
      const pairOffset = dataStart + i * 4;
      const left = buffer.readInt16LE(pairOffset) / FULL_SCALE_16BIT;
      const right = buffer.readInt16LE(pairOffset + 2) / FULL_SCALE_16BIT;
      leftSumSquares += left * left;
      rightSumSquares += right * right;
    }

    const frameLength = frameEnd - frameStart;
    const leftRms = Math.sqrt(leftSumSquares / frameLength);
    const rightRms = Math.sqrt(rightSumSquares / frameLength);
    const leftActive = leftRms >= CROSSTALK_ACTIVE_RMS_THRESHOLD;
    const rightActive = rightRms >= CROSSTALK_ACTIVE_RMS_THRESHOLD;

    if (leftActive || rightActive) activeFrames++;
    if (leftActive && rightActive) bothActiveFrames++;
  }

  const overlapRatio = activeFrames > 0 ? bothActiveFrames / activeFrames : 0;
  if (activeFrames > 0 && overlapRatio > CROSSTALK_OVERLAP_RATIO_THRESHOLD) {
    return {
      lowConfidence: true,
      reason: `Both channels carry simultaneous energy in ${(overlapRatio * 100).toFixed(0)}% of active frames — consistent with crosstalk (overlapping speakers)`,
    };
  }

  return { lowConfidence: false, reason: 'no simultaneous cross-channel energy detected' };
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

  // Crosstalk can only be assessed when there are separate channels to compare; mono has
  // nothing to compare against, so it goes straight to the existing silence/clipping check.
  if (parsed.fmt.numChannels === 2) {
    const crosstalk = assessStereoCrosstalk(buffer, parsed.dataStart, parsed.dataLength);
    if (crosstalk.lowConfidence) return crosstalk;
  }

  const sampleCount = Math.floor(parsed.dataLength / 2);
  return assessPcm16(buffer, parsed.dataStart, sampleCount);
}

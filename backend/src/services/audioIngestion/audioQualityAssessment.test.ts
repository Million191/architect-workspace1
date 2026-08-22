import { assessAudioQuality } from './audioQualityAssessment';

function buildWav(samples: number[], bitsPerSample = 16): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const dataBuffer = Buffer.alloc(samples.length * (bitsPerSample / 8));
  if (bitsPerSample === 16) {
    samples.forEach((s, i) => dataBuffer.writeInt16LE(s, i * 2));
  } else {
    samples.forEach((s, i) => dataBuffer.writeUInt8(s, i));
  }

  const fmtChunk = Buffer.alloc(24);
  fmtChunk.write('fmt ', 0, 'ascii');
  fmtChunk.writeUInt32LE(16, 4);
  fmtChunk.writeUInt16LE(1, 8); // PCM
  fmtChunk.writeUInt16LE(numChannels, 10);
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(byteRate, 16);
  fmtChunk.writeUInt16LE(blockAlign, 20);
  fmtChunk.writeUInt16LE(bitsPerSample, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(dataBuffer.length, 4);

  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(4 + fmtChunk.length + dataHeader.length + dataBuffer.length, 4);
  riffHeader.write('WAVE', 8, 'ascii');

  return Buffer.concat([riffHeader, fmtChunk, dataHeader, dataBuffer]);
}

function repeat(values: number[], times: number): number[] {
  return Array.from({ length: times }, () => values).flat();
}

/** Builds a 16-bit PCM stereo WAV by interleaving equal-length left/right sample arrays. */
function buildStereoWav(leftSamples: number[], rightSamples: number[]): Buffer {
  const sampleRate = 16000;
  const numChannels = 2;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const dataBuffer = Buffer.alloc(leftSamples.length * 2 * (bitsPerSample / 8));
  for (let i = 0; i < leftSamples.length; i++) {
    dataBuffer.writeInt16LE(leftSamples[i], i * 4);
    dataBuffer.writeInt16LE(rightSamples[i], i * 4 + 2);
  }

  const fmtChunk = Buffer.alloc(24);
  fmtChunk.write('fmt ', 0, 'ascii');
  fmtChunk.writeUInt32LE(16, 4);
  fmtChunk.writeUInt16LE(1, 8); // PCM
  fmtChunk.writeUInt16LE(numChannels, 10);
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(byteRate, 16);
  fmtChunk.writeUInt16LE(blockAlign, 20);
  fmtChunk.writeUInt16LE(bitsPerSample, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(dataBuffer.length, 4);

  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(4 + fmtChunk.length + dataHeader.length + dataBuffer.length, 4);
  riffHeader.write('WAVE', 8, 'ascii');

  return Buffer.concat([riffHeader, fmtChunk, dataHeader, dataBuffer]);
}

describe('assessAudioQuality', () => {
  it('does not flag a clean, moderate-amplitude signal', () => {
    const samples = repeat([8000, -8000], 500); // steady square wave, well above silence, no clipping
    const result = assessAudioQuality('wav', buildWav(samples));
    expect(result.lowConfidence).toBe(false);
  });

  it('flags a near-silent / very quiet signal as low confidence', () => {
    const samples = repeat([100, -100], 500); // RMS well below the silence threshold
    const result = assessAudioQuality('wav', buildWav(samples));
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/quiet/i);
  });

  it('flags a heavily clipped signal as low confidence', () => {
    const samples = repeat([32767, -32768], 500); // full-scale on almost every sample
    const result = assessAudioQuality('wav', buildWav(samples));
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/clipped/i);
  });

  it('flags compressed formats conservatively, with an honest reason (no decoder available)', () => {
    const mp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const result = assessAudioQuality('mp3', mp3Bytes);
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/decoder/i);
  });

  it('flags a malformed WAV with no data chunk as low confidence', () => {
    const noDataChunk = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
    const result = assessAudioQuality('wav', noDataChunk);
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/could not locate/i);
  });

  it('flags non-16-bit PCM as low confidence rather than guessing', () => {
    const samples = repeat([200, 50], 500);
    const result = assessAudioQuality('wav', buildWav(samples, 8));
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/16-bit/i);
  });

  it('flags a stereo segment with sustained simultaneous channel energy as crosstalk', () => {
    // Both channels loud for the whole segment — consistent with two overlapping speakers.
    const left = repeat([8000, -8000], 500);
    const right = repeat([7000, -7000], 500);
    const result = assessAudioQuality('wav', buildStereoWav(left, right));
    expect(result.lowConfidence).toBe(true);
    expect(result.reason).toMatch(/crosstalk/i);
  });

  it('does not flag a stereo segment where channels take turns (no overlap) as crosstalk', () => {
    // First half: only the left channel is active. Second half: only the right channel is
    // active. Each channel is loud on its own, but never at the same time as the other.
    const left = [...repeat([8000, -8000], 250), ...repeat([0], 500)];
    const right = [...repeat([0], 500), ...repeat([8000, -8000], 250)];
    const result = assessAudioQuality('wav', buildStereoWav(left, right));
    expect(result.lowConfidence).toBe(false);
  });
});

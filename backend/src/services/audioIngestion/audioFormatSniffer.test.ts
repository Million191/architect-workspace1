import { sniffAudioFormat, extractClaimedFormat } from './audioFormatSniffer';

function wavHeader(): Buffer {
  return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
}

function mp3HeaderWithId3(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function mp3HeaderRawFrameSync(): Buffer {
  return Buffer.from([0xff, 0xfb, 0x90, 0x00]);
}

function isoBmffHeader(brand: string): Buffer {
  return Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from(brand.padEnd(4, ' '))]);
}

describe('sniffAudioFormat', () => {
  it('identifies a WAV file by its RIFF/WAVE header', () => {
    expect(sniffAudioFormat(wavHeader())).toBe('wav');
  });

  it('identifies an MP3 file with an ID3 tag', () => {
    expect(sniffAudioFormat(mp3HeaderWithId3())).toBe('mp3');
  });

  it('identifies a tagless MP3 by its raw MPEG frame sync', () => {
    expect(sniffAudioFormat(mp3HeaderRawFrameSync())).toBe('mp3');
  });

  it('identifies an M4A file by its ISO-BMFF ftyp brand', () => {
    expect(sniffAudioFormat(isoBmffHeader('M4A'))).toBe('m4a');
  });

  it('identifies an MP4 file by its ISO-BMFF ftyp brand', () => {
    expect(sniffAudioFormat(isoBmffHeader('isom'))).toBe('mp4');
  });

  it('returns null for random bytes matching no known signature', () => {
    expect(sniffAudioFormat(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(sniffAudioFormat(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a truncated header that is too short to identify', () => {
    expect(sniffAudioFormat(Buffer.from('RIF'))).toBeNull();
  });
});

describe('extractClaimedFormat', () => {
  it.each([
    ['recording.wav', 'wav'],
    ['recording.MP3', 'mp3'],
    ['recording.m4a', 'm4a'],
    ['recording.mp4', 'mp4'],
  ])('reads %s as %s', (filename, expected) => {
    expect(extractClaimedFormat(filename)).toBe(expected);
  });

  it('returns null for an unsupported extension', () => {
    expect(extractClaimedFormat('recording.mov')).toBeNull();
  });

  it('returns null for a filename with no extension', () => {
    expect(extractClaimedFormat('recording')).toBeNull();
  });
});

import { SUPPORTED_AUDIO_FORMATS, SupportedAudioFormat } from './types';

/** Reads the file's own bytes to identify its real format — never trust a filename alone. */
export function sniffAudioFormat(buffer: Buffer): SupportedAudioFormat | null {
  if (isWav(buffer)) return 'wav';
  if (isMp3(buffer)) return 'mp3';
  const isoBmffBrand = isoBmffFormat(buffer);
  if (isoBmffBrand) return isoBmffBrand;
  return null;
}

function isWav(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
}

function isMp3(buffer: Buffer): boolean {
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') return true;
  // Raw MPEG frame sync: 11 set bits (0xFFE...) with no ID3 tag.
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

/** MP4 and M4A are both ISO Base Media File Format containers; the brand at offset 8 tells them apart. */
function isoBmffFormat(buffer: Buffer): 'mp4' | 'm4a' | null {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = buffer.toString('ascii', 8, 12);
  return brand.startsWith('M4A') ? 'm4a' : 'mp4';
}

/** The format the upload claims to be, from its filename — a claim, not a fact. */
export function extractClaimedFormat(filename: string): SupportedAudioFormat | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return (SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(ext) ? (ext as SupportedAudioFormat) : null;
}

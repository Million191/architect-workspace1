/**
 * Pure helpers that turn an email (or a bare name) into what the app shows for a person: a readable
 * name, initials, and an avatar colour that is always the same for the same person.
 *
 * `public/js/core/people.js` mirrors these exactly so a just-typed address renders the same before
 * the server knows it; `identity.test.ts` checks the two stay in step.
 */

/**
 * Avatar backgrounds. Every colour passes WCAG AA (≥ 4.5:1) against white initials, and reads on both
 * the light and dark surfaces. Order matters: changing it changes everyone's colour.
 */
export const AVATAR_PALETTE = ['#4f46e5', '#0e7490', '#047857', '#b45309', '#be123c', '#7c3aed', '#1d4ed8', '#a21caf', '#4d7c0f', '#c2410c'] as const;

const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** People are keyed by their address, case-insensitively. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 32-bit FNV-1a. Small, fast, and identical in the browser copy. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Same email (or, with no email, same name) → same colour, on every screen and every visit. */
export function avatarColor(key: string): string {
  return AVATAR_PALETTE[fnv1a(key.trim().toLowerCase()) % AVATAR_PALETTE.length];
}

/** "sara.lee+work@acme.com" → "Sara Lee"; "jdoe42@x.io" → "Jdoe". Falls back to the local part. */
export function readableNameFromEmail(email: string): string {
  const local = email.trim().split('@')[0].split('+')[0];
  const words = local
    .split(/[._-]+/)
    .map((w) => w.replace(/\d+$/g, ''))
    .filter((w) => w.length > 0);
  if (!words.length) return local || email.trim();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/** "Sara Lee" → "SL"; "Priya" → "P"; "" → "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

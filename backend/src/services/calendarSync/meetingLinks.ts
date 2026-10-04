/** Which video platform a meeting link belongs to. Mirrors `MA.cal.platformOf` in the page. */
export type MeetingPlatform = 'zoom' | 'teams' | 'meet' | 'none';

export function platformOf(link?: string | null): MeetingPlatform {
  const l = String(link ?? '').toLowerCase();
  if (l.includes('zoom.us/') || l.includes('zoom.com/')) return 'zoom';
  if (l.includes('teams.microsoft.com') || l.includes('teams.live.com')) return 'teams';
  if (l.includes('meet.google.com')) return 'meet';
  return 'none';
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * The best meeting link for an event: an explicit conference link first, then the first Zoom/Teams/
 * Meet link found in the location or description, then nothing (plain web links are not meetings).
 */
export function pickMeetingLink(candidates: Array<string | undefined | null>, freeText: Array<string | undefined | null> = []): string | undefined {
  for (const c of candidates) if (c && /^https?:\/\//i.test(c)) return c;
  for (const text of freeText) {
    for (const m of String(text ?? '').match(URL_RE) ?? []) {
      const link = m.replace(/[.,;]+$/, '');
      if (platformOf(link) !== 'none') return link;
    }
  }
  return undefined;
}

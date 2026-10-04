import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { AVATAR_PALETTE, avatarColor, fnv1a, initials, isEmail, normalizeEmail, readableNameFromEmail } from './identity';

/** Relative luminance contrast against white, per WCAG 2.1. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (l + 0.05);
}

/** Loads the browser copy (public/js/core/people.js) with just enough of the page around it. */
function browserPeople(): { avatarColor(k: string): string; readableNameFromEmail(e: string): string; fnv1a(t: string): number; palette: string[]; stackLabel(n: string[]): string } {
  const src = readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'js', 'core', 'people.js'), 'utf8');
  const MA: Record<string, unknown> = { ui: { el: () => ({}), append: () => ({}), initials } };
  vm.runInNewContext(src, { MA, Math });
  return MA.people as ReturnType<typeof browserPeople>;
}

describe('people identity', () => {
  it('turns an email into a readable name', () => {
    expect(readableNameFromEmail('sara.lee@acme.com')).toBe('Sara Lee');
    expect(readableNameFromEmail('TOM_WARD+work@acme.com')).toBe('Tom Ward');
    expect(readableNameFromEmail('jdoe42@x.io')).toBe('Jdoe');
    expect(readableNameFromEmail('a-b-c@x.io')).toBe('A B C');
    expect(readableNameFromEmail('1234@x.io')).toBe('1234'); // nothing readable → the local part
  });

  it('initials and email helpers handle edge cases', () => {
    expect(initials('Sara Lee')).toBe('SL');
    expect(initials('  priya ')).toBe('P');
    expect(initials('Mary Ann de Vries')).toBe('MV');
    expect(initials('')).toBe('?');
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('Priya <a@b.co>')).toBe(false);
    expect(normalizeEmail('  Sara.Lee@ACME.com ')).toBe('sara.lee@acme.com');
  });

  it('gives the same person the same colour, case-insensitively, and spreads people across the palette', () => {
    expect(avatarColor('Sara.Lee@acme.com')).toBe(avatarColor('sara.lee@acme.com '));
    const colours = new Set(Array.from({ length: 60 }, (_, i) => avatarColor(`person${i}@example.com`)));
    expect(colours.size).toBeGreaterThanOrEqual(8);
    expect(fnv1a('')).toBe(0x811c9dc5);
  });

  it('every avatar colour passes WCAG AA (4.5:1) with white initials', () => {
    for (const hex of AVATAR_PALETTE) expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });

  it('the browser copy agrees with the server exactly', () => {
    const web = browserPeople();
    expect(web.palette).toEqual([...AVATAR_PALETTE]);
    for (const key of ['sara.lee@acme.com', 'Tom@x.io', 'Priya', 'ünïcødé@x.io', '']) {
      expect(web.fnv1a(key)).toBe(fnv1a(key));
      expect(web.avatarColor(key)).toBe(avatarColor(key));
    }
    for (const email of ['sara.lee@acme.com', 'TOM_WARD+work@acme.com', 'jdoe42@x.io', '1234@x.io']) {
      expect(web.readableNameFromEmail(email)).toBe(readableNameFromEmail(email));
    }
  });

  it('stack labels read naturally for any number of people', () => {
    const label = browserPeople().stackLabel;
    expect(label([])).toBe('No participants');
    expect(label(['Sara Lee'])).toBe('Sara Lee');
    expect(label(['Sara Lee', 'Tom Ward'])).toBe('Sara Lee and Tom Ward');
    expect(label(['Sara Lee', 'Tom Ward', 'Ann Bo'])).toBe('Sara Lee, Tom Ward, and Ann Bo');
    expect(label(['Sara Lee', 'Tom Ward', 'A', 'B', 'C', 'D'])).toBe('Sara Lee, Tom Ward, and 4 others');
  });
});

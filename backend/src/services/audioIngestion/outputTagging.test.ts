import { buildOutputTag } from './outputTagging';
import { TaggingError } from './errors';
import { AudioSource } from './types';

describe('buildOutputTag', () => {
  it.each([
    ['zoom', 'Zoom'],
    ['teams', 'Teams'],
    ['meet', 'Google Meet'],
  ] as const)('tags a %s recording as [Virtual — %s]', (source, expectedLabel) => {
    const tag = buildOutputTag(source);
    expect(tag).toEqual({
      meetingType: 'Virtual',
      sourceLabel: expectedLabel,
      header: `[Virtual — ${expectedLabel}]`,
      locationUnknown: false,
    });
  });

  it.each(['room_mic', 'phone'] as const)('tags a %s recording with a location as [In-Person — Location]', (source) => {
    const tag = buildOutputTag(source, 'Conference Room A');
    expect(tag).toEqual({
      meetingType: 'In-Person',
      sourceLabel: 'Conference Room A',
      header: '[In-Person — Conference Room A]',
      locationUnknown: false,
    });
  });

  it('trims whitespace around a supplied location', () => {
    const tag = buildOutputTag('room_mic', '  Conference Room A  ');
    expect(tag.sourceLabel).toBe('Conference Room A');
    expect(tag.header).toBe('[In-Person — Conference Room A]');
  });

  it('falls back to an honest placeholder when a physical recording has no location (missing metadata)', () => {
    const tag = buildOutputTag('phone');
    expect(tag).toEqual({
      meetingType: 'In-Person',
      sourceLabel: 'Location unknown',
      header: '[In-Person — Location unknown]',
      locationUnknown: true,
    });
  });

  it('treats a whitespace-only location the same as a missing one', () => {
    const tag = buildOutputTag('room_mic', '   ');
    expect(tag.locationUnknown).toBe(true);
    expect(tag.header).toBe('[In-Person — Location unknown]');
  });

  it('throws a TaggingError for an unrecognized source instead of mistagging it', () => {
    expect(() => buildOutputTag('carrier_pigeon' as AudioSource)).toThrow(TaggingError);
    try {
      buildOutputTag('carrier_pigeon' as AudioSource);
      fail('expected buildOutputTag to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TaggingError);
      expect((err as TaggingError).errorClass).toBe('TaggingError');
      expect((err as TaggingError).context).toEqual({ source: 'carrier_pigeon' });
    }
  });
});

import { TaggingError } from './errors';
import { AudioSource, OutputTag, PhysicalAudioSource, VirtualMeetingPlatform } from './types';

const VIRTUAL_PLATFORM_LABELS: Record<VirtualMeetingPlatform, string> = {
  zoom: 'Zoom',
  teams: 'Teams',
  meet: 'Google Meet',
};

const VIRTUAL_SOURCES = new Set<string>(Object.keys(VIRTUAL_PLATFORM_LABELS));
const PHYSICAL_SOURCES = new Set<PhysicalAudioSource>(['room_mic', 'phone']);

/**
 * Builds the `[Meeting Type — Source]` header tag for a processed meeting's output, per
 * REQ-004. Pure function over data ingestion already has: the audio `source` recorded at
 * ingest time, plus an optional human-supplied `location` for physical recordings — nothing
 * in the system captures a room/site name today, so callers pass it in until a route
 * actually collects it. A missing location doesn't fail tagging; it falls back to an
 * honestly-labeled placeholder rather than fabricating a place (the "missing metadata"
 * failure path). An unrecognized `source` throws `TaggingError` rather than mistagging
 * (the "incorrect tagging" failure path) — this can only happen if a caller passes a value
 * outside the `AudioSource` union, since TypeScript already narrows it at compile time.
 */
export function buildOutputTag(source: AudioSource, location?: string): OutputTag {
  if (VIRTUAL_SOURCES.has(source)) {
    const sourceLabel = VIRTUAL_PLATFORM_LABELS[source as VirtualMeetingPlatform];
    return {
      meetingType: 'Virtual',
      sourceLabel,
      header: `[Virtual — ${sourceLabel}]`,
      locationUnknown: false,
    };
  }

  if (PHYSICAL_SOURCES.has(source as PhysicalAudioSource)) {
    const trimmedLocation = location?.trim();
    const locationUnknown = !trimmedLocation;
    const sourceLabel = locationUnknown ? 'Location unknown' : (trimmedLocation as string);
    return {
      meetingType: 'In-Person',
      sourceLabel,
      header: `[In-Person — ${sourceLabel}]`,
      locationUnknown,
    };
  }

  throw new TaggingError(`Cannot tag output: unrecognized audio source "${String(source)}"`, { source });
}

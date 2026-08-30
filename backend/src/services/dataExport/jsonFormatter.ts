import { InvalidJsonFormatError } from './errors';
import { JsonExportPayload, MeetingDataExportInput } from './types';

/**
 * Walks `value` looking for anything `JSON.stringify` cannot faithfully represent. Plain
 * `JSON.stringify` only *throws* on a circular reference or a `BigInt` — a `NaN`, `Infinity`, or
 * `-Infinity` silently becomes `null` instead of erroring, which would ship corrupted numeric
 * fields (e.g. a bad `daysOpen`/`timestampMs` calculation) to an external tracker as if they were
 * valid data. This walk catches all of those *before* anything is serialized, so the story's
 * "incorrect JSON formatting" failure path is a loud, specific error rather than silent data
 * corruption. `seen` tracks only the current recursion stack (removed on the way back out), so
 * the same object referenced twice in different branches — common when `TrackedActionItem`
 * entries share an underlying `ActionItem` — is not mistaken for an actual cycle.
 */
function findJsonIncompatibleValue(value: unknown, path: string, seen: Set<unknown>): string | null {
  if (value === null || value === undefined) return null;

  const type = typeof value;

  if (type === 'function') return `${path} is a function, which cannot be represented in JSON`;
  if (type === 'symbol') return `${path} is a symbol, which cannot be represented in JSON`;
  if (type === 'bigint') return `${path} is a BigInt, which cannot be represented in JSON`;

  if (type === 'number') {
    const n = value as number;
    if (Number.isNaN(n)) return `${path} is NaN, which cannot be represented in JSON`;
    if (!Number.isFinite(n)) return `${path} is not finite (Infinity/-Infinity), which cannot be represented in JSON`;
    return null;
  }

  if (type !== 'object') return null;

  if (seen.has(value)) return `${path} contains a circular reference`;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const reason = findJsonIncompatibleValue(value[i], `${path}[${i}]`, seen);
      if (reason) return reason;
    }
  } else if (!(value instanceof Date)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const reason = findJsonIncompatibleValue(child, `${path}.${key}`, seen);
      if (reason) return reason;
    }
  }

  seen.delete(value);
  return null;
}

/**
 * Formats already input-validated meeting data as the JSON payload an external tracker consumes
 * (acceptance criterion #1). Wraps the data in a `{ meetingId, exportedAt, data }` envelope so a
 * receiving integration always finds the same top-level fields regardless of which optional
 * pieces of `data` are present. Proves the result is well-formed in two ways: (1) the recursive
 * scan above rejects anything `JSON.stringify` would mangle or throw on, and (2) the serialized
 * string is parsed back and must itself succeed, since a `json` value that a consumer can't parse
 * is exactly the "incorrect JSON formatting" failure this story exists to prevent.
 */
export function formatMeetingDataAsJson(meetingData: MeetingDataExportInput, exportedAt: string = new Date().toISOString()): JsonExportPayload {
  const incompatibility = findJsonIncompatibleValue(meetingData, '$', new Set());
  if (incompatibility) {
    throw new InvalidJsonFormatError(`Meeting data cannot be represented as valid JSON: ${incompatibility}`, {
      meetingId: meetingData.meetingId,
    });
  }

  const envelope = { meetingId: meetingData.meetingId, exportedAt, data: meetingData };

  let json: string;
  try {
    json = JSON.stringify(envelope);
  } catch (error) {
    throw new InvalidJsonFormatError(`JSON.stringify failed: ${error instanceof Error ? error.message : String(error)}`, {
      meetingId: meetingData.meetingId,
    });
  }

  try {
    JSON.parse(json);
  } catch (error) {
    throw new InvalidJsonFormatError('Serialized meeting data is not valid, parseable JSON', {
      meetingId: meetingData.meetingId,
    });
  }

  return { meetingId: meetingData.meetingId, exportedAt, json };
}

/**
 * Base for all Data Export failures. `errorClass` is the stable tag required by the
 * Observability Framework (CLAUDE.md) — logs must never carry a generic "Error".
 */
export abstract class DataExportError extends Error {
  abstract readonly errorClass: string;

  constructor(message: string, readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Input this service cannot safely act on — meeting data missing its `meetingId`. This is the
 * story's input-boundary failure path: rather than export data with no idempotency key to dedupe
 * or trace it by, the request fails loud instead of guessing one.
 */
export class ContractViolationError extends DataExportError {
  readonly errorClass = 'ContractViolationError';
}

/**
 * The meeting data could not be turned into valid, well-formed JSON — e.g. it contains a
 * circular reference, or round-tripping it through `JSON.stringify`/`JSON.parse` doesn't
 * reproduce an equivalent structure. This is the story's "incorrect JSON formatting" failure
 * path: malformed output is never sent to an external tracker, since a tracker that receives it
 * has no safe way to tell a formatting bug from real data.
 */
export class InvalidJsonFormatError extends DataExportError {
  readonly errorClass = 'InvalidJsonFormatError';
}

/**
 * The `DataOutputClient` failed or timed out after `withTimeoutAndRetry` exhausted its capped
 * retries. This is the story's "data output service failure" / "data output retry failure" path:
 * the write to the real external tracker did not succeed, and there is no safe partial result to
 * return, so the whole export attempt fails loud rather than silently reporting success.
 */
export class DataOutputFailedError extends DataExportError {
  readonly errorClass = 'DataOutputFailedError';
}

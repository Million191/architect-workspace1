import { UpstreamTimeoutError } from './errors';

export interface RetryOptions {
  /** Aborts a single attempt after this many ms. */
  timeoutMs: number;
  /** Total attempts including the first try. Must be >= 1 — no unbounded retries. */
  maxAttempts: number;
  /** Delay before attempt N+1, given the attempt number just failed. Defaults to capped exponential backoff. */
  backoffMs?: (attempt: number) => number;
  /** Decides whether a failure is worth retrying. Defaults to "retry everything". */
  isRetryable?: (error: unknown) => boolean;
  /** Used only in the timeout error message/log context. */
  operationName: string;
}

const defaultBackoffMs = (attempt: number): number => Math.min(1000 * 2 ** (attempt - 1), 8000);
const defaultIsRetryable = (): boolean => true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races `operation` against a timeout that always rejects, even if `operation` never
 * settles and ignores the AbortSignal. The signal is still passed through so
 * well-behaved callers (e.g. fetch) can cancel the underlying work.
 */
function runOnce<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName: string,
  attempt: number,
  maxAttempts: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new UpstreamTimeoutError(
          `${operationName} timed out after ${timeoutMs}ms (attempt ${attempt}/${maxAttempts})`,
          { operationName, attempt, maxAttempts, timeoutMs }
        )
      );
    }, timeoutMs);
  });

  return Promise.race([operation(controller.signal), timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Wraps a single outbound call with an explicit per-attempt timeout and capped retries.
 * Every external boundary in this repo must go through something like this (CLAUDE.md:
 * Failure-First Design, Security Enforcement Layer).
 */
export async function withTimeoutAndRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { timeoutMs, maxAttempts, operationName } = options;
  const backoffMs = options.backoffMs ?? defaultBackoffMs;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  if (maxAttempts < 1) {
    throw new RangeError('maxAttempts must be at least 1');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runOnce(operation, timeoutMs, operationName, attempt, maxAttempts);
    } catch (error) {
      lastError = error;

      const hasAttemptsLeft = attempt < maxAttempts;
      if (!hasAttemptsLeft || !isRetryable(lastError)) {
        throw lastError;
      }

      await sleep(backoffMs(attempt));
    }
  }

  // Unreachable: the loop above always returns or throws.
  throw lastError;
}

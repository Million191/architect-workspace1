import { withTimeoutAndRetry, RetryOptions } from './withTimeoutAndRetry';
import { CircuitBreaker } from './circuitBreaker';

export interface ReliableCallOptions extends RetryOptions {
  breaker: CircuitBreaker;
}

/**
 * The full reliability stack for one external boundary call: circuit breaker on the outside,
 * timeout+retry on the inside. Ordering matters — `breaker` wraps the whole retried operation,
 * so a call that fails all `maxAttempts` retries still counts as exactly ONE failure toward the
 * breaker's `failureThreshold`, not `maxAttempts` of them. Without that ordering, retries would
 * trip the breaker `maxAttempts` times faster than intended, and a breaker that's already open
 * short-circuits before any timeout/retry is attempted, so a known-down upstream costs one
 * synchronous rejection instead of `maxAttempts * timeoutMs` of wasted waiting.
 */
export async function callWithReliability<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ReliableCallOptions
): Promise<T> {
  const { breaker, ...retryOptions } = options;
  return breaker.execute(() => withTimeoutAndRetry(operation, retryOptions));
}

import { CircuitOpenError } from './errors';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures (in `closed`) that trip the breaker to `open`. Must be >= 1. */
  failureThreshold: number;
  /** How long the breaker stays `open` before letting one probe call through. Must be >= 0. */
  cooldownMs: number;
  /** Used only in the rejection error's message/context. */
  operationName: string;
  /** Fired whenever the state actually changes — the hook for structured logging/metrics. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  clock?: () => number;
}

/**
 * Per-operation circuit breaker: `closed` (calls pass through), `open` (calls are rejected
 * immediately, without touching the upstream, until the cooldown elapses), `half_open` (exactly
 * one probe call is let through; its outcome decides whether the breaker closes or reopens).
 *
 * This class tracks ONE outcome per `execute()` call. To make a whole retried operation count
 * as a single failure (so the threshold trips on "N distinct failed operations", not "N failed
 * HTTP attempts"), wrap it around `withTimeoutAndRetry` — see `withReliability.ts`, the
 * canonical composition for this repo's external-boundary calls (CLAUDE.md: Failure-First
 * Design, Security Enforcement Layer).
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;
  private readonly clock: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1) {
      throw new RangeError('failureThreshold must be at least 1');
    }
    if (options.cooldownMs < 0) {
      throw new RangeError('cooldownMs must not be negative');
    }
    this.clock = options.clock ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeEnterHalfOpen();
    return this.state;
  }

  /**
   * Runs `operation` through the breaker. Rejects with `CircuitOpenError` — without ever
   * calling `operation` — when the breaker is open, or when it's half-open and a probe is
   * already in flight (so concurrent callers don't all spend their own timeout finding out
   * the upstream is still down).
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.maybeEnterHalfOpen();

    if (this.state === 'open') {
      throw new CircuitOpenError(`${this.options.operationName}: circuit open, rejecting without calling upstream`, {
        operationName: this.options.operationName,
        consecutiveFailures: this.consecutiveFailures,
      });
    }

    const isProbe = this.state === 'half_open';
    if (isProbe) {
      if (this.halfOpenProbeInFlight) {
        throw new CircuitOpenError(`${this.options.operationName}: half-open probe already in flight`, {
          operationName: this.options.operationName,
        });
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(isProbe);
      throw error;
    } finally {
      if (isProbe) this.halfOpenProbeInFlight = false;
    }
  }

  private maybeEnterHalfOpen(): void {
    if (this.state !== 'open' || this.openedAt === null) return;
    if (this.clock() - this.openedAt >= this.options.cooldownMs) {
      this.setState('half_open');
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.setState('closed');
  }

  private onFailure(wasProbe: boolean): void {
    this.consecutiveFailures += 1;

    if (wasProbe || this.consecutiveFailures >= this.options.failureThreshold) {
      this.openedAt = this.clock();
      this.setState('open');
    }
  }

  private setState(next: CircuitState): void {
    const previous = this.state;
    this.state = next;
    if (previous !== next) this.options.onStateChange?.(previous, next);
  }
}

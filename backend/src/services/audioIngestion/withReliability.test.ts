import { callWithReliability } from './withReliability';
import { CircuitBreaker } from './circuitBreaker';
import { CircuitOpenError } from './errors';

const noBackoff = () => 1; // keep tests fast; still exercises the retry path

describe('callWithReliability', () => {
  it('passes a successful call straight through and leaves the breaker closed', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, operationName: 'testOp' });
    const operation = jest.fn().mockResolvedValue('ok');

    const result = await callWithReliability(operation, {
      breaker,
      timeoutMs: 50,
      maxAttempts: 3,
      backoffMs: noBackoff,
      operationName: 'testOp',
    });

    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('retries transient failures underneath, and only reports ONE outcome to the breaker', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, operationName: 'testOp' });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');

    const result = await callWithReliability(operation, {
      breaker,
      timeoutMs: 50,
      maxAttempts: 3,
      backoffMs: noBackoff,
      operationName: 'testOp',
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    // Recovering mid-retry must not leave any failure count behind on the breaker.
    expect(breaker.getState()).toBe('closed');
  });

  it('a fully-exhausted retry counts as exactly ONE breaker failure, not maxAttempts of them', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, operationName: 'testOp' });
    const alwaysFails = jest.fn().mockRejectedValue(new Error('down'));
    const call = () =>
      callWithReliability(alwaysFails, {
        breaker,
        timeoutMs: 50,
        maxAttempts: 3,
        backoffMs: noBackoff,
        operationName: 'testOp',
      });

    await expect(call()).rejects.toThrow('down');
    expect(alwaysFails).toHaveBeenCalledTimes(3); // one call's worth of retries...
    expect(breaker.getState()).toBe('closed'); // ...but only 1 of 2 failures toward the threshold

    await expect(call()).rejects.toThrow('down');
    expect(breaker.getState()).toBe('open'); // the 2nd exhausted call trips it
  });

  it('short-circuits on an open breaker without calling the operation at all', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, operationName: 'testOp' });
    await expect(
      callWithReliability(jest.fn().mockRejectedValue(new Error('down')), {
        breaker,
        timeoutMs: 50,
        maxAttempts: 1,
        backoffMs: noBackoff,
        operationName: 'testOp',
      })
    ).rejects.toThrow('down');
    expect(breaker.getState()).toBe('open');

    const operation = jest.fn().mockResolvedValue('should not run');
    await expect(
      callWithReliability(operation, {
        breaker,
        timeoutMs: 50,
        maxAttempts: 3,
        backoffMs: noBackoff,
        operationName: 'testOp',
      })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });
});

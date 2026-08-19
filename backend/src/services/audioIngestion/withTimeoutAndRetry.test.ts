import { withTimeoutAndRetry } from './withTimeoutAndRetry';
import { UpstreamTimeoutError } from './errors';

const noBackoff = () => 1; // keep tests fast; still exercises the retry path

describe('withTimeoutAndRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const operation = jest.fn().mockResolvedValue('ok');

    const result = await withTimeoutAndRetry(operation, {
      timeoutMs: 50,
      maxAttempts: 3,
      backoffMs: noBackoff,
      operationName: 'testOp',
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds on a later attempt', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');

    const result = await withTimeoutAndRetry(operation, {
      timeoutMs: 50,
      maxAttempts: 3,
      backoffMs: noBackoff,
      operationName: 'testOp',
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once maxAttempts is exhausted (capped, not infinite)', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withTimeoutAndRetry(operation, {
        timeoutMs: 50,
        maxAttempts: 3,
        backoffMs: noBackoff,
        operationName: 'testOp',
      })
    ).rejects.toThrow('always fails');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('wraps a hung call as UpstreamTimeoutError once its timeout elapses', async () => {
    const operation = jest.fn().mockImplementation(() => new Promise(() => {})); // never settles

    await expect(
      withTimeoutAndRetry(operation, {
        timeoutMs: 10,
        maxAttempts: 1,
        backoffMs: noBackoff,
        operationName: 'testOp',
      })
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it('does not retry when isRetryable says no', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withTimeoutAndRetry(operation, {
        timeoutMs: 50,
        maxAttempts: 5,
        backoffMs: noBackoff,
        isRetryable: () => false,
        operationName: 'testOp',
      })
    ).rejects.toThrow('non-retryable');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects maxAttempts < 1 up front', async () => {
    const operation = jest.fn();

    await expect(
      withTimeoutAndRetry(operation, {
        timeoutMs: 50,
        maxAttempts: 0,
        operationName: 'testOp',
      })
    ).rejects.toBeInstanceOf(RangeError);
    expect(operation).not.toHaveBeenCalled();
  });
});

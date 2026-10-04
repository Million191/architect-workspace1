import { CircuitBreaker } from './circuitBreaker';
import { CircuitOpenError } from './errors';

function makeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('CircuitBreaker', () => {
  it('starts closed and passes successful calls through', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, operationName: 'testOp' });

    const result = await breaker.execute(async () => 'ok');

    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('rejects failureThreshold constructor value below 1', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, cooldownMs: 1000, operationName: 'testOp' })).toThrow(
      RangeError
    );
  });

  it('trips to open after failureThreshold consecutive failures and rejects further calls without invoking the operation', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000, operationName: 'testOp' });
    const failing = jest.fn().mockRejectedValue(new Error('upstream down'));

    await expect(breaker.execute(failing)).rejects.toThrow('upstream down');
    expect(breaker.getState()).toBe('closed');

    await expect(breaker.execute(failing)).rejects.toThrow('upstream down');
    expect(breaker.getState()).toBe('open');
    expect(failing).toHaveBeenCalledTimes(2);

    const operation = jest.fn().mockResolvedValue('should not run');
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('a single failure below the threshold does not trip the breaker', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, operationName: 'testOp' });

    await expect(breaker.execute(async () => { throw new Error('one-off'); })).rejects.toThrow('one-off');
    expect(breaker.getState()).toBe('closed');

    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('moves to half_open only after cooldownMs elapses, and a successful probe closes the breaker', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 500, operationName: 'testOp', clock: clock.now });

    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(breaker.getState()).toBe('open');

    clock.advance(499);
    expect(breaker.getState()).toBe('open');
    await expect(breaker.execute(async () => 'probe result')).rejects.toBeInstanceOf(CircuitOpenError);

    clock.advance(1);
    expect(breaker.getState()).toBe('half_open');

    const result = await breaker.execute(async () => 'probe result');
    expect(result).toBe('probe result');
    expect(breaker.getState()).toBe('closed');
  });

  it('a failed probe reopens the breaker and restarts the cooldown', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 500, operationName: 'testOp', clock: clock.now });

    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow('down');
    clock.advance(500);
    expect(breaker.getState()).toBe('half_open');

    await expect(breaker.execute(async () => { throw new Error('still down'); })).rejects.toThrow('still down');
    expect(breaker.getState()).toBe('open');

    clock.advance(499);
    expect(breaker.getState()).toBe('open');
    clock.advance(1);
    expect(breaker.getState()).toBe('half_open');
  });

  it('only lets one probe through at a time while half_open; concurrent callers are rejected', async () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 500, operationName: 'testOp', clock: clock.now });

    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow('down');
    clock.advance(500);
    expect(breaker.getState()).toBe('half_open');

    let resolveProbe: (value: string) => void;
    const slowProbe = new Promise<string>((resolve) => { resolveProbe = resolve; });

    const firstCall = breaker.execute(() => slowProbe);
    const secondCall = breaker.execute(async () => 'should be rejected');

    await expect(secondCall).rejects.toBeInstanceOf(CircuitOpenError);

    resolveProbe!('probe ok');
    await expect(firstCall).resolves.toBe('probe ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('fires onStateChange exactly on real transitions, not on repeated checks of the same state', async () => {
    const transitions: Array<[string, string]> = [];
    const clock = makeClock();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 100,
      operationName: 'testOp',
      clock: clock.now,
      onStateChange: (from, to) => transitions.push([from, to]),
    });

    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow('down');
    clock.advance(100);
    breaker.getState();
    breaker.getState();

    expect(transitions).toEqual([
      ['closed', 'open'],
      ['open', 'half_open'],
    ]);
  });
});

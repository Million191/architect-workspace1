import {
  UnsupportedFormatError,
  CorruptedAudioError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  UpstreamRejectedError,
  ContractViolationError,
  ConfigurationError,
} from './errors';

describe('IngestionError subclasses', () => {
  it.each([
    [UnsupportedFormatError, 'UnsupportedFormatError'],
    [CorruptedAudioError, 'CorruptedAudioError'],
    [UpstreamTimeoutError, 'UpstreamTimeoutError'],
    [UpstreamUnavailableError, 'UpstreamUnavailableError'],
    [UpstreamRejectedError, 'UpstreamRejectedError'],
    [ContractViolationError, 'ContractViolationError'],
    [ConfigurationError, 'ConfigurationError'],
  ])('%s carries a stable errorClass and preserves context', (ErrorClass, expectedClass) => {
    const err = new ErrorClass('something went wrong', { platform: 'zoom' });
    expect(err.errorClass).toBe(expectedClass);
    expect(err.name).toBe(expectedClass);
    expect(err.message).toBe('something went wrong');
    expect(err.context).toEqual({ platform: 'zoom' });
    expect(err).toBeInstanceOf(Error);
  });
});

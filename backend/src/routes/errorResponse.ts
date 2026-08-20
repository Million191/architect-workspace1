import {
  CorruptedAudioError,
  UnsupportedFormatError,
  ConfigurationError,
  UpstreamRejectedError,
  ContractViolationError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  IngestionError,
} from '../services/audioIngestion/errors';

/** Maps any ingestion failure to the HTTP status and message its route should return. */
export function statusForIngestionError(error: unknown): { status: number; message: string } {
  if (error instanceof UnsupportedFormatError) return { status: 422, message: error.message };
  if (error instanceof CorruptedAudioError) return { status: 422, message: error.message };
  if (error instanceof ConfigurationError) return { status: 500, message: error.message };
  if (error instanceof UpstreamRejectedError) return { status: 502, message: 'The upstream platform rejected the request.' };
  if (error instanceof ContractViolationError) return { status: 502, message: 'The upstream platform returned an unexpected response.' };
  if (error instanceof UpstreamTimeoutError) return { status: 504, message: 'The upstream platform timed out.' };
  if (error instanceof UpstreamUnavailableError) return { status: 502, message: 'The upstream platform is unavailable.' };
  return { status: 500, message: 'Audio ingestion failed unexpectedly.' };
}

/** The stable error_class tag required by the Observability Framework — never log a bare "Error". */
export function errorClassOf(error: unknown): string {
  return error instanceof IngestionError ? error.errorClass : 'UnknownError';
}

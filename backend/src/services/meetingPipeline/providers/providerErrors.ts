/**
 * A failure from a real outside provider (Whisper, Claude, AssemblyAI, SMTP), tagged with a stable
 * `errorClass`. The message is always written here in this repo, never a raw upstream response
 * body, so the page can show it as-is.
 */
export class ProviderCallError extends Error {
  constructor(
    readonly errorClass: string,
    message: string
  ) {
    super(message);
    this.name = 'ProviderCallError';
  }
}

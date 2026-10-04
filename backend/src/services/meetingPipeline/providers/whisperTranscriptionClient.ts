import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { RawTranscriptSegment, TranscriptionClient, TranscriptionInput } from '../../transcription/types';
import { DiarizationClient, NameMappingClient } from '../../diarization/types';
import { recordAuditEvent } from '../auditLog';
import { ProviderCallError } from './providerErrors';

export interface WhisperConfig {
  /** The meeting-assistant folder holding `whisper_transcribe.py` and its uv-managed `.venv`. */
  projectDir: string;
  /** `uv` executable; resolved from PATH by default. */
  uvCommand?: string;
  /** Kills the child process after this long — local CPU transcription of a long meeting is slow. */
  timeoutMs: number;
}

interface WhisperOutput {
  segments?: RawTranscriptSegment[];
  error?: string;
  message?: string;
}

/** Runs the Python script with argument-array spawn (no shell), captures stdout, and enforces a hard kill on timeout. */
function runWhisper(config: WhisperConfig, audioPath: string): Promise<WhisperOutput> {
  return new Promise((resolve, reject) => {
    // VIRTUAL_ENV from another project makes uv print a warning and could point at the wrong env.
    const env = { ...process.env, VIRTUAL_ENV: undefined, PYTHONIOENCODING: 'utf-8' };
    const child = spawn(config.uvCommand ?? 'uv', ['run', '--no-sync', 'python', 'whisper_transcribe.py', audioPath], {
      cwd: config.projectDir,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ProviderCallError('UpstreamTimeoutError', `Local Whisper did not finish within ${Math.round(config.timeoutMs / 1000)}s.`));
    }, config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new ProviderCallError('ConfigurationError', `Could not start local Whisper via uv: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed: WhisperOutput | undefined;
      try {
        parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') as WhisperOutput;
      } catch {
        parsed = undefined;
      }
      if (code === 0 && parsed && Array.isArray(parsed.segments)) {
        resolve(parsed);
        return;
      }
      const detail = parsed?.message ?? stderr.trim().split('\n').slice(-1)[0] ?? 'no output';
      reject(new ProviderCallError(parsed?.error ? `Whisper${parsed.error}` : 'WhisperFailed', `Local Whisper failed (exit ${code}): ${detail}`));
    });
  });
}

/**
 * Real speech-to-text using the faster-whisper install in meeting-assistant/. Audio never leaves
 * the machine. Whisper cannot tell speakers apart, so the diarization and name-mapping clients
 * below report one unnamed speaker for the whole recording: every line ends up labelled
 * "Unidentified Speaker" (the diarization service's own label for unmapped speakers) — never a guessed name.
 */
export function createWhisperClients(config: WhisperConfig): {
  transcriptionClient: TranscriptionClient;
  diarizationClient: DiarizationClient;
  nameMappingClient: NameMappingClient;
} {
  return {
    transcriptionClient: {
      async transcribe({ audioId, format, buffer }: TranscriptionInput) {
        const tempPath = path.join(os.tmpdir(), `meeting-${randomUUID()}.${format}`);
        const started = Date.now();
        await fs.writeFile(tempPath, buffer);
        try {
          const output = await runWhisper(config, tempPath);
          recordAuditEvent({
            event: 'whisper_transcription_completed',
            outcome: 'success',
            resourceId: audioId,
            durationMs: Date.now() - started,
            context: { segmentCount: output.segments?.length ?? 0 },
          });
          if (!output.segments || output.segments.length === 0) {
            throw new ProviderCallError('NoSpeechDetected', 'Whisper found no speech in this recording.');
          }
          return output.segments;
        } catch (error) {
          recordAuditEvent({
            event: 'whisper_transcription_failed',
            outcome: 'failure',
            resourceId: audioId,
            errorClass: error instanceof ProviderCallError ? error.errorClass : 'UnknownError',
            durationMs: Date.now() - started,
            context: { message: error instanceof Error ? error.message : String(error) },
          });
          throw error;
        } finally {
          await fs.rm(tempPath, { force: true }).catch((cleanupError: Error) =>
            recordAuditEvent({ event: 'temp_audio_cleanup_failed', outcome: 'failure', resourceId: audioId, errorClass: 'FileSystemError', context: { message: cleanupError.message } })
          );
        }
      },
    },
    diarizationClient: {
      // One span covering everything: Whisper gives no speaker information, so nothing is split or attributed.
      async diarize() {
        return [{ startMs: 0, endMs: Number.MAX_SAFE_INTEGER, speakerTag: 'UNSEPARATED' }];
      },
    },
    nameMappingClient: {
      async mapSpeakersToNames() {
        return {};
      },
    },
  };
}

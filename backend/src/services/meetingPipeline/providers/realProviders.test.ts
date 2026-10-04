import { promises as fs } from 'fs';
import path from 'path';
import { createRealProviders } from './realProviders';
import { createWhisperClients } from './whisperTranscriptionClient';
import { createMeetingPipeline, createPipelineStores } from '../meetingPipelineService';
import { ProviderNotConfiguredError } from '../errors';

const MEETING_ASSISTANT_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'meeting-assistant');

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('createRealProviders', () => {
  it('names every missing piece and never claims demo mode', () => {
    const providers = createRealProviders({ WHISPER_PROJECT_DIR: path.join(__dirname, 'does-not-exist') });
    expect(providers.mode).toBe('live');
    expect(providers.readiness?.draft.join(' ')).toMatch(/ANTHROPIC_API_KEY/);
    expect(providers.readiness?.draft.join(' ')).toMatch(/whisper_transcribe\.py is missing/);
    expect(providers.readiness?.send).toEqual([]); // draft-only by default: sending needs nothing
  });

  it('makes the pipeline refuse a draft with a configuration error before touching any provider', async () => {
    const providers = createRealProviders({ WHISPER_PROJECT_DIR: path.join(__dirname, 'does-not-exist') });
    const transcribe = jest.spyOn(providers.transcriptionClient, 'transcribe');
    const pipeline = createMeetingPipeline(providers, createPipelineStores());
    const draft = pipeline.draftMinutes({ originalFilename: 'm.wav', buffer: Buffer.from('RIFF0000WAVE'), source: 'room_mic', attendeeNames: ['A'] });
    await expect(draft).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe('local Whisper speaker handling', () => {
  it('reports one unseparated speaker with no name, so every line becomes "Unidentified Speaker"', async () => {
    const clients = createWhisperClients({ projectDir: MEETING_ASSISTANT_DIR, timeoutMs: 1000 });
    expect(await clients.nameMappingClient.mapSpeakersToNames(['UNSEPARATED'], [{ name: 'Alice' }])).toEqual({});
    const spans = await clients.diarizationClient.diarize({ audioId: 'a', buffer: Buffer.alloc(0) });
    expect(spans).toHaveLength(1);
  });
});

// Opt-in integration test (CLAUDE.md: integration tests need an explicit flag): runs the real local
// Whisper model on the sample recording. `RUN_WHISPER_TEST=1 npx jest realProviders`.
const whisperIt = process.env.RUN_WHISPER_TEST === '1' ? it : it.skip;
whisperIt(
  'transcribes the sample recording with real Whisper',
  async () => {
    const buffer = await fs.readFile(path.join(MEETING_ASSISTANT_DIR, 'data', 'attachments', 'sample-standup-recording.wav'));
    const clients = createWhisperClients({ projectDir: MEETING_ASSISTANT_DIR, timeoutMs: 5 * 60 * 1000 });
    const segments = await clients.transcriptionClient.transcribe({ audioId: 'sample', format: 'wav', buffer });
    expect(segments.map((s) => s.text).join(' ')).toMatch(/Priya/);
    segments.forEach((s, i) => {
      expect(s.endMs).toBeGreaterThan(s.startMs);
      if (i > 0) expect(s.startMs).toBeGreaterThanOrEqual(segments[i - 1].endMs);
    });
  },
  6 * 60 * 1000
);

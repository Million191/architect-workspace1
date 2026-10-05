import { BotProviderClient, ProviderBotState } from './types';

/**
 * A simulated notetaker for demo mode (--demo-providers) and UI tests. No network. Its status
 * follows the clock from the moment it should join: joining (0–3 s) → waiting room (3–6 s) →
 * recording (6 s on) → done once asked to leave, or 2 minutes into recording. The "recording" is a
 * short generated WAV, unique per bot, which the demo pipeline turns into its sample minutes.
 */
export function createDemoBotClient(opts: { now?: () => number; stepMs?: number } = {}): BotProviderClient {
  const now = opts.now ?? Date.now;
  const step = opts.stepMs ?? 3000;
  const bots = new Map<string, { startAt: number; leftAt?: number; cancelled?: boolean }>();
  let seq = 0;

  function state(id: string): ProviderBotState {
    const b = bots.get(id);
    if (!b) throw Object.assign(new Error('Unknown demo bot.'), { errorClass: 'ContractViolation' });
    const t = now();
    if (b.cancelled) return { code: 'done', subCode: 'bot_received_leave_call' };
    if (t < b.startAt) return b.leftAt ? { code: 'done' } : { code: 'ready' };
    const recordingFrom = b.startAt + 2 * step;
    const endedAt = b.leftAt ?? (t >= recordingFrom + 120_000 ? recordingFrom + 120_000 : undefined);
    if (endedAt !== undefined) {
      const recorded = endedAt >= recordingFrom;
      return recorded ? { code: 'done', audioUrl: `https://demo.invalid/audio/${id}` } : { code: 'done', subCode: 'bot_received_leave_call' };
    }
    if (t < b.startAt + step) return { code: 'joining_call' };
    if (t < recordingFrom) return { code: 'in_waiting_room' };
    return { code: 'in_call_recording' };
  }

  return {
    name: 'demo',
    async createBot(input) {
      const id = `demo-bot-${++seq}-${input.sessionId.slice(0, 8)}`;
      bots.set(id, { startAt: input.joinAt ? Math.max(now(), Date.parse(input.joinAt)) : now() });
      return { providerBotId: id };
    },
    async leaveCall(id) { const b = bots.get(id); if (b && !b.leftAt) b.leftAt = now(); },
    async cancelScheduled(id) { const b = bots.get(id); if (b) b.cancelled = true; },
    async getBot(id) { return state(id); },
    async deleteMedia() { /* nothing stored */ },
    async download(url) {
      const id = url.split('/').pop() ?? 'demo';
      return demoWav(id);
    },
  };
}

/** One second of a quiet tone as 16 kHz mono WAV, with the bot id appended so each file is unique. */
export function demoWav(salt: string): Buffer {
  const dataBytes = 32000;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  const samples = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(Math.round(Math.sin(i / 7) * 5000), i);
  return Buffer.concat([header, samples, Buffer.from(salt)]);
}

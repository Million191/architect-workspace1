/**
 * Live progress for in-flight uploads, so the page can say what the server is really doing
 * ("Transcribing recording…") instead of guessing from a timer. Keyed by a random id the page
 * generates per upload. In-memory only: progress is meaningless after a restart. Finished
 * entries are kept briefly so the page's last poll still sees the outcome, then dropped.
 */
export type ProgressPhase = 'uploading' | 'transcribing' | 'analyzing' | 'extracting' | 'done' | 'failed';

export interface UploadProgress {
  phase: ProgressPhase;
  /** The pipeline's own stage name, e.g. "speaker identification". */
  stage?: string;
  startedAt: string;
  updatedAt: string;
}

/** Pipeline stage name → the phase shown to the user. Unknown stages keep the current phase. */
const PHASE_BY_STAGE: Record<string, ProgressPhase> = {
  'audio ingestion': 'uploading',
  transcription: 'transcribing',
  'speaker identification': 'analyzing',
  'meeting summary': 'analyzing',
  'unclear-audio marking': 'analyzing',
  'discussion summary': 'analyzing',
  'decision extraction': 'extracting',
  'action item extraction': 'extracting',
  'minutes review gate': 'extracting',
};

const KEEP_FINISHED_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

export class UploadProgressTracker {
  private readonly entries = new Map<string, UploadProgress>();

  constructor(private readonly now: () => number = Date.now) {}

  start(uploadId: string): void {
    this.prune();
    const at = new Date(this.now()).toISOString();
    this.entries.set(uploadId, { phase: 'uploading', startedAt: at, updatedAt: at });
  }

  stage(uploadId: string, stage: string): void {
    const entry = this.entries.get(uploadId);
    if (!entry) return;
    this.entries.set(uploadId, { ...entry, stage, phase: PHASE_BY_STAGE[stage] ?? entry.phase, updatedAt: new Date(this.now()).toISOString() });
  }

  finish(uploadId: string, outcome: 'done' | 'failed'): void {
    const entry = this.entries.get(uploadId);
    if (entry) this.entries.set(uploadId, { ...entry, phase: outcome, updatedAt: new Date(this.now()).toISOString() });
  }

  get(uploadId: string): UploadProgress | undefined {
    return this.entries.get(uploadId);
  }

  /** Drops finished entries older than KEEP_FINISHED_MS, and caps the map so it can never grow without bound. */
  private prune(): void {
    const cutoff = this.now() - KEEP_FINISHED_MS;
    for (const [id, entry] of this.entries) {
      const finished = entry.phase === 'done' || entry.phase === 'failed';
      if ((finished && Date.parse(entry.updatedAt) < cutoff) || this.entries.size >= MAX_ENTRIES) this.entries.delete(id);
    }
  }
}

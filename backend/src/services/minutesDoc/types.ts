/**
 * Editable minutes: structured sections of limited rich text (sanitised HTML) plus action items,
 * kept with a full version history. The pipeline's `DraftMinutes` is derived from this on every
 * save (see toDraft.ts), so approval, emails, search, and the tracker keep working unchanged.
 */
export type SectionKind = 'topic' | 'summary' | 'decisions' | 'next_steps' | 'notes' | 'custom';

export interface MinutesSection {
  id: string;
  kind: SectionKind;
  title: string;
  /** Sanitised HTML (see html.ts for the allowed tags). */
  html: string;
  /** Where in the recording this section's discussion starts, when the AI linked it. */
  startMs?: number;
  /** The AI draft's text for this section (absent for sections the reviewer added). */
  aiTitle?: string;
  aiHtml?: string;
}

export type Priority = 'high' | 'medium' | 'low';

export interface MinutesActionItem {
  id: string;
  task: string;
  owner?: string;
  ownerEmail?: string;
  dueDate?: string;
  priority?: Priority;
  status: 'open' | 'done';
  sourceTimestampMs?: number;
  /** "Not an action item": a false item the AI drafted, kept (hidden) so it can be brought back. */
  dismissed?: boolean;
  /** What the AI drafted, so "Edited" can be shown and compared. Absent for items the reviewer added. */
  ai?: { task: string; owner?: string; dueDate?: string; priority?: Priority };
}

export interface MinutesContent {
  sections: MinutesSection[];
  actionItems: MinutesActionItem[];
}

export type VersionKind = 'ai_draft' | 'edit' | 'restore' | 'amendment' | 'transcript_correction';

export interface MinutesVersion {
  number: number;
  kind: VersionKind;
  content: MinutesContent;
  /** "AI" for the original draft, otherwise the reviewer's name. */
  author: string;
  createdAt: string;
  /** Last change folded into this version (autosaves within a few minutes by the same person collapse into one). */
  updatedAt: string;
  /** Required for edits made after approval. */
  reason?: string;
  /** Language the content is written in (BCP-47, e.g. "en"). */
  language: string;
  restoredFrom?: number;
}

export interface MinutesDocument {
  runId: string;
  language: string;
  /** Current content (always equal to the newest version's content). */
  content: MinutesContent;
  /** Increments on every saved change; used to detect someone else's newer save. */
  revision: number;
  updatedAt: string;
  updatedBy: string;
  versions: MinutesVersion[];
  /** Translations made from an older revision are out of date (filled by Part G when it exists). */
  translations?: Record<string, { fromRevision: number }>;
  /** Transcript as first produced, kept when corrections are made. */
  originalTranscript?: Array<{ startMs: number; endMs: number; speakerLabel: string; text: string }>;
  /** Set after edits that happened after approval and haven't been emailed yet. */
  pendingUpdateEmail?: { versionNumber: number; reason: string };
}

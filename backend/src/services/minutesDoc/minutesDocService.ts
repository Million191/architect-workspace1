import { MeetingPipeline } from '../meetingPipeline/meetingPipelineService';
import { PipelineRunView } from '../meetingPipeline/types';
import { contentFromDraft, draftFromContent, itemEdited, sectionEdited } from './convert';
import { sanitizeHtml } from './html';
import { MinutesActionItem, MinutesContent, MinutesDocument, MinutesSection, MinutesVersion, Priority, SectionKind, VersionKind } from './types';

export class MinutesError extends Error {
  constructor(readonly errorClass: 'MinutesConflict' | 'MinutesLocked' | 'MinutesValidationError' | 'VersionNotFound', message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

/** Autosaves by the same person within this window fold into one version instead of dozens. */
const COALESCE_MS = 5 * 60 * 1000;
const KINDS: SectionKind[] = ['topic', 'summary', 'decisions', 'next_steps', 'notes', 'custom'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const ID = /^[A-Za-z0-9-]{1,64}$/;

export type MinutesState = 'draft' | 'locked' | 'approved' | 'amending';

export interface MinutesView {
  runId: string;
  state: MinutesState;
  language: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  content: { sections: Array<MinutesSection & { edited: boolean }>; actionItems: Array<MinutesActionItem & { edited: boolean }> };
  approval?: { by: string; at: string; stage: 'minutes' | 'final' };
  amending?: { version: number; reason: string; by: string };
  pendingUpdateEmail?: { versionNumber: number; reason: string };
  outOfDateTranslations: string[];
  versionCount: number;
}

export interface MinutesDocDeps {
  store: Map<string, MinutesDocument & { amending?: { version: number; reason: string; by: string } }>;
  pipeline: MeetingPipeline;
  now?: () => Date;
}

type Doc = MinutesDocument & { amending?: { version: number; reason: string; by: string } };

export function createMinutesDocService(deps: MinutesDocDeps) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  function stateOf(run: PipelineRunView, doc: Doc): MinutesState {
    if (run.stage === 'minutes_pending_approval') return 'draft';
    if (run.stage === 'emails_pending_approval') return 'locked';
    return doc.amending ? 'amending' : 'approved';
  }

  /** The document for a run, created from the AI draft the first time it is opened. */
  function load(runId: string): { doc: Doc; run: PipelineRunView } {
    const run = deps.pipeline.getRun(runId);
    let doc = deps.store.get(runId);
    if (!doc) {
      const at = now();
      const content = contentFromDraft(run.minutes);
      doc = { runId, language: 'en', content, revision: 1, updatedAt: at, updatedBy: 'AI', versions: [{ number: 1, kind: 'ai_draft', content, author: 'AI', createdAt: at, updatedAt: at, language: 'en' }] };
      deps.store.set(runId, doc);
    }
    return { doc, run };
  }

  function view(doc: Doc, run: PipelineRunView): MinutesView {
    const state = stateOf(run, doc);
    const approval = run.finalApproval ? { by: run.finalApproval.approvedBy, at: run.finalApproval.approvedAt, stage: 'final' as const } : undefined;
    return {
      runId: doc.runId, state, language: doc.language, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy,
      content: { sections: doc.content.sections.map((s) => ({ ...s, edited: sectionEdited(s) })), actionItems: doc.content.actionItems.map((a) => ({ ...a, edited: itemEdited(a) })) },
      approval, amending: doc.amending, pendingUpdateEmail: doc.pendingUpdateEmail,
      outOfDateTranslations: Object.entries(doc.translations ?? {}).filter(([, t]) => t.fromRevision < doc.revision).map(([lang]) => lang),
      versionCount: doc.versions.length,
    };
  }

  /** Rebuilds what the page sent from known fields only; AI originals come from the stored document, never from the client. */
  function clean(input: MinutesContent, previous: MinutesContent): MinutesContent {
    if (!input || !Array.isArray(input.sections) || !Array.isArray(input.actionItems)) throw new MinutesError('MinutesValidationError', 'The minutes are missing sections or action items.');
    if (input.sections.length > 100 || input.actionItems.length > 300) throw new MinutesError('MinutesValidationError', 'Too many sections or action items.');
    const prevSections = new Map(previous.sections.map((s) => [s.id, s]));
    const prevItems = new Map(previous.actionItems.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const sections = input.sections.map((s) => {
      if (!s || !ID.test(String(s.id)) || seen.has(s.id)) throw new MinutesError('MinutesValidationError', 'A section has a missing or duplicate id.');
      seen.add(s.id);
      const was = prevSections.get(s.id);
      const html = sanitizeHtml(String(s.html ?? '').slice(0, 100000));
      if (html.length > 50000) throw new MinutesError('MinutesValidationError', `“${s.title}” is too long.`);
      return {
        id: s.id, kind: KINDS.includes(s.kind) ? s.kind : 'custom', title: String(s.title ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 200), html,
        startMs: Number.isInteger(s.startMs) && (s.startMs as number) >= 0 ? s.startMs : was?.startMs, aiTitle: was?.aiTitle, aiHtml: was?.aiHtml,
      } as MinutesSection;
    });
    const items = input.actionItems.map((a) => {
      if (!a || !ID.test(String(a.id)) || seen.has(a.id)) throw new MinutesError('MinutesValidationError', 'An action item has a missing or duplicate id.');
      seen.add(a.id);
      const was = prevItems.get(a.id);
      const due = typeof a.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate) ? a.dueDate : undefined;
      return {
        id: a.id, task: String(a.task ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 2000), owner: a.owner ? String(a.owner).replace(/[\r\n<>]/g, '').trim().slice(0, 200) || undefined : undefined,
        ownerEmail: typeof a.ownerEmail === 'string' && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(a.ownerEmail) ? a.ownerEmail : undefined,
        dueDate: due, priority: PRIORITIES.includes(a.priority as Priority) ? a.priority : undefined, status: a.status === 'done' ? 'done' : 'open',
        sourceTimestampMs: was ? was.sourceTimestampMs : Number.isInteger(a.sourceTimestampMs) ? a.sourceTimestampMs : undefined,
        dismissed: a.dismissed === true ? true : undefined, ai: was?.ai,
      } as MinutesActionItem;
    });
    return { sections, actionItems: items };
  }

  function pushVersion(doc: Doc, kind: VersionKind, content: MinutesContent, author: string, extra: Partial<MinutesVersion> = {}): void {
    const at = now(), last = doc.versions[doc.versions.length - 1];
    const fold = kind === 'edit' && last && (last.kind === 'edit' || (last.kind === 'amendment' && doc.amending?.version === last.number)) && last.author === author && Date.parse(at) - Date.parse(last.updatedAt) < COALESCE_MS;
    if (fold) doc.versions[doc.versions.length - 1] = { ...last, content, updatedAt: at };
    else doc.versions.push({ number: (last?.number ?? 0) + 1, kind, content, author, createdAt: at, updatedAt: at, language: doc.language, ...extra });
  }

  /** Writes new content: conflict check, lock check, version, and the pipeline draft/record kept in step. */
  function commit(runId: string, content: MinutesContent, opts: { baseRevision: number; by: string; kind: VersionKind; extra?: Partial<MinutesVersion> }): MinutesView {
    const { doc, run } = load(runId);
    if (opts.baseRevision !== doc.revision) {
      throw new MinutesError('MinutesConflict', `${doc.updatedBy} updated this draft. Reload to see their changes.`, { revision: doc.revision, updatedBy: doc.updatedBy, updatedAt: doc.updatedAt });
    }
    const state = stateOf(run, doc);
    if (state === 'locked') throw new MinutesError('MinutesLocked', 'The minutes are approved and the email is waiting for approval. Finish that step first.');
    if (state === 'approved') throw new MinutesError('MinutesLocked', 'These minutes are approved. Choose “Edit approved minutes” and give a reason to change them.');
    const next = clean(content, doc.content);
    if (JSON.stringify(next) === JSON.stringify(doc.content) && opts.kind === 'edit') return view(doc, run);
    const draft = draftFromContent(run.minutes, next);
    if (state === 'draft') deps.pipeline.replaceDraft(runId, draft, opts.by);
    else deps.pipeline.amendApprovedMinutes(runId, draft);
    doc.content = next;
    doc.revision += 1;
    doc.updatedAt = now();
    doc.updatedBy = opts.by;
    pushVersion(doc, opts.kind, next, opts.by, opts.extra);
    if (state === 'amending' && doc.amending) doc.pendingUpdateEmail = { versionNumber: doc.amending.version, reason: doc.amending.reason };
    deps.store.set(runId, doc);
    return view(doc, deps.pipeline.getRun(runId));
  }

  return {
    get(runId: string): MinutesView {
      const { doc, run } = load(runId);
      return view(doc, run);
    },

    save(runId: string, content: MinutesContent, baseRevision: number, by: string): MinutesView {
      return commit(runId, content, { baseRevision, by, kind: 'edit' });
    },

    versions(runId: string) {
      return load(runId).doc.versions.map(({ content: _c, ...v }) => v).reverse();
    },

    version(runId: string, number: number): MinutesVersion {
      const v = load(runId).doc.versions.find((x) => x.number === number);
      if (!v) throw new MinutesError('VersionNotFound', 'That version doesn’t exist.');
      return v;
    },

    /** "Restore this version": its content becomes a new version (nothing is ever deleted from history). */
    restore(runId: string, number: number, baseRevision: number, by: string): MinutesView {
      const v = load(runId).doc.versions.find((x) => x.number === number);
      if (!v) throw new MinutesError('VersionNotFound', 'That version doesn’t exist.');
      return commit(runId, v.content, { baseRevision, by, kind: 'restore', extra: { restoredFrom: number } });
    },

    /** "Edit approved minutes": needs a reason; opens a new version that later saves fold into. */
    startAmendment(runId: string, reason: string, by: string): MinutesView {
      const { doc, run } = load(runId);
      const state = stateOf(run, doc);
      if (state === 'amending') return view(doc, run);
      if (state !== 'approved') throw new MinutesError('MinutesLocked', state === 'draft' ? 'These minutes aren’t approved yet — just edit them.' : 'Finish approving the email first.');
      const why = reason.replace(/[\r\n]+/g, ' ').trim();
      if (why.length < 3) throw new MinutesError('MinutesValidationError', 'Say briefly why the approved minutes are being changed.');
      const at = now(), number = doc.versions[doc.versions.length - 1].number + 1;
      doc.versions.push({ number, kind: 'amendment', content: doc.content, author: by, createdAt: at, updatedAt: at, reason: why.slice(0, 500), language: doc.language });
      doc.amending = { version: number, reason: why.slice(0, 500), by };
      deps.store.set(runId, doc);
      return view(doc, run);
    },

    /** Done editing approved minutes: they are read-only again. */
    finishAmendment(runId: string): MinutesView {
      const { doc, run } = load(runId);
      delete doc.amending;
      deps.store.set(runId, doc);
      return view(doc, run);
    },

    /** Emails "Updated minutes" for the latest amendment, once (repeat calls never re-send). */
    async sendUpdate(runId: string, by: string) {
      const { doc } = load(runId);
      if (!doc.pendingUpdateEmail) throw new MinutesError('MinutesValidationError', 'There are no changes to send.');
      const result = await deps.pipeline.sendUpdatedMinutes(runId, doc.pendingUpdateEmail.versionNumber, doc.pendingUpdateEmail.reason, by);
      delete doc.pendingUpdateEmail;
      deps.store.set(runId, doc);
      return result;
    },

    /**
     * Fixes transcript words and speaker names. The first correction keeps the original transcript
     * on the document, and each correction is a line in the version history. The pipeline's
     * transcript is updated, so search and the meeting record show the corrected text.
     */
    correctTranscript(runId: string, input: { lines?: Array<{ index: number; text?: string; speakerLabel?: string }>; rename?: { from: string; to: string } }, by: string) {
      const { doc, run } = load(runId);
      const segments = run.transcript.map((s) => ({ ...s }));
      const name = (v: string) => v.replace(/[\r\n<>]/g, ' ').trim().slice(0, 200);
      let changed = 0;
      for (const l of input.lines ?? []) {
        const seg = segments[l.index];
        if (!seg) throw new MinutesError('MinutesValidationError', `There is no transcript line ${l.index + 1}.`);
        if (typeof l.text === 'string' && l.text.trim() !== seg.text) { seg.text = l.text.replace(/\s+/g, ' ').trim().slice(0, 2000); changed++; }
        if (typeof l.speakerLabel === 'string' && name(l.speakerLabel) && name(l.speakerLabel) !== seg.speakerLabel) { seg.speakerLabel = name(l.speakerLabel); changed++; }
      }
      let renamed = 0;
      if (input.rename && name(input.rename.to) && input.rename.from !== input.rename.to) {
        for (const seg of segments) if (seg.speakerLabel === input.rename.from) { seg.speakerLabel = name(input.rename.to); renamed++; }
      }
      if (!changed && !renamed) return { transcript: run.transcript, changed: 0 };
      if (!doc.originalTranscript) doc.originalTranscript = run.transcript.map((s) => ({ startMs: s.startMs, endMs: s.endMs, speakerLabel: s.speakerLabel, text: s.text }));
      deps.pipeline.correctTranscript(runId, segments);
      const at = now();
      const reason = renamed ? `Renamed ${input.rename!.from} to ${name(input.rename!.to)}${changed ? ` and corrected ${changed} line${changed === 1 ? '' : 's'}` : ''}` : `Corrected ${changed} transcript line${changed === 1 ? '' : 's'}`;
      doc.versions.push({ number: doc.versions[doc.versions.length - 1].number + 1, kind: 'transcript_correction', content: doc.content, author: by, createdAt: at, updatedAt: at, reason, language: doc.language });
      deps.store.set(runId, doc);
      return { transcript: segments, changed: changed + renamed, reason };
    },

    /** Internal: the stored document (used by transcript corrections and translations). */
    load,
    commit,
  };
}

export type MinutesDocService = ReturnType<typeof createMinutesDocService>;

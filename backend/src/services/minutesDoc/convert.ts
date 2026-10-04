import { randomUUID } from 'crypto';
import { DraftMinutes } from '../reviewGate/types';
import { ActionItem } from '../actionItemExtraction/types';
import { Decision } from '../decisionExtraction/types';
import { escapeHtml, htmlToText, listItems } from './html';
import { MinutesActionItem, MinutesContent, MinutesSection } from './types';

const id = () => randomUUID();

/** The AI draft as editable content: one section per discussion topic, a Decisions section, the action items. */
export function contentFromDraft(draft: DraftMinutes): MinutesContent {
  const sections: MinutesSection[] = draft.discussionTopics.map((t) => {
    const html = t.summary.trim() ? `<p>${escapeHtml(t.summary.trim())}</p>` : '';
    return { id: id(), kind: 'topic', title: t.topic, html, startMs: t.startMs, aiTitle: t.topic, aiHtml: html };
  });
  if (draft.decisions.length) {
    const html = `<ul>${draft.decisions.map((d) => `<li>${escapeHtml(d.decision)}${d.rationale ? ` — ${escapeHtml(d.rationale)}` : ''}${d.approver ? ` (decided by ${escapeHtml(d.approver)})` : ''}</li>`).join('')}</ul>`;
    sections.push({ id: id(), kind: 'decisions', title: 'Decisions', html, startMs: draft.decisions.find((d) => typeof d.timestampMs === 'number')?.timestampMs, aiTitle: 'Decisions', aiHtml: html });
  }
  const actionItems: MinutesActionItem[] = draft.actionItems.map((a) => ({
    id: id(), task: a.task, owner: a.owner, dueDate: a.dueDate, priority: a.priority, status: a.status === 'done' ? 'done' : 'open', sourceTimestampMs: a.sourceTimestampMs,
    ai: { task: a.task, owner: a.owner, dueDate: a.dueDate, priority: a.priority },
  }));
  return { sections, actionItems };
}

function decisionFlags(d: Omit<Decision, 'missingFields' | 'flaggedForReview'>): Decision {
  const missingFields = (['rationale', 'approver', 'timestampMs'] as const).filter((f) => d[f] === undefined);
  return { ...d, missingFields, flaggedForReview: missingFields.length > 0 };
}
function itemFlags(a: Omit<ActionItem, 'missingFields' | 'flaggedForReview'>): ActionItem {
  const missingFields = (['owner', 'dueDate', 'priority', 'status', 'sourceTimestampMs'] as const).filter((f) => a[f] === undefined);
  return { ...a, missingFields, flaggedForReview: missingFields.length > 0 };
}

/**
 * Edited content → the pipeline's `DraftMinutes`, keeping the meeting summary (title, date,
 * attendees) and transcript id from the draft. Decisions sections become decision items (one per
 * list item or line); every other section becomes a discussion topic with plain-text summary;
 * dismissed action items are left out.
 */
export function draftFromContent(base: DraftMinutes, content: MinutesContent): DraftMinutes {
  const topics = content.sections.filter((s) => s.kind !== 'decisions').map((s) => ({
    topic: s.title.trim() || 'Untitled section', summary: htmlToText(s.html), startMs: s.startMs ?? 0, endMs: s.startMs ?? 0, flaggedForReview: false, flagReasons: [] as string[],
  })).filter((t) => t.summary || t.topic !== 'Untitled section');
  const original = new Map(base.decisions.map((d) => [d.decision.toLowerCase(), d]));
  const decisions = content.sections.filter((s) => s.kind === 'decisions').flatMap((s) => listItems(s.html).map((text) => {
    const was = original.get(text.split(' — ')[0].replace(/^•\s*/, '').toLowerCase());
    return decisionFlags({ decision: text.replace(/^•\s*/, ''), timestampMs: was?.timestampMs ?? s.startMs });
  }));
  const actionItems = content.actionItems.filter((a) => !a.dismissed && a.task.trim()).map((a) => itemFlags({
    task: a.task.trim(), owner: a.owner?.trim() || undefined, dueDate: a.dueDate || undefined, priority: a.priority, status: a.status, sourceTimestampMs: a.sourceTimestampMs,
  }));
  return { ...base, discussionTopics: topics, decisions, actionItems };
}

/** True when a section differs from what the AI drafted (or was added by a person). */
export function sectionEdited(s: MinutesSection): boolean {
  return s.aiHtml === undefined || s.aiTitle !== s.title || htmlToText(s.aiHtml) !== htmlToText(s.html);
}
export function itemEdited(a: MinutesActionItem): boolean {
  return !a.ai || a.ai.task !== a.task || (a.ai.owner ?? '') !== (a.owner ?? '') || (a.ai.dueDate ?? '') !== (a.dueDate ?? '') || (a.ai.priority ?? '') !== (a.priority ?? '') || !!a.dismissed;
}

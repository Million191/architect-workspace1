/**
 * The only HTML the minutes may contain. Everything the page sends is rebuilt from this allowlist:
 * unknown tags are dropped (their text kept), attributes are dropped except a safe link href and
 * the editor's list type, and script/style contents are removed entirely. Nothing from the client
 * is ever stored or emailed as-is.
 */
const ALLOWED = new Set(['p', 'br', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ol', 'ul', 'li', 'a', 'blockquote']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', div: 'p' };
const VOID = new Set(['br']);

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}
function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Text between tags: keep entities, escape any stray angle brackets or bare ampersands. */
function escapeText(t: string): string {
  return t.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeHtml(input: string): string {
  const withoutBlocks = String(input ?? '').replace(/<(script|style|template|iframe|object|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  const open: string[] = [];
  // Only "<" followed by a letter or "/" starts a tag; a bare "5 < 6" stays text (escaped below).
  for (const part of withoutBlocks.split(/(<\/?[a-zA-Z][^>]*>)/)) {
    if (!part) continue;
    const tag = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(part);
    if (!tag) { out.push(escapeText(part)); continue; }
    const closing = !!tag[1];
    const name = RENAME[tag[2].toLowerCase()] ?? tag[2].toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(name)) { out.push('<br>'); continue; }
    let attrs = '';
    if (name === 'a') {
      const href = (attr(tag[3], 'href') ?? '').trim();
      if (!/^(https?:\/\/|mailto:)/i.test(href)) continue; // no javascript:, data:, or relative links
      attrs = ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"`;
    }
    if (name === 'li') {
      const list = attr(tag[3], 'data-list');
      if (list === 'bullet' || list === 'ordered') attrs = ` data-list="${list}"`;
    }
    out.push(`<${name}${attrs}>`);
    open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').replace(/<p><\/p>/g, '').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable plain text: block ends and list items become line breaks; entities decoded. */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|h3|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(text: string): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** List items (as plain text) of a section — how decisions are read back out of the editor. */
export function listItems(html: string): string[] {
  const items = [...String(html ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => htmlToText(m[1]));
  if (items.length) return items.filter(Boolean);
  return htmlToText(html).split('\n').map((l) => l.trim()).filter(Boolean);
}

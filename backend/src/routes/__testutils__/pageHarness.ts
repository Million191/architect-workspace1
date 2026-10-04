import { readFileSync } from 'fs';
import path from 'path';
import { Express } from 'express';
import request from 'supertest';
import { JSDOM } from 'jsdom';

/**
 * Loads the real review page (public/index.html + every script it lists, in order) into jsdom,
 * with the page's fetch() answered directly by an Express app — real routes, real pipeline, no
 * network. Multipart uploads (FormData with a File) are forwarded to the app as real multipart.
 */
const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');
const PAGE_HTML = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const SCRIPT_SRCS = Array.from(PAGE_HTML.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);

export interface Page {
  dom: JSDOM;
  doc: Document;
  /** Every request the page made, e.g. "POST /api/meetings/draft". */
  calls: string[];
  close(): void;
}

function readFileAsBuffer(win: JSDOM['window'], file: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function openPage(app: Express, pathAndQuery = '/', beforeScripts?: (win: JSDOM['window']) => void): Page {
  const html = SCRIPT_SRCS.reduce((h, src) => h.replace(`<script src="${src}"></script>`, ''), PAGE_HTML);
  const dom = new JSDOM(html, { url: `http://localhost:3000${pathAndQuery}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const calls: string[] = [];
  // After close(), requests never settle — so no callback runs against a torn-down window.
  let closed = false;
  const never = () => new Promise<never>(() => undefined);
  (win as unknown as { fetch: unknown }).fetch = async (url: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
    if (closed) return never();
    const method = (options.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    const agent = request(app);
    let req = method === 'POST' ? agent.post(url) : method === 'PUT' ? agent.put(url) : method === 'DELETE' ? agent.delete(url) : agent.get(url);
    if (options.body instanceof win.FormData) {
      for (const [key, value] of (options.body as unknown as Iterable<[string, string | File]>)) {
        if (typeof value === 'string') req = req.field(key, value);
        else req = req.attach(key, await readFileAsBuffer(win, value as unknown as Blob), (value as File).name);
      }
    } else if (options.body instanceof win.Blob) {
      // Raw binary bodies (recording chunks) are forwarded as bytes.
      req = req.set(options.headers ?? {}).set('Content-Type', options.headers?.['Content-Type'] ?? 'application/octet-stream');
      req = req.send(await readFileAsBuffer(win, options.body as unknown as Blob));
    } else {
      if (options.headers) req = req.set(options.headers);
      if (options.body) req = req.send(options.body as string);
    }
    const res = await req;
    if (closed) return never();
    return { ok: res.status < 400, status: res.status, json: () => (closed ? never() : Promise.resolve(res.body)) };
  };
  // XMLHttpRequest stand-in (the page uploads with XHR for real byte progress), answered by the same app.
  class FakeXHR {
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 0;
    responseText = '';
    private method = 'GET';
    private url = '';
    open(method: string, url: string) { this.method = method.toUpperCase(); this.url = url; }
    send(body: unknown) {
      calls.push(`${this.method} ${this.url}`);
      void (async () => {
        let req = this.method === 'POST' ? request(app).post(this.url) : request(app).get(this.url);
        let total = 0;
        if (body instanceof win.FormData) {
          for (const [key, value] of (body as unknown as Iterable<[string, string | File]>)) {
            if (typeof value === 'string') req = req.field(key, value);
            else { const buf = await readFileAsBuffer(win, value as unknown as Blob); total += buf.length; req = req.attach(key, buf, (value as File).name); }
          }
        }
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(total / 2), total });
        this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });
        try {
          const res = await req;
          if (closed) return;
          this.status = res.status;
          this.responseText = JSON.stringify(res.body);
          this.onload?.();
        } catch {
          this.onerror?.();
        }
      })();
    }
  }
  (win as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  (win as unknown as { confirm: () => boolean }).confirm = () => true;
  (win as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  // jsdom has no layout: Range has no geometry, which the rich-text editor asks for when scrolling to the caret.
  const rect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  const rangeProto = (win as unknown as { Range: { prototype: Record<string, unknown> } }).Range.prototype;
  if (!rangeProto.getBoundingClientRect) rangeProto.getBoundingClientRect = rect;
  if (!rangeProto.getClientRects) rangeProto.getClientRects = () => [];
  beforeScripts?.(win);
  // /vendor/quill/* is served by Express from node_modules (see server.ts); read it from there too.
  const fileFor = (src: string) => (src.startsWith('vendor/quill/') ? path.join(PUBLIC_DIR, '..', 'node_modules', 'quill', 'dist', src.slice('vendor/quill/'.length)) : path.join(PUBLIC_DIR, src));
  for (const src of SCRIPT_SRCS) win.eval(readFileSync(fileFor(src), 'utf8'));
  return { dom, doc: win.document, calls, close: () => { closed = true; win.close(); } };
}

export async function waitFor(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** Types into an input the way a user would (value + input event). */
export function type(page: Page, selector: string, value: string): void {
  const input = page.doc.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
}

/** Selects a file in the page's file input. */
export function chooseFile(page: Page, name: string, bytes: Buffer): void {
  const input = page.doc.getElementById('audio') as HTMLInputElement;
  const file = new page.dom.window.File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
}

export function text(page: Page, selector: string): string {
  return (page.doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function button(page: Page, label: string): HTMLButtonElement {
  const found = Array.from(page.doc.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`No button "${label}" on the page`);
  return found as HTMLButtonElement;
}

export function heading(page: Page): string {
  return text(page, '.page-title');
}

export function stepStates(page: Page): string[] {
  return Array.from(page.doc.querySelectorAll('#stepper .step')).map((li) =>
    li.classList.contains('is-current') ? 'current' : li.classList.contains('is-done') ? 'done' : 'upcoming'
  );
}

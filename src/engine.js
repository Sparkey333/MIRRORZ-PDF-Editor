// Thin wrapper around Mozilla pdf.js (pdfjs-dist v6): document loading with a
// shared worker, page rendering, text layer, text extraction for search, and
// outline access. The worker is bundled inline so the app runs fully offline.

// The "legacy" build supports a wider browser range than the modern build —
// important for an offline tool people keep around for years.
import {
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  TextLayer,
  AnnotationMode,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorkerCtor from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker&inline';

let sharedWorker = null;
function getWorker() {
  if (!sharedWorker) {
    try {
      sharedWorker = new PDFWorker({ port: new PdfWorkerCtor() });
    } catch {
      sharedWorker = null; // pdf.js falls back to a "fake worker" on the main thread
    }
  }
  return sharedWorker;
}

// cMaps / standard fonts: present in the hosted build (copied to /pdfjs/),
// absent in the single-file offline build — pdf.js degrades gracefully.
function assetOptions() {
  const base = document.baseURI || './';
  return {
    cMapUrl: new URL('pdfjs/cmaps/', base).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
  };
}

/**
 * Load a PDF document from bytes.
 * @param {Uint8Array} bytes
 * @param {(reason: 'need'|'wrong') => string|null} askPassword
 */
export async function loadPdf(bytes, askPassword) {
  const task = getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer to the worker; keep ours intact
    worker: getWorker(),
    ...assetOptions(),
    isEvalSupported: false,
  });
  task.onPassword = (updatePassword, reason) => {
    // reason 1 = need password, 2 = incorrect
    const pw = askPassword ? askPassword(reason === 2 ? 'wrong' : 'need') : null;
    if (pw === null) throw new Error('Password required');
    updatePassword(pw);
  };
  return task.promise;
}

/** Render one page into a canvas at the given scale/extra rotation. */
export async function renderPage(page, canvas, scale, extraRotation = 0) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + extraRotation) % 360 });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const renderTask = page.render({
    canvas: null,
    canvasContext: ctx,
    viewport,
    annotationMode: AnnotationMode.ENABLE,
  });
  await renderTask.promise;
  return viewport;
}

/** Render the text selection layer for a page. */
export async function renderTextLayer(page, container, viewport) {
  container.textContent = '';
  const layer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: false }),
    container,
    viewport,
  });
  await layer.render();
  return layer;
}

/**
 * Extract the text of a page along with per-item geometry, used for search.
 * Returns { text, items: [{str, start, x, y, w, h}] } in PDF user space (y-up).
 */
export async function extractPageText(page) {
  const content = await page.getTextContent();
  let text = '';
  const items = [];
  for (const item of content.items) {
    if (item.str === undefined) continue;
    const tx = item.transform;
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
    items.push({
      str: item.str,
      start: text.length,
      x: tx[4],
      y: tx[5],
      w: item.width || 0,
      h: fontHeight,
    });
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return { text, items };
}

/**
 * Find matches of `query` in extracted page text; returns rects in PDF user
 * space (y-up) covering each match (approximated per text item).
 */
/** Lowercase without changing string length (e.g. 'İ' lowercases to 2 chars,
 * which would misalign match offsets against item.start positions). */
function foldCase(s) {
  let out = '';
  for (const ch of s) {
    const low = ch.toLowerCase();
    out += low.length === ch.length ? low : ch;
  }
  return out;
}

export function findMatches(extracted, query) {
  // newlines separate items visually but not semantically — treat as spaces
  const q = foldCase(query).replace(/\n/g, ' ');
  if (!q) return [];
  const hay = foldCase(extracted.text).replace(/\n/g, ' ');
  const matches = [];
  let idx = 0;
  while ((idx = hay.indexOf(q, idx)) !== -1) {
    const end = idx + q.length;
    const rects = [];
    for (const item of extracted.items) {
      const iStart = item.start;
      const iEnd = item.start + item.str.length;
      if (iEnd <= idx || iStart >= end || item.str.length === 0) continue;
      const from = Math.max(idx, iStart) - iStart;
      const to = Math.min(end, iEnd) - iStart;
      const frac = (n) => (item.str.length ? n / item.str.length : 0);
      rects.push({
        x: item.x + item.w * frac(from),
        y: item.y - item.h * 0.2,
        w: item.w * frac(to - from),
        h: item.h * 1.2,
      });
    }
    if (rects.length) matches.push({ index: idx, rects });
    idx = end;
  }
  return matches;
}

/** Flatten the pdf.js outline tree into [{title, depth, dest}] */
export async function getOutline(pdf) {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline) return [];
  const out = [];
  const walk = (items, depth) => {
    for (const it of items || []) {
      out.push({ title: it.title, depth, dest: it.dest });
      walk(it.items, depth + 1);
    }
  };
  walk(outline, 0);
  return out;
}

/** Resolve an outline destination to a page index (0-based), or null. */
export async function resolveDest(pdf, dest) {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!explicit || !explicit[0]) return null;
    return await pdf.getPageIndex(explicit[0]);
  } catch {
    return null;
  }
}

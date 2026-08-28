// MIRRORZ PDF Editor — application controller.
// Wires the pdf.js engine, the annotation overlay, the pdf-lib export
// pipeline and all UI together. No server, no uploads: everything here runs
// in the browser, offline.

import './styles.css';
import { Store } from './store.js';
import { loadPdf, renderPage, renderTextLayer, extractPageText, findMatches, getOutline, resolveDest } from './engine.js';
import { fileToPdfBytes, importAnnotations, stripManagedAnnotations, listFormFields, exportPdf, FORM_KEY_SEP } from './pdfio.js';
import { pageMatrix, applyMatrix, invertMatrix, renderAnnotLayer, hitTest, movePatch, annotBounds, annotTypeLabel } from './overlay.js';
import { applyIcon } from './icons.js';
import { PRICING } from './pricing.js';
import { uid, clamp, normRect, downloadBlob, debounce, escapeHtml, formatBytes, withSuffix } from './utils.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const store = new Store();
const view = {
  scale: 1,
  zoomMode: 'fit-width',   // 'fit-width' | 'fit-page' | number
  currentIndex: 0,         // composition page index (0-based)
  tool: 'select',
  props: { color: '#ffd400', width: 2, opacity: 1, fontSize: 14 },
  selected: null,          // annotation id
  pending: null,           // {kind:'stamp'|'signature'|'image', ...} awaiting placement
  search: { query: '', results: [], current: -1 },
  textCache: new Map(),    // `${docId}:${srcIndex}` -> extracted text
  pageProxyCache: new Map(),
};

const els = {
  viewerWrap: $('#viewerWrap'),
  viewer: $('#viewer'),
  welcome: $('#welcome'),
  pageNum: $('#pageNum'),
  pageCount: $('#pageCount'),
  zoomSelect: $('#zoomSelect'),
  toast: $('#toast'),
};

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.className = isError ? 'error' : '';
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, isError ? 5000 : 2600);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('mirrorz-theme', theme); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------
// pdf.js page proxy access for composition entries
// ---------------------------------------------------------------------------

async function pageProxy(entry) {
  if (entry.docId === null) return null;
  const key = `${entry.docId}:${entry.srcIndex}`;
  if (!view.pageProxyCache.has(key)) {
    const src = store.sources.get(entry.docId);
    view.pageProxyCache.set(key, await src.pdf.getPage(entry.srcIndex + 1));
  }
  return view.pageProxyCache.get(key);
}

/** Base (scale 1) display dimensions of a composition entry incl. rotation. */
async function baseDims(entry) {
  if (entry.docId === null) {
    const { width = 612, height = 792 } = entry.blank || {};
    return entry.rotation % 180 === 0 ? { w: width, h: height } : { w: height, h: width };
  }
  const page = await pageProxy(entry);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rotation) % 360 });
  return { w: vp.width, h: vp.height };
}

/** Synthetic viewport for blank pages (mirrors pdf.js transform layout). */
function blankViewport(entry, scale) {
  const { width: w = 612, height: h = 792 } = entry.blank || {};
  const s = scale;
  const rot = ((entry.rotation % 360) + 360) % 360;
  let transform, W, H;
  if (rot === 90) { transform = [0, s, s, 0, 0, 0]; W = h * s; H = w * s; }
  else if (rot === 180) { transform = [-s, 0, 0, s, w * s, 0]; W = w * s; H = h * s; }
  else if (rot === 270) { transform = [0, -s, -s, 0, h * s, w * s]; W = h * s; H = w * s; }
  else { transform = [s, 0, 0, -s, 0, h * s]; W = w * s; H = h * s; }
  return { width: W, height: H, transform, rotation: rot, viewBox: [0, 0, w, h] };
}

function entryView(entry, proxy) {
  return entry.docId === null ? [0, 0, entry.blank?.width || 612, entry.blank?.height || 792] : proxy.view;
}

// ---------------------------------------------------------------------------
// Viewer rendering
// ---------------------------------------------------------------------------

let observer = null;
let rebuildGen = 0; // aborts a rebuild that a newer rebuild has superseded

async function computeScale() {
  if (typeof view.zoomMode === 'number') { view.scale = view.zoomMode; return; }
  if (!store.hasDocument) return;
  const margin = 44;
  const avail = els.viewerWrap.clientWidth - margin;
  const availH = els.viewerWrap.clientHeight - margin;
  let maxW = 0, maxH = 0;
  const probe = store.state.pages.slice(0, 25);
  for (const entry of probe) {
    const d = await baseDims(entry);
    maxW = Math.max(maxW, d.w); maxH = Math.max(maxH, d.h);
  }
  if (!maxW) return;
  view.scale = view.zoomMode === 'fit-page'
    ? clamp(Math.min(avail / maxW, availH / maxH), 0.1, 6)
    : clamp(avail / maxW, 0.1, 6);
}

async function rebuildViewer({ preserveScroll = true } = {}) {
  const gen = ++rebuildGen;
  closeInlineEditors(true);
  const wrap = els.viewerWrap;
  const ratio = wrap.scrollHeight > 0 ? wrap.scrollTop / wrap.scrollHeight : 0;
  observer?.disconnect();
  await computeScale();
  if (gen !== rebuildGen) return; // a newer rebuild took over
  els.viewer.textContent = '';
  if (!store.hasDocument) {
    els.viewer.hidden = true;
    els.welcome.hidden = false;
    els.pageCount.textContent = '/ 0';
    return;
  }
  els.welcome.hidden = true;
  els.viewer.hidden = false;
  els.pageCount.textContent = `/ ${store.state.pages.length}`;
  els.pageNum.max = store.state.pages.length;

  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderPageEl(e.target);
  }, { root: wrap, rootMargin: '600px 0px' });

  const frag = document.createDocumentFragment();
  const pageEls = [];
  for (const entry of store.state.pages) {
    const d = await baseDims(entry);
    if (gen !== rebuildGen) return;
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.pageId = entry.id;
    el.style.width = `${Math.floor(d.w * view.scale)}px`;
    el.style.height = `${Math.floor(d.h * view.scale)}px`;
    el.innerHTML = '<div class="loading">…</div>';
    frag.appendChild(el);
    pageEls.push(el);
  }
  if (gen !== rebuildGen) return;
  els.viewer.appendChild(frag);
  for (const el of pageEls) observer.observe(el);
  if (preserveScroll) wrap.scrollTop = ratio * wrap.scrollHeight;
  renderThumbs();
}

async function renderPageEl(el) {
  const entry = store.getPage(el.dataset.pageId);
  if (!entry) return;
  const token = `${view.scale}:${entry.rotation}`;
  if (el.dataset.rendered === token || el.dataset.rendering === token) return;
  el.dataset.rendering = token;
  try {
    let viewport;
    const canvas = document.createElement('canvas');
    canvas.className = 'pagecanvas';
    if (entry.docId === null) {
      viewport = blankViewport(entry, view.scale);
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const proxy = await pageProxy(entry);
      viewport = await renderPage(proxy, canvas, view.scale, entry.rotation);
    }
    const proxy = entry.docId === null ? null : await pageProxy(entry);
    const pv = entryView(entry, proxy);
    const matrix = pageMatrix(viewport, pv);

    el.textContent = '';
    el.style.width = `${Math.floor(viewport.width)}px`;
    el.style.height = `${Math.floor(viewport.height)}px`;
    el.style.setProperty('--scale-factor', view.scale);
    el.style.setProperty('--total-scale-factor', view.scale);
    el.appendChild(canvas);

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';
    el.appendChild(textDiv);
    if (proxy) {
      renderTextLayer(proxy, textDiv, viewport).catch(() => { /* non-fatal */ });
    }

    const searchLayer = document.createElement('div');
    searchLayer.className = 'searchLayer';
    el.appendChild(searchLayer);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('annotLayer');
    el.appendChild(svg);

    el._viewport = viewport;
    el._matrix = matrix;
    el._inv = invertMatrix(matrix);
    el._view = pv;
    el.dataset.rendered = token;
    updateAnnotLayer(entry.id);
    paintSearchHits(el);
  } catch (err) {
    console.error('render failed', err);
    el.innerHTML = '<div class="loading">Failed to render page</div>';
  } finally {
    delete el.dataset.rendering;
  }
}

function pageEl(pageId) {
  return els.viewer.querySelector(`.page[data-page-id="${pageId}"]`);
}

function updateAnnotLayer(pageId) {
  const el = pageEl(pageId);
  if (!el || !el._matrix) return;
  const svg = el.querySelector('svg.annotLayer');
  if (!svg) return;
  renderAnnotLayer(
    svg, store.annotationsForPage(pageId), el._matrix,
    parseInt(el.style.width, 10), parseInt(el.style.height, 10),
    view.selected,
  );
}

function refreshAllAnnotLayers() {
  for (const p of store.state.pages) updateAnnotLayer(p.id);
}

// ---------------------------------------------------------------------------
// Zoom & navigation
// ---------------------------------------------------------------------------

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

function setZoom(mode) {
  if (typeof mode === 'number') mode = clamp(mode, 0.1, 6);
  view.zoomMode = mode;
  els.zoomSelect.value = String(mode);
  rebuildViewer();
}

function zoomStep(dir) {
  const cur = view.scale;
  let next = cur;
  if (dir > 0) next = ZOOM_STEPS.find((z) => z > cur + 0.01) ?? cur * 1.25;
  else next = [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? cur / 1.25;
  setZoom(Math.round(next * 100) / 100);
}

function scrollToPage(index, { highlight = false } = {}) {
  const entry = store.state.pages[index];
  if (!entry) return;
  const el = pageEl(entry.id);
  if (el) {
    els.viewerWrap.scrollTop = el.offsetTop - 12;
    if (highlight) {
      el.style.outline = '3px solid var(--accent)';
      setTimeout(() => { el.style.outline = ''; }, 900);
    }
  }
}

function trackCurrentPage() {
  const wrap = els.viewerWrap;
  const top = wrap.scrollTop + 90;
  const pages = $$('#viewer .page');
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].offsetTop + pages[i].offsetHeight > top) {
      if (view.currentIndex !== i) {
        view.currentIndex = i;
        els.pageNum.value = i + 1;
        markCurrentThumb();
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar: thumbnails / outline / comments / forms
// ---------------------------------------------------------------------------

let thumbObserver = null;

function renderThumbs() {
  const panel = $('#panel-thumbs');
  panel.textContent = '';
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderThumbCanvas(e.target);
  }, { root: panel, rootMargin: '300px 0px' });
  store.state.pages.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.dataset.pageId = entry.id;
    div.innerHTML = `<canvas width="140" height="180"></canvas><div class="num">${i + 1}</div>`;
    div.addEventListener('click', () => scrollToPage(i));
    panel.appendChild(div);
    thumbObserver.observe(div);
  });
  markCurrentThumb();
}

async function renderThumbCanvas(div) {
  if (div.dataset.done) return;
  div.dataset.done = '1';
  const entry = store.getPage(div.dataset.pageId);
  if (!entry) return;
  const canvas = div.querySelector('canvas');
  const d = await baseDims(entry);
  const scale = 130 / d.w;
  if (entry.docId === null) {
    canvas.width = Math.floor(d.w * scale);
    canvas.height = Math.floor(d.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  try {
    const proxy = await pageProxy(entry);
    await renderPage(proxy, canvas, scale, entry.rotation);
  } catch { /* thumb best-effort */ }
}

function markCurrentThumb() {
  $$('#panel-thumbs .thumb').forEach((t, i) => {
    t.classList.toggle('current', i === view.currentIndex);
  });
}

async function renderOutline() {
  const panel = $('#panel-outline');
  panel.innerHTML = '<p class="empty">No outline in this document.</p>';
  const first = store.state.pages.find((p) => p.docId !== null);
  if (!first) return;
  const src = store.sources.get(first.docId);
  const items = await getOutline(src.pdf);
  if (!items.length) return;
  panel.textContent = '';
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'outline-item';
    div.style.paddingLeft = `${6 + item.depth * 14}px`;
    div.textContent = item.title || '(untitled)';
    div.addEventListener('click', async () => {
      const idx = await resolveDest(src.pdf, item.dest);
      if (idx === null) return;
      const compIdx = store.state.pages.findIndex(
        (p) => p.docId === first.docId && p.srcIndex === idx);
      if (compIdx >= 0) scrollToPage(compIdx, { highlight: true });
    });
    panel.appendChild(div);
  }
}

function renderComments() {
  const panel = $('#panel-comments');
  const annots = store.state.annotations;
  if (!annots.length) {
    panel.innerHTML = '<p class="empty">No comments yet.</p>';
    return;
  }
  panel.textContent = '';
  const order = new Map(store.state.pages.map((p, i) => [p.id, i]));
  const sorted = [...annots].sort((a, b) => (order.get(a.pageId) ?? 0) - (order.get(b.pageId) ?? 0));
  for (const a of sorted) {
    const idx = order.get(a.pageId);
    const div = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML =
      `<div class="c-head"><span><span class="c-swatch" style="background:${escapeHtml(a.color || '#ffd400')}"></span>` +
      `${annotTypeLabel(a)} · p.${(idx ?? 0) + 1}</span><button class="c-del" title="Delete">✕</button></div>` +
      `<div>${escapeHtml((a.text || '').slice(0, 160)) || '<span class="muted">(no text)</span>'}</div>`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('c-del')) {
        store.deleteAnnotation(a.id);
        return;
      }
      scrollToPage(idx ?? 0);
      view.selected = a.id;
      refreshAllAnnotLayers();
    });
    panel.appendChild(div);
  }
}

async function renderFormsPanel() {
  const panel = $('#panel-forms');
  panel.innerHTML = '<p class="empty">No form fields found.</p>';
  // only sources that still have pages in the composition — values for removed
  // sources would silently never reach a saved file
  const activeDocIds = new Set(store.state.pages.map((p) => p.docId).filter(Boolean));
  const fields = [];
  for (const docId of activeDocIds) {
    const src = store.sources.get(docId);
    if (!src) continue;
    const fs = await listFormFields(src.bytes);
    for (const f of fs) fields.push({ ...f, docId, srcName: src.name });
  }
  if (!fields.length) return;
  panel.textContent = '';
  const info = document.createElement('p');
  info.className = 'muted';
  info.textContent = 'Values are written into the PDF when you save. Use “Save flattened” to make them permanent.';
  panel.appendChild(info);
  const multiSource = activeDocIds.size > 1;
  for (const f of fields) {
    // scope each value to its source document so merged files with identical
    // field names don't clobber each other
    const key = `${f.docId}${FORM_KEY_SEP}${f.name}`;
    const div = document.createElement('div');
    div.className = 'form-field';
    const label = document.createElement('label');
    label.textContent = multiSource ? `${f.name} — ${f.srcName}` : f.name;
    div.appendChild(label);
    let input;
    if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!(store.formValues[key] ?? f.value);
      input.addEventListener('change', () => { store.formValues[key] = input.checked; store.dirty = true; });
    } else if (f.type === 'radio' || f.type === 'dropdown' || f.type === 'optionlist') {
      input = document.createElement('select');
      input.innerHTML = '<option value=""></option>' +
        (f.options || []).map((o) => `<option${(store.formValues[key] ?? f.value) === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
      input.addEventListener('change', () => { store.formValues[key] = input.value; store.dirty = true; });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = String(store.formValues[key] ?? f.value ?? '');
      input.addEventListener('input', () => { store.formValues[key] = input.value; store.dirty = true; });
    }
    div.appendChild(input);
    panel.appendChild(div);
  }
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'secondary';
  clearBtn.textContent = 'Clear values';
  clearBtn.addEventListener('click', () => { store.formValues = Object.create(null); renderFormsPanel(); });
  actions.appendChild(clearBtn);
  panel.appendChild(actions);
}

// ---------------------------------------------------------------------------
// Opening documents
// ---------------------------------------------------------------------------

function askPassword(reason) {
  return window.prompt(reason === 'wrong'
    ? 'Incorrect password. Try again:' : 'This PDF is password-protected. Password:');
}

async function openFiles(files, { append = false } = {}) {
  const list = [...files];
  if (!list.length) return;
  let first = !append || !store.hasDocument;
  let opened = 0;
  const failures = [];
  for (const file of list) {
    // one bad file must not abort the rest, and never leaves the UI desynced
    try {
      const { bytes, name } = await fileToPdfBytes(file);
      await addDocument(bytes, name, { fresh: first });
      first = false;
      opened += 1;
    } catch (err) {
      console.error(err);
      failures.push(`${file.name}: ${err.message}`);
    }
  }
  if (opened > 0) await afterCompositionChange({ fresh: !append });
  if (failures.length) toast(`Could not open ${failures.join('; ')}`, true);
  else if (list.length > 1) toast(`Merged ${list.length} files into one document`);
}

async function addDocument(bytes, name, { fresh }) {
  const originalBytes = bytes;
  let pdf = await loadPdf(bytes, askPassword);
  const docId = uid('d');
  const pageIds = Array.from({ length: pdf.numPages }, () => uid('p'));

  // Import existing markup annotations so they become editable, then strip
  // exactly those from the working bytes so they aren't rendered twice.
  let annots = [];
  try {
    annots = await importAnnotations(pdf, pageIds, bytes);
  } catch (e) { console.warn('annot import failed', e); }
  if (annots.length) {
    const refSet = new Set(annots.map((a) => a.srcRef).filter(Boolean));
    const cleaned = await stripManagedAnnotations(bytes, refSet);
    if (cleaned) {
      bytes = cleaned;
      const preStrip = pdf;
      pdf = await loadPdf(bytes, askPassword);
      preStrip.destroy?.().catch?.(() => {});
    } else {
      annots = []; // couldn't rewrite (encrypted?) — leave them baked in
    }
  }

  if (fresh) {
    // release the previous document's pdf.js resources (worker-side memory)
    for (const src of store.sources.values()) {
      try { src.pdf?.destroy?.(); } catch { /* already gone */ }
    }
    store.reset();
    view.textCache.clear();
    view.pageProxyCache.clear();
    view.selected = null;
    clearSearchResults();
    store.fileName = name;
  } else {
    store.pushUndo();
  }
  store.addSource(docId, bytes, name, pdf);
  pageIds.forEach((id, i) => {
    store.state.pages.push({ id, docId, srcIndex: i, rotation: 0 });
  });
  store.state.annotations.push(...annots);
  if (annots.length) toast(`Imported ${annots.length} existing annotation${annots.length > 1 ? 's' : ''} for editing`);
  // recents must keep the ORIGINAL bytes — the working copy has imported
  // annotations stripped out of it
  if (fresh) saveRecent(name, originalBytes);
}

async function afterCompositionChange({ fresh = false } = {}) {
  await rebuildViewer({ preserveScroll: !fresh });
  if (fresh) els.viewerWrap.scrollTop = 0;
  renderOutline();
  renderComments();
  renderFormsPanel();
  if (!$('#organizer').hidden) { orgSel.clear(); renderOrganizer(); }
  updateUndoButtons();
}

// ---------------------------------------------------------------------------
// Store subscriptions
// ---------------------------------------------------------------------------

store.subscribe((evt) => {
  if (evt.type === 'annots') {
    updateAnnotLayer(evt.pageId);
    renderComments();
  } else if (evt.type === 'pages' || evt.type === 'restore') {
    view.selected = null;
    clearSearchResults(); // page indices in results are stale now
    rebuildViewer();
    renderComments();
    if (!$('#organizer').hidden) renderOrganizer();
  }
  updateUndoButtons();
});

function clearSearchResults() {
  view.search = { query: '', results: [], current: -1 };
  $('#searchCount').textContent = '';
  $$('#viewer .searchLayer').forEach((l) => { l.textContent = ''; });
}

function updateUndoButtons() {
  $('#btnUndo').disabled = !store.canUndo;
  $('#btnRedo').disabled = !store.canRedo;
}

// ---------------------------------------------------------------------------
// Tools & pointer interactions
// ---------------------------------------------------------------------------

const DRAG_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'whiteout', 'ink']);
const MARKUP_TOOLS = new Set(['highlight', 'underline', 'strikeout']);
const PLACE_TOOLS = new Set(['signature', 'stamp', 'image']);

function setTool(tool) {
  if (!PLACE_TOOLS.has(tool)) view.pending = null;
  view.tool = tool;
  $$('#toolGroup .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  els.viewerWrap.dataset.tool = tool;
  els.viewerWrap.classList.toggle('hand-tool', tool === 'hand');
  $('#propFontSize').hidden = tool !== 'text';
  if (tool !== 'select') { view.selected = null; refreshAllAnnotLayers(); }
}

function pagePointFromEvent(evt) {
  const el = evt.target.closest?.('.page');
  if (!el || !el._inv) return null;
  const rect = el.getBoundingClientRect();
  const vx = evt.clientX - rect.left;
  const vy = evt.clientY - rect.top;
  const p = applyMatrix(el._inv, vx, vy);
  return { el, pageId: el.dataset.pageId, x: p.x, y: p.y };
}

let drag = null; // active drag session

els.viewerWrap.addEventListener('pointerdown', (evt) => {
  if (evt.button !== 0) return;
  closeInlineEditors();
  const tool = view.tool;

  if (tool === 'hand') {
    drag = { kind: 'pan', sx: evt.clientX, sy: evt.clientY, st: els.viewerWrap.scrollTop, sl: els.viewerWrap.scrollLeft };
    els.viewerWrap.classList.add('panning');
    els.viewerWrap.setPointerCapture(evt.pointerId);
    evt.preventDefault();
    return;
  }

  const pt = pagePointFromEvent(evt);
  if (!pt) return;

  if (tool === 'select') {
    // handle hit?
    const handle = evt.target.closest?.('.annot-handle');
    const annots = store.annotationsForPage(pt.pageId);
    if (handle && view.selected) {
      const a = annots.find((x) => x.id === view.selected);
      if (a) {
        // undo is pushed lazily on the first real movement, so a click that
        // never drags leaves history (and the redo stack) untouched
        drag = { kind: 'resize', handle: handle.dataset.handle, a, undoPushed: false };
        els.viewerWrap.setPointerCapture(evt.pointerId);
        evt.preventDefault();
        return;
      }
    }
    const tol = 4 / Math.max(view.scale, 0.2);
    const hit = hitTest(annots, pt.x, pt.y, tol);
    if (hit) {
      view.selected = hit.id;
      updateAnnotLayer(pt.pageId);
      refreshOtherLayers(pt.pageId);
      drag = { kind: 'move', a: hit, pageId: pt.pageId, lx: pt.x, ly: pt.y, undoPushed: false };
      els.viewerWrap.setPointerCapture(evt.pointerId);
      evt.preventDefault();
    } else if (view.selected) {
      view.selected = null;
      refreshAllAnnotLayers();
    }
    return;
  }

  if (tool === 'note') {
    const a = store.addAnnotation({
      pageId: pt.pageId, type: 'note', x: pt.x - 11, y: pt.y - 10,
      color: view.props.color, opacity: 1, text: '',
    });
    openNoteEditor(a, pt.el, { isNew: true });
    return;
  }

  if (tool === 'text') {
    const fs = view.props.fontSize;
    const a = store.addAnnotation({
      pageId: pt.pageId, type: 'freetext',
      rect: { x: pt.x, y: pt.y, w: 180, h: fs * 1.6 },
      color: view.props.color === '#ffd400' ? '#d63031' : view.props.color,
      opacity: 1, text: '', fontSize: fs,
    });
    openFreetextEditor(a, pt.el, { isNew: true });
    return;
  }

  if (PLACE_TOOLS.has(tool)) {
    placePending(pt);
    return;
  }

  if (DRAG_TOOLS.has(tool)) {
    drag = {
      kind: tool === 'ink' ? 'ink' : 'shape',
      tool, pageId: pt.pageId, el: pt.el,
      x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y,
      points: [{ x: pt.x, y: pt.y }],
    };
    els.viewerWrap.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  }
});

els.viewerWrap.addEventListener('pointermove', (evt) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    els.viewerWrap.scrollTop = drag.st - (evt.clientY - drag.sy);
    els.viewerWrap.scrollLeft = drag.sl - (evt.clientX - drag.sx);
    return;
  }
  if (drag.kind === 'move' || drag.kind === 'resize') {
    const el = pageEl(drag.kind === 'move' ? drag.pageId : drag.a.pageId);
    if (!el || !el._inv) return;
    const rect = el.getBoundingClientRect();
    const p = applyMatrix(el._inv, evt.clientX - rect.left, evt.clientY - rect.top);
    if (drag.kind === 'move') {
      const dx = p.x - drag.lx, dy = p.y - drag.ly;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) {
        if (!drag.undoPushed) { store.pushUndo(); drag.undoPushed = true; }
        store.updateAnnotation(drag.a.id, movePatch(drag.a, dx, dy), { skipUndo: true });
        drag.lx = p.x; drag.ly = p.y;
      }
    } else {
      if (!drag.undoPushed) { store.pushUndo(); drag.undoPushed = true; }
      applyResize(drag, p);
    }
    return;
  }
  // shape / ink creation
  const el = pageEl(drag.pageId);
  if (!el || !el._inv) return;
  const rect = el.getBoundingClientRect();
  const p = applyMatrix(el._inv, evt.clientX - rect.left, evt.clientY - rect.top);
  drag.x1 = p.x; drag.y1 = p.y;
  if (drag.kind === 'ink') {
    const last = drag.points[drag.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.6 / view.scale) drag.points.push({ x: p.x, y: p.y });
  }
  drawDragPreview();
});

els.viewerWrap.addEventListener('pointerup', (evt) => {
  if (!drag) {
    if (MARKUP_TOOLS.has(view.tool)) setTimeout(applyTextMarkup, 0);
    return;
  }
  const d = drag;
  drag = null;
  els.viewerWrap.classList.remove('panning');
  clearDragPreview();
  if (d.kind === 'pan') return;
  if (d.kind === 'move' || d.kind === 'resize') return; // undo handled lazily

  if (d.kind === 'ink') {
    if (d.points.length > 1) {
      store.addAnnotation({
        pageId: d.pageId, type: 'ink', strokes: [d.points],
        color: view.props.color, opacity: view.props.opacity,
        strokeWidth: view.props.width,
      });
    }
    return;
  }
  // shapes
  const r = normRect(d.x0, d.y0, d.x1, d.y1);
  const minSize = 3 / Math.max(view.scale, 0.2);
  if (d.tool === 'line' || d.tool === 'arrow') {
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < minSize) return;
    store.addAnnotation({
      pageId: d.pageId, type: d.tool, x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1,
      color: view.props.color, opacity: view.props.opacity, strokeWidth: view.props.width,
    });
  } else {
    if (r.w < minSize && r.h < minSize) return;
    store.addAnnotation({
      pageId: d.pageId, type: d.tool === 'whiteout' ? 'whiteout' : d.tool,
      rect: r,
      color: d.tool === 'whiteout' ? '#ffffff' : view.props.color,
      opacity: d.tool === 'whiteout' ? 1 : view.props.opacity,
      strokeWidth: view.props.width,
    });
  }
});

// A cancelled pointer (browser gesture takeover, tab switch mid-drag) must not
// leave the drag session dangling — otherwise annotations chase the pointer.
els.viewerWrap.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag = null;
  els.viewerWrap.classList.remove('panning');
  clearDragPreview();
});

function applyResize(d, p) {
  const a = d.a;
  if (d.handle === 'p1' || d.handle === 'p2') {
    const patch = d.handle === 'p1' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y };
    store.updateAnnotation(a.id, patch, { skipUndo: true });
    return;
  }
  // 'se' corner on rect-based annotations
  if (a.rect) {
    const rect = {
      x: a.rect.x, y: a.rect.y,
      w: Math.max(6, p.x - a.rect.x), h: Math.max(6, p.y - a.rect.y),
    };
    store.updateAnnotation(a.id, { rect }, { skipUndo: true });
  }
}

function refreshOtherLayers(exceptPageId) {
  for (const pg of store.state.pages) {
    if (pg.id !== exceptPageId) updateAnnotLayer(pg.id);
  }
}

// live preview for drag-created shapes
function drawDragPreview() {
  if (!drag || (drag.kind !== 'shape' && drag.kind !== 'ink')) return;
  const el = pageEl(drag.pageId);
  const svg = el?.querySelector('svg.annotLayer');
  const root = svg?.firstChild;
  if (!root) return;
  clearDragPreview();
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.id = 'drag-preview';
  const { color, width, opacity } = view.props;
  const mk = (name, attrs) => {
    const n = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  if (drag.kind === 'ink') {
    g.appendChild(mk('path', {
      d: drag.points.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' '),
      fill: 'none', stroke: color, 'stroke-width': width,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity,
    }));
  } else {
    const r = normRect(drag.x0, drag.y0, drag.x1, drag.y1);
    switch (drag.tool) {
      case 'rect':
        g.appendChild(mk('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: color, 'stroke-width': width, opacity }));
        break;
      case 'whiteout':
        g.appendChild(mk('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: '#fff', stroke: 'rgba(0,0,0,0.2)', 'stroke-width': 0.5 }));
        break;
      case 'ellipse':
        g.appendChild(mk('ellipse', { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2, fill: 'none', stroke: color, 'stroke-width': width, opacity }));
        break;
      case 'line':
      case 'arrow':
        g.appendChild(mk('line', { x1: drag.x0, y1: drag.y0, x2: drag.x1, y2: drag.y1, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', opacity }));
        break;
      default: break;
    }
  }
  root.appendChild(g);
  drag.previewOn = drag.pageId;
}

function clearDragPreview() {
  document.getElementById('drag-preview')?.remove();
}

// ---------------------------------------------------------------------------
// Text markup from browser selection (highlight / underline / strikeout)
// ---------------------------------------------------------------------------

function applyTextMarkup() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  // geometric page lookup — elementFromPoint would drop any selection line
  // scrolled outside the visible viewport
  const pages = $$('#viewer .page').filter((el) => el._inv);
  const pageAt = (cx, cy) => pages.find((el) => {
    const r = el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  });
  const perPage = new Map(); // pageId -> quads
  for (let r = 0; r < sel.rangeCount; r++) {
    const rects = sel.getRangeAt(r).getClientRects();
    for (const rect of rects) {
      if (rect.width < 1 || rect.height < 2) continue;
      const page = pageAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!page) continue;
      const pr = page.getBoundingClientRect();
      const p1 = applyMatrix(page._inv, rect.left - pr.left, rect.top - pr.top);
      const p2 = applyMatrix(page._inv, rect.right - pr.left, rect.bottom - pr.top);
      const q = normRect(p1.x, p1.y, p2.x, p2.y);
      // filter whole-block artifacts relative to the page, not a fixed 60pt —
      // a 72pt headline is a perfectly highlightable line
      const pageH = page._view ? page._view[3] - page._view[1] : 792;
      if (q.h > pageH * 0.5 || q.w < 0.5) continue;
      const list = perPage.get(page.dataset.pageId) || [];
      // skip near-duplicates (nested span rects)
      if (!list.some((e) => Math.abs(e.x - q.x) < 1 && Math.abs(e.y - q.y) < 1 && Math.abs(e.w - q.w) < 2)) {
        list.push(q);
      }
      perPage.set(page.dataset.pageId, list);
    }
  }
  if (!perPage.size) return;
  const text = sel.toString().slice(0, 500);
  for (const [pageId, quads] of perPage) {
    store.addAnnotation({
      pageId, type: view.tool, quads,
      color: view.props.color,
      opacity: view.tool === 'highlight' ? (view.props.opacity < 1 ? view.props.opacity : 0.45) : 1,
      text: '',
      markupText: text,
    });
  }
  sel.removeAllRanges();
}

// ---------------------------------------------------------------------------
// Inline editors (freetext & note)
// ---------------------------------------------------------------------------

let inlineEditor = null;

function closeInlineEditors(commit = true) {
  if (inlineEditor) {
    const e = inlineEditor;
    inlineEditor = null;
    e.commit(commit);
  }
}

function openFreetextEditor(a, el, { isNew = false } = {}) {
  closeInlineEditors();
  const m = el._matrix;
  const scale = Math.hypot(m.a, m.b) || 1;
  const rotation = el._viewport?.rotation || 0;
  const p = applyMatrix(m, a.rect.x, a.rect.y);
  const ta = document.createElement('textarea');
  ta.className = 'freetext-edit';
  ta.value = a.text || '';
  ta.style.left = `${p.x}px`;
  ta.style.top = `${p.y}px`;
  // on rotated pages the box must rotate with the page around its anchor
  if (rotation % 360 !== 0) {
    ta.style.transformOrigin = '0 0';
    ta.style.transform = `rotate(${rotation}deg)`;
  }
  ta.style.width = `${Math.max(60, a.rect.w * scale)}px`;
  ta.style.height = `${Math.max(24, a.rect.h * scale)}px`;
  ta.style.fontSize = `${(a.fontSize || 14) * scale}px`;
  ta.style.color = a.color;
  el.appendChild(ta);
  ta.focus();
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(24, ta.scrollHeight)}px`;
  };
  ta.addEventListener('input', grow);
  grow();
  const commit = (doCommit) => {
    const text = ta.value;
    const hPx = parseFloat(ta.style.height);
    const wPx = parseFloat(ta.style.width);
    ta.remove();
    if (!doCommit || !text.trim()) {
      if (isNew) {
        // brand-new empty box: remove it and the undo entry its creation pushed
        store.removeAnnotationSilently(a.id);
        store.popUndo();
      } else if (!text.trim()) {
        store.deleteAnnotation(a.id); // deliberate clearing of an existing box
      }
      return;
    }
    const patch = { text, rect: { ...a.rect, w: wPx / scale, h: hPx / scale } };
    // a new annotation's creation already holds the undo entry; edits to an
    // existing one get their own
    store.updateAnnotation(a.id, patch, { skipUndo: isNew || text === (a.text || '') });
  };
  inlineEditor = { commit };
  ta.addEventListener('blur', () => closeInlineEditors(true));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeInlineEditors(true);
  });
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function openNoteEditor(a, el, { isNew = false } = {}) {
  closeInlineEditors();
  const m = el._matrix;
  const p = applyMatrix(m, a.x + 24, a.y);
  const box = document.createElement('div');
  box.className = 'freetext-edit';
  box.style.left = `${p.x}px`;
  box.style.top = `${p.y}px`;
  box.style.background = 'var(--bg-3)';
  box.style.border = '1px solid var(--border)';
  box.style.borderRadius = '8px';
  box.style.padding = '8px';
  box.style.minWidth = '220px';
  box.innerHTML = '<textarea rows="4" style="width:100%;background:var(--bg-2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:6px;"></textarea>';
  const ta = box.querySelector('textarea');
  ta.value = a.text || '';
  el.appendChild(box);
  ta.focus();
  const commit = (doCommit) => {
    const text = ta.value;
    box.remove();
    if (!doCommit) return;
    if (!text.trim() && isNew) {
      store.removeAnnotationSilently(a.id);
      store.popUndo();
    } else if (text !== (a.text || '')) {
      store.updateAnnotation(a.id, { text }, { skipUndo: isNew });
    }
  };
  inlineEditor = { commit };
  ta.addEventListener('blur', () => closeInlineEditors(true));
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
}

els.viewerWrap.addEventListener('dblclick', (evt) => {
  if (view.tool !== 'select') return;
  const pt = pagePointFromEvent(evt);
  if (!pt) return;
  const hit = hitTest(store.annotationsForPage(pt.pageId), pt.x, pt.y, 4 / Math.max(view.scale, 0.2));
  if (!hit) return;
  if (hit.type === 'freetext') openFreetextEditor(hit, pt.el);
  else if (hit.type === 'note') openNoteEditor(hit, pt.el);
});

// ---------------------------------------------------------------------------
// Placement tools: signature, stamp, image
// ---------------------------------------------------------------------------

const STAMPS = [
  { label: 'APPROVED', color: '#2e7d32' },
  { label: 'REJECTED', color: '#c62828' },
  { label: 'DRAFT', color: '#1565c0' },
  { label: 'CONFIDENTIAL', color: '#c62828' },
  { label: 'REVIEWED', color: '#6a1b9a' },
  { label: 'SIGN HERE', color: '#e65100' },
  { label: 'COMPLETED', color: '#2e7d32' },
  { label: 'VOID', color: '#37474f' },
  { label: 'FINAL', color: '#1565c0' },
];

function placePending(pt) {
  const p = view.pending;
  if (!p) {
    if (view.tool === 'signature') openSignatureDialog();
    else if (view.tool === 'stamp') openStampDialog();
    else if (view.tool === 'image') $('#imageInput').click();
    return;
  }
  if (p.kind === 'image') {
    const maxW = 300;
    const scale = Math.min(1, maxW / p.w);
    const w = p.w * scale, h = p.h * scale;
    store.addAnnotation({
      pageId: pt.pageId, type: 'stamp',
      rect: { x: pt.x - w / 2, y: pt.y - h / 2, w, h },
      imageData: p.dataUrl, opacity: 1, color: '#000000',
    });
  } else if (p.kind === 'label') {
    const w = Math.max(90, p.label.length * 13), h = 34;
    store.addAnnotation({
      pageId: pt.pageId, type: 'stamp',
      rect: { x: pt.x - w / 2, y: pt.y - h / 2, w, h },
      label: p.label, color: p.color, opacity: 1,
    });
  }
  // keep pending for repeated placement; Esc or tool switch clears it
}

// -------- signature dialog --------

const sigState = { drawing: false, drew: false, mode: 'draw' };

function initSignatureDialog() {
  const canvas = $('#sigCanvas');
  const ctx = canvas.getContext('2d');
  const reset = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sigState.drew = false;
  };
  reset();
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    sigState.drawing = true;
    sigState.drew = true;
    const p = pos(e);
    ctx.strokeStyle = $('#sigColor').value;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!sigState.drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { sigState.drawing = false; });
  $('#sigClear').addEventListener('click', reset);
  $('#sigTabDraw').addEventListener('click', () => setSigMode('draw'));
  $('#sigTabType').addEventListener('click', () => setSigMode('type'));
  $('#sigTypeInput').addEventListener('input', () => {
    $('#sigTypePreview').textContent = $('#sigTypeInput').value;
    $('#sigTypePreview').style.color = $('#sigColor').value;
  });
  $('#sigColor').addEventListener('input', () => {
    $('#sigTypePreview').style.color = $('#sigColor').value;
  });
  $('#sigCancel').addEventListener('click', () => $('#dlgSignature').close());
  $('#sigOk').addEventListener('click', () => {
    const dataUrl = signatureDataUrl();
    if (!dataUrl) { toast('Draw or type a signature first', true); return; }
    const img = new Image();
    img.onload = () => {
      view.pending = { kind: 'image', dataUrl, w: img.width / 2.5, h: img.height / 2.5 };
      toast('Click on the page to place your signature');
    };
    img.src = dataUrl;
    $('#dlgSignature').close();
  });
}

function setSigMode(mode) {
  sigState.mode = mode;
  $('#sigTabDraw').classList.toggle('active', mode === 'draw');
  $('#sigTabType').classList.toggle('active', mode === 'type');
  $('#sigDrawPane').hidden = mode !== 'draw';
  $('#sigTypePane').hidden = mode !== 'type';
}

function signatureDataUrl() {
  if (sigState.mode === 'draw') {
    if (!sigState.drew) return null;
    return trimmedCanvasDataUrl($('#sigCanvas'));
  }
  const text = $('#sigTypeInput').value.trim();
  if (!text) return null;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '64px "Segoe Script", "Brush Script MT", cursive';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w; c.height = 110;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = '#ffffff';
  ctx2.fillRect(0, 0, c.width, c.height);
  ctx2.font = font;
  ctx2.fillStyle = $('#sigColor').value;
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 20, 58);
  return c.toDataURL('image/png');
}

/** Crop the white margins off the signature canvas. */
function trimmedCanvasDataUrl(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas.toDataURL('image/png');
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX; out.height = maxY - minY;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function openSignatureDialog() { $('#dlgSignature').showModal(); }

function openStampDialog() {
  const grid = $('#stampGrid');
  if (!grid.children.length) {
    for (const s of STAMPS) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.style.color = s.color;
      b.addEventListener('click', () => {
        view.pending = { kind: 'label', label: s.label, color: s.color };
        $('#dlgStamp').close();
        toast('Click on the page to place the stamp');
      });
      grid.appendChild(b);
    }
  }
  $('#dlgStamp').showModal();
}

$('#stampCancel').addEventListener('click', () => $('#dlgStamp').close());

$('#imageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('could not read image'));
      fr.readAsDataURL(file);
    });
    const img = await loadImage(dataUrl);
    // pdf-lib can only embed PNG/JPEG — re-encode anything else (WebP…) now,
    // otherwise the image would silently vanish from the saved file
    let finalUrl = dataUrl;
    if (!/^data:image\/(png|jpeg)/.test(dataUrl)) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      finalUrl = c.toDataURL('image/png');
    }
    view.pending = { kind: 'image', dataUrl: finalUrl, w: img.naturalWidth, h: img.naturalHeight };
    toast('Click on the page to place the image');
  } catch (err) {
    toast(`Could not load image: ${err.message}`, true);
  }
});

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('unsupported or corrupt image'));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function extractedFor(entry) {
  if (entry.docId === null) return { text: '', items: [] };
  const key = `${entry.docId}:${entry.srcIndex}`;
  if (!view.textCache.has(key)) {
    const proxy = await pageProxy(entry);
    view.textCache.set(key, await extractPageText(proxy));
  }
  return view.textCache.get(key);
}

let searchGen = 0; // discard results of a superseded query mid-flight

const runSearch = debounce(async () => {
  const gen = ++searchGen;
  const q = $('#searchInput').value.trim();
  const results = [];
  if (q.length >= 2) {
    for (let i = 0; i < store.state.pages.length; i++) {
      const entry = store.state.pages[i];
      const ext = await extractedFor(entry);
      if (gen !== searchGen) return; // a newer query took over
      const matches = findMatches(ext, q);
      for (const m of matches) results.push({ pageIndex: i, pageId: entry.id, rects: m.rects });
    }
  }
  if (gen !== searchGen) return;
  view.search.query = q;
  view.search.results = results;
  view.search.current = -1;
  if (results.length) gotoMatch(0);
  else {
    $('#searchCount').textContent = q.length >= 2 ? '0 results' : '';
    $$('#viewer .searchLayer').forEach((l) => { l.textContent = ''; });
  }
}, 250);

function gotoMatch(idx) {
  const res = view.search.results;
  if (!res.length) return;
  view.search.current = ((idx % res.length) + res.length) % res.length;
  const cur = res[view.search.current];
  $('#searchCount').textContent = `${view.search.current + 1} / ${res.length}`;
  scrollToPage(cur.pageIndex);
  $$('#viewer .page').forEach((el) => paintSearchHits(el));
}

function paintSearchHits(el) {
  const layer = el.querySelector('.searchLayer');
  if (!layer || !el._matrix) return;
  layer.textContent = '';
  const pageId = el.dataset.pageId;
  const vw = el._view;
  view.search.results.forEach((r, i) => {
    if (r.pageId !== pageId) return;
    for (const rect of r.rects) {
      // user space (y-up) -> page space -> CSS bbox
      const psX = rect.x - vw[0];
      const psY = vw[3] - (rect.y + rect.h);
      const corners = [
        applyMatrix(el._matrix, psX, psY),
        applyMatrix(el._matrix, psX + rect.w, psY),
        applyMatrix(el._matrix, psX, psY + rect.h),
        applyMatrix(el._matrix, psX + rect.w, psY + rect.h),
      ];
      const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
      const div = document.createElement('div');
      div.className = 'search-hit' + (i === view.search.current ? ' current' : '');
      div.style.left = `${Math.min(...xs)}px`;
      div.style.top = `${Math.min(...ys)}px`;
      div.style.width = `${Math.max(...xs) - Math.min(...xs)}px`;
      div.style.height = `${Math.max(...ys) - Math.min(...ys)}px`;
      layer.appendChild(div);
    }
  });
}

function toggleSearch(show) {
  const bar = $('#searchbar');
  bar.hidden = show === undefined ? !bar.hidden : !show;
  if (!bar.hidden) $('#searchInput').focus();
  else clearSearchResults();
}

// ---------------------------------------------------------------------------
// Organizer
// ---------------------------------------------------------------------------

const orgSel = new Set();
let orgObserver = null;

function toggleOrganizer(show) {
  const org = $('#organizer');
  org.hidden = show === undefined ? !org.hidden : !show;
  if (!org.hidden) { orgSel.clear(); renderOrganizer(); }
}

function renderOrganizer() {
  const grid = $('#orgGrid');
  grid.textContent = '';
  orgObserver?.disconnect();
  orgObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) renderOrgThumb(e.target);
  }, { root: grid, rootMargin: '250px 0px' });
  store.state.pages.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'org-page' + (orgSel.has(entry.id) ? ' selected' : '');
    div.dataset.pageId = entry.id;
    div.draggable = true;
    div.innerHTML = `<canvas width="150" height="194"></canvas><div class="num">${i + 1}</div>`;
    div.addEventListener('click', (e) => {
      if (e.shiftKey && orgSel.size) {
        const ids = store.state.pages.map((p) => p.id);
        const last = [...orgSel].pop();
        const a = ids.indexOf(last), b = ids.indexOf(entry.id);
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) orgSel.add(ids[k]);
      } else if (e.ctrlKey || e.metaKey) {
        orgSel.has(entry.id) ? orgSel.delete(entry.id) : orgSel.add(entry.id);
      } else {
        orgSel.clear();
        orgSel.add(entry.id);
      }
      $$('#orgGrid .org-page').forEach((n) =>
        n.classList.toggle('selected', orgSel.has(n.dataset.pageId)));
    });
    div.addEventListener('dragstart', (e) => {
      if (!orgSel.has(entry.id)) { orgSel.clear(); orgSel.add(entry.id); }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'mirrorz-pages');
    });
    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = div.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      div.classList.toggle('drag-over-before', before);
      div.classList.toggle('drag-over-after', !before);
    });
    div.addEventListener('dragleave', () => {
      div.classList.remove('drag-over-before', 'drag-over-after');
    });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      const before = div.classList.contains('drag-over-before');
      div.classList.remove('drag-over-before', 'drag-over-after');
      // ignore drags that didn't start from our own page grid (files, text…)
      if (e.dataTransfer.getData('text/plain') !== 'mirrorz-pages') return;
      const ids = [...orgSel];
      const rest = store.state.pages.filter((p) => !ids.includes(p.id));
      let target = rest.findIndex((p) => p.id === entry.id);
      if (target === -1) return;
      if (!before) target += 1;
      store.movePages(ids, target);
    });
    grid.appendChild(div);
    orgObserver.observe(div);
  });
}

async function renderOrgThumb(div) {
  if (div.dataset.done) return;
  div.dataset.done = '1';
  const entry = store.getPage(div.dataset.pageId);
  if (!entry) return;
  const canvas = div.querySelector('canvas');
  const d = await baseDims(entry);
  const scale = 150 / d.w;
  if (entry.docId === null) {
    canvas.width = Math.floor(d.w * scale);
    canvas.height = Math.floor(d.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  try {
    const proxy = await pageProxy(entry);
    await renderPage(proxy, canvas, scale, entry.rotation);
  } catch { /* best-effort */ }
}

function orgSelected() { return [...orgSel]; }

$('#orgRotateL').addEventListener('click', () => { if (orgSel.size) store.rotatePages(orgSelected(), -90); });
$('#orgRotateR').addEventListener('click', () => { if (orgSel.size) store.rotatePages(orgSelected(), 90); });
$('#orgDuplicate').addEventListener('click', () => { if (orgSel.size) store.duplicatePages(orgSelected()); });
$('#orgDelete').addEventListener('click', () => {
  if (!orgSel.size) return;
  if (!store.deletePages(orgSelected())) toast('Cannot delete every page', true);
  orgSel.clear();
});
$('#orgExtract').addEventListener('click', async () => {
  if (!orgSel.size) { toast('Select pages to extract first', true); return; }
  try {
    const bytes = await exportPdf(store, { mode: 'annots', pageIds: orgSelected() });
    downloadBlob(bytes, withSuffix(store.fileName, '-extract'));
    toast(`Extracted ${orgSel.size} page${orgSel.size > 1 ? 's' : ''}`);
  } catch (err) { toast(`Extract failed: ${err.message}`, true); }
});
$('#orgBlank').addEventListener('click', () => {
  const idx = orgSel.size
    ? Math.max(...orgSelected().map((id) => store.pageIndex(id))) + 1
    : store.state.pages.length;
  store.insertBlankPage(idx);
});
$('#orgClose').addEventListener('click', () => toggleOrganizer(false));

// ---------------------------------------------------------------------------
// Save / print / export
// ---------------------------------------------------------------------------

async function saveDocument(mode) {
  if (!store.hasDocument) { toast('Open a document first', true); return; }
  closeInlineEditors();
  try {
    toast('Preparing PDF…');
    const bytes = await exportPdf(store, {
      mode: mode === 'flatten' ? 'flatten' : 'annots',
      optimize: mode === 'optimize',
    });
    const suffix = mode === 'flatten' ? '-flattened' : mode === 'optimize' ? '-optimized' : '-mirrorz';
    downloadBlob(bytes, withSuffix(store.fileName, suffix));
    store.dirty = false;
    toast(`Saved (${formatBytes(bytes.length)})`);
  } catch (err) {
    console.error(err);
    toast(`Save failed: ${err.message}`, true);
  }
}

let lastPrintUrl = null;

async function printDocument() {
  if (!store.hasDocument) return;
  try {
    toast('Preparing print copy…');
    const bytes = await exportPdf(store, { mode: 'annots' });
    // keep the URL alive for the print tab's lifetime (reload, delayed open);
    // only reclaim the previous one
    if (lastPrintUrl) URL.revokeObjectURL(lastPrintUrl);
    lastPrintUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const win = window.open(lastPrintUrl);
    if (!win) toast('Pop-up blocked — allow pop-ups to print', true);
  } catch (err) { toast(`Print failed: ${err.message}`, true); }
}

function exportComments() {
  const annots = store.state.annotations.filter((a) => a.text || a.markupText);
  if (!annots.length) { toast('No comments to export', true); return; }
  const order = new Map(store.state.pages.map((p, i) => [p.id, i]));
  const lines = [`Comments — ${store.fileName}`, `Exported ${new Date().toLocaleString()}`, ''];
  for (const a of [...annots].sort((x, y) => (order.get(x.pageId) ?? 0) - (order.get(y.pageId) ?? 0))) {
    lines.push(`Page ${(order.get(a.pageId) ?? 0) + 1} · ${annotTypeLabel(a)}`);
    if (a.markupText) lines.push(`  "${a.markupText}"`);
    if (a.text) lines.push(`  ${a.text}`);
    lines.push('');
  }
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain' }),
    store.fileName.replace(/\.pdf$/i, '') + '-comments.txt', 'text/plain');
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

async function openMetaDialog() {
  const dlg = $('#dlgMeta');
  const form = $('#metaForm');
  let info = {};
  const first = store.state.pages.find((p) => p.docId !== null);
  if (first) {
    try {
      const meta = await store.sources.get(first.docId).pdf.getMetadata();
      info = meta.info || {};
    } catch { /* no metadata */ }
  }
  form.title.value = store.meta?.title ?? info.Title ?? '';
  form.author.value = store.meta?.author ?? info.Author ?? '';
  form.subject.value = store.meta?.subject ?? info.Subject ?? '';
  form.keywords.value = store.meta?.keywords ?? info.Keywords ?? '';
  $('#metaInfo').textContent =
    `Producer: ${info.Producer || '—'} · PDF ${info.PDFFormatVersion || '?'} · ${store.state.pages.length} pages`;
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      store.meta = {
        title: form.title.value, author: form.author.value,
        subject: form.subject.value, keywords: form.keywords.value,
      };
      store.dirty = true;
      toast('Document properties will be applied on save');
    }
  }, { once: true });
}

function openWatermarkDialog() {
  const dlg = $('#dlgWatermark');
  const form = $('#wmForm');
  if (store.watermark) {
    form.text.value = store.watermark.text || '';
    form.size.value = store.watermark.size || 48;
    form.opacity.value = store.watermark.opacity || 0.2;
    form.color.value = store.watermark.color || '#d63031';
    form.diagonal.checked = store.watermark.diagonal !== false;
    form.pagenums.checked = !!store.watermark.pagenums;
  }
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      store.watermark = {
        text: form.text.value.trim(),
        size: Number(form.size.value),
        opacity: Number(form.opacity.value),
        color: form.color.value,
        diagonal: form.diagonal.checked,
        pagenums: form.pagenums.checked,
      };
      store.dirty = true;
      toast(store.watermark.text || store.watermark.pagenums
        ? 'Watermark/page numbers will be applied on save' : 'Watermark removed');
    }
  }, { once: true });
}

function openUpgradeDialog() {
  const cards = $('#pricingCards');
  cards.textContent = '';
  for (const key of ['free', 'monthly', 'annual', 'lifetime']) {
    const t = PRICING[key];
    const div = document.createElement('div');
    div.className = 'pricing-card' + (key === 'lifetime' ? ' best' : '');
    div.innerHTML =
      (t.badge ? `<span class="badge">${escapeHtml(t.badge)}</span>` : '') +
      `<h3>${escapeHtml(t.name)}</h3><div class="price">${escapeHtml(t.price)}</div>` +
      `<div class="per">${escapeHtml(t.per)}</div>` +
      `<ul>${t.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
    cards.appendChild(div);
  }
  $('#pricingFootnote').textContent = PRICING.footnote;
  $('#dlgUpgrade').showModal();
}
$('#upgradeClose').addEventListener('click', () => $('#dlgUpgrade').close());

const SHORTCUTS = [
  ['Open file', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Print', 'Ctrl+P'],
  ['Search', 'Ctrl+F'], ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Y'],
  ['Zoom in / out', '+ / −'], ['Select tool', 'V'], ['Hand tool', 'H'],
  ['Highlight', 'Shift+H'], ['Underline', 'U'], ['Strikeout', 'K'],
  ['Sticky note', 'N'], ['Add text', 'T'], ['Draw', 'D'],
  ['Rectangle', 'R'], ['Ellipse', 'E'], ['Line', 'L'], ['Arrow', 'A'],
  ['Whiteout', 'W'], ['Sign', 'S'], ['Delete selected', 'Del'],
  ['Nudge selected', 'Arrow keys'], ['Cancel / deselect', 'Esc'],
  ['Next / prev page', 'PgDn / PgUp'],
];

function openShortcutsDialog() {
  const list = $('#shortcutList');
  list.innerHTML = SHORTCUTS.map(([name, key]) =>
    `<div><span>${escapeHtml(name)}</span><kbd>${escapeHtml(key)}</kbd></div>`).join('');
  $('#dlgShortcuts').showModal();
}
$('#shortcutsClose').addEventListener('click', () => $('#dlgShortcuts').close());

function openAboutDialog() {
  $('#aboutBody').innerHTML = `
    <p><strong>MIRRORZ PDF Editor</strong> — a fast, private, offline PDF viewer,
    annotator and editor that runs entirely in your browser.</p>
    <ul class="welcome-points">
      <li>Your files are processed on this device only. Nothing is ever uploaded.</li>
      <li>No account, no tracking, no ads, no watermarks, no limits.</li>
      <li>Annotations are saved as real PDF annotations — editable in any PDF app.</li>
      <li>Built on open source: Mozilla pdf.js (Apache-2.0) and pdf-lib (MIT).</li>
    </ul>
    <p class="muted">Apache-2.0 licensed · works offline · this page IS the whole app.</p>`;
  $('#dlgAbout').showModal();
}
$('#aboutClose').addEventListener('click', () => $('#dlgAbout').close());

// ---------------------------------------------------------------------------
// Recent files (IndexedDB, local only)
// ---------------------------------------------------------------------------

function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('mirrorz', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'name' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveRecent(name, bytes) {
  if (bytes.length > 40 * 1024 * 1024) return;
  try {
    const db = await idb();
    const tx = db.transaction('recent', 'readwrite');
    const os = tx.objectStore('recent');
    os.put({ name, bytes, ts: Date.now(), size: bytes.length });
    const all = await new Promise((res) => {
      const r = os.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
    if (all.length > 6) {
      all.sort((a, b) => a.ts - b.ts);
      for (const old of all.slice(0, all.length - 6)) os.delete(old.name);
    }
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
    db.close();
  } catch { /* storage unavailable — recents are a convenience only */ }
}

async function renderRecents() {
  try {
    const db = await idb();
    const tx = db.transaction('recent', 'readonly');
    const all = await new Promise((res) => {
      const r = tx.objectStore('recent').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
    db.close();
    if (!all.length) return;
    all.sort((a, b) => b.ts - a.ts);
    $('#recentFiles').hidden = false;
    const ul = $('#recentList');
    ul.textContent = '';
    for (const rec of all) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(rec.name)}</span><span class="muted">${formatBytes(rec.size)}</span>`;
      li.addEventListener('click', async () => {
        try {
          await addDocument(new Uint8Array(rec.bytes), rec.name, { fresh: true });
          await afterCompositionChange({ fresh: true });
        } catch (err) {
          console.error(err);
          toast(`Could not reopen ${rec.name}: ${err.message}`, true);
        }
      });
      ul.appendChild(li);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Toolbar & menus wiring
// ---------------------------------------------------------------------------

function wireToolbar() {
  const iconFor = {
    btnOpen: 'open', btnSave: 'save', btnSaveMenu: 'caret', btnPrint: 'print',
    btnUndo: 'undo', btnRedo: 'redo', btnZoomOut: 'zoomOut', btnZoomIn: 'zoomIn',
    btnSearch: 'search', btnOrganize: 'organize', btnTheme: 'theme', btnMore: 'more',
  };
  for (const [id, icon] of Object.entries(iconFor)) applyIcon(document.getElementById(id), icon);
  $$('#toolGroup .tool').forEach((b) => applyIcon(b, b.dataset.tool));
  const sideIcons = { thumbs: 'thumbs', outline: 'outline', comments: 'comments', forms: 'forms' };
  $$('.side-tab').forEach((b) => applyIcon(b, sideIcons[b.dataset.panel]));

  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#btnOpenWelcome').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { openFiles(e.target.files); e.target.value = ''; });
  $('#mergeInput').addEventListener('change', (e) => { openFiles(e.target.files, { append: true }); e.target.value = ''; });

  $('#btnSave').addEventListener('click', () => saveDocument('annots'));
  $('#btnPrint').addEventListener('click', printDocument);
  $('#btnUndo').addEventListener('click', () => store.undo());
  $('#btnRedo').addEventListener('click', () => store.redo());

  // dropdown menus
  const menus = [
    ['btnSaveMenu', 'saveMenu'],
    ['btnMore', 'moreMenu'],
  ];
  for (const [btnId, menuId] of menus) {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = menu.hidden;
      document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !wasHidden;
    });
  }
  document.addEventListener('click', () => {
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
  });
  $$('#saveMenu button').forEach((b) =>
    b.addEventListener('click', () => saveDocument(b.dataset.save)));

  $('#miMerge').addEventListener('click', () => {
    if (!store.hasDocument) { toast('Open a document first', true); return; }
    $('#mergeInput').click();
  });
  $('#miWatermark').addEventListener('click', openWatermarkDialog);
  $('#miMeta').addEventListener('click', openMetaDialog);
  $('#miComments').addEventListener('click', exportComments);
  $('#miShortcuts').addEventListener('click', openShortcutsDialog);
  $('#miUpgrade').addEventListener('click', openUpgradeDialog);
  $('#miAbout').addEventListener('click', openAboutDialog);

  // tools
  $$('#toolGroup .tool').forEach((b) => {
    b.addEventListener('click', () => {
      view.pending = null;
      setTool(b.dataset.tool);
      if (b.dataset.tool === 'signature') openSignatureDialog();
      else if (b.dataset.tool === 'stamp') openStampDialog();
      else if (b.dataset.tool === 'image') $('#imageInput').click();
    });
  });

  // properties
  // the color input fires 'input' continuously while dragging the picker —
  // push one undo entry per interaction, not one per frame
  let colorUndoPushed = false;
  $('#propColor').addEventListener('input', (e) => {
    view.props.color = e.target.value;
    if (view.selected) {
      if (!colorUndoPushed) { store.pushUndo(); colorUndoPushed = true; }
      store.updateAnnotation(view.selected, { color: e.target.value }, { skipUndo: true });
    }
  });
  $('#propColor').addEventListener('change', () => { colorUndoPushed = false; });
  $('#propWidth').addEventListener('change', (e) => {
    view.props.width = Number(e.target.value);
    if (view.selected) applyPropToSelection({ strokeWidth: Number(e.target.value) });
  });
  $('#propOpacity').addEventListener('change', (e) => {
    view.props.opacity = Number(e.target.value);
    if (view.selected) applyPropToSelection({ opacity: Number(e.target.value) });
  });
  $('#propFontSize').addEventListener('change', (e) => {
    view.props.fontSize = Number(e.target.value);
    if (view.selected) applyPropToSelection({ fontSize: Number(e.target.value) });
  });

  // zoom / nav
  $('#btnZoomIn').addEventListener('click', () => zoomStep(1));
  $('#btnZoomOut').addEventListener('click', () => zoomStep(-1));
  els.zoomSelect.addEventListener('change', () => {
    const v = els.zoomSelect.value;
    setZoom(v === 'fit-width' || v === 'fit-page' ? v : Number(v));
  });
  els.pageNum.addEventListener('change', () => {
    scrollToPage(clamp(Number(els.pageNum.value) - 1, 0, store.state.pages.length - 1));
  });
  els.viewerWrap.addEventListener('scroll', debounce(trackCurrentPage, 80));

  // search
  $('#btnSearch').addEventListener('click', () => toggleSearch());
  $('#searchInput').addEventListener('input', runSearch);
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gotoMatch(view.search.current + (e.shiftKey ? -1 : 1));
    if (e.key === 'Escape') toggleSearch(false);
    e.stopPropagation();
  });
  $('#searchNext').addEventListener('click', () => gotoMatch(view.search.current + 1));
  $('#searchPrev').addEventListener('click', () => gotoMatch(view.search.current - 1));
  $('#searchClose').addEventListener('click', () => toggleSearch(false));

  $('#btnOrganize').addEventListener('click', () => {
    if (!store.hasDocument) { toast('Open a document first', true); return; }
    toggleOrganizer();
  });
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(cur);
  });

  // sidebar tabs
  $$('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.side-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.side-panel').forEach((p) =>
        p.classList.toggle('active', p.id === `panel-${tab.dataset.panel}`));
    });
  });
}

function applyPropToSelection(patch) {
  if (!view.selected) return;
  store.updateAnnotation(view.selected, patch);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

const TOOL_KEYS = {
  v: 'select', h: 'hand', u: 'underline', k: 'strikeout', n: 'note',
  t: 'text', d: 'ink', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow',
  w: 'whiteout', s: 'signature',
};

document.addEventListener('keydown', (evt) => {
  const dialogOpen = !!document.querySelector('dialog[open]');
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    || dialogOpen;
  const mod = evt.ctrlKey || evt.metaKey;

  if (mod) {
    if (dialogOpen) return; // dialogs keep their own Ctrl-key behavior
    const key = evt.key.toLowerCase();
    if (key === 'o') { evt.preventDefault(); $('#fileInput').click(); }
    else if (key === 's') { evt.preventDefault(); saveDocument('annots'); }
    else if (key === 'p') { evt.preventDefault(); printDocument(); }
    else if (key === 'f') { evt.preventDefault(); toggleSearch(true); }
    // undo/redo during an active drag would corrupt the drag's history entry
    else if (key === 'z' && !inField && !drag) { evt.preventDefault(); evt.shiftKey ? store.redo() : store.undo(); }
    else if (key === 'y' && !inField && !drag) { evt.preventDefault(); store.redo(); }
    return;
  }
  if (inField) return;

  if (evt.key === 'Escape') {
    view.pending = null;
    if (!$('#organizer').hidden) { toggleOrganizer(false); return; }
    if (!$('#searchbar').hidden) { toggleSearch(false); return; }
    if (view.selected) { view.selected = null; refreshAllAnnotLayers(); return; }
    setTool('select');
    return;
  }
  if ((evt.key === 'Delete' || evt.key === 'Backspace') && view.selected) {
    evt.preventDefault();
    store.deleteAnnotation(view.selected);
    view.selected = null;
    return;
  }
  if (evt.key.startsWith('Arrow') && view.selected) {
    evt.preventDefault();
    const d = evt.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d],
    }[evt.key];
    const a = store.state.annotations.find((x) => x.id === view.selected);
    if (a && delta) store.updateAnnotation(a.id, movePatch(a, delta[0], delta[1]));
    return;
  }
  if (evt.key === '+' || evt.key === '=') { zoomStep(1); return; }
  if (evt.key === '-') { zoomStep(-1); return; }
  if (evt.key === 'PageDown') { scrollToPage(Math.min(view.currentIndex + 1, store.state.pages.length - 1)); return; }
  if (evt.key === 'PageUp') { scrollToPage(Math.max(view.currentIndex - 1, 0)); return; }

  const key = evt.key.toLowerCase();
  if (evt.shiftKey && key === 'h') { setTool('highlight'); return; }
  if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
    if (TOOL_KEYS[key] === 'signature') openSignatureDialog();
  }
});

// ---------------------------------------------------------------------------
// Drag & drop, resize, unload
// ---------------------------------------------------------------------------

function wireDropZone() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    depth += 1;
    $('#dropHint').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) $('#dropHint').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    $('#dropHint').hidden = true;
    if (e.dataTransfer?.files?.length) {
      openFiles(e.dataTransfer.files, { append: store.hasDocument && e.shiftKey });
    }
  });
}

window.addEventListener('resize', debounce(() => {
  if (store.hasDocument && typeof view.zoomMode === 'string') rebuildViewer();
}, 250));

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  const savedTheme = (() => {
    try { return localStorage.getItem('mirrorz-theme'); } catch { return null; }
  })();
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  wireToolbar();
  wireDropZone();
  initSignatureDialog();
  setTool('select');
  els.zoomSelect.value = 'fit-width';
  renderRecents();
}

init();

// Test/debug hook (also handy for power users in the console)
window.__mirrorz = { store, view };

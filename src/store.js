// Document state: page composition model + annotation model + undo/redo.
//
// The editable state is deliberately plain JSON so undo snapshots are cheap
// and the whole thing can be serialized. Source PDF bytes are held separately
// in `sources` and are never part of a snapshot.
//
// Annotation geometry lives in "page space": PDF points, origin at the
// top-left of the page's crop box, y down. See save.js for conversion to
// PDF user space at export time.

import { uid } from './utils.js';

export const ANNOT_TYPES = {
  highlight: 'highlight',   // quads: [{x,y,w,h}...]
  underline: 'underline',
  strikeout: 'strikeout',
  note: 'note',             // x, y (icon anchor), text
  freetext: 'freetext',     // rect {x,y,w,h}, text, fontSize
  ink: 'ink',               // strokes: [[{x,y}...]...], strokeWidth
  rect: 'rect',             // rect, strokeWidth, fill?
  ellipse: 'ellipse',       // rect, strokeWidth
  line: 'line',             // x1,y1,x2,y2, strokeWidth
  arrow: 'arrow',           // x1,y1,x2,y2, strokeWidth
  whiteout: 'whiteout',     // rect (always white fill, opaque)
  stamp: 'stamp',           // rect, imageData (dataURL) OR label/color for text stamps
};

export class Store {
  constructor() {
    this.reset();
    this.listeners = new Set();
  }

  reset() {
    /** @type {Map<string, {bytes: Uint8Array, name: string, pdf: any}>} */
    this.sources = new Map();
    this.state = {
      pages: [],        // [{id, docId, srcIndex, rotation}] rotation: extra deg 0/90/180/270
      annotations: [],  // [{id, pageId, type, color, opacity, ...geometry}]
    };
    this.fileName = 'document.pdf';
    this.meta = null;       // {title, author, subject, keywords} override for save
    this.watermark = null;  // {text, size, opacity, color, diagonal, pagenums}
    this.formValues = {};   // fieldName -> value (string|boolean)
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  // ---------- snapshots / undo ----------
  snapshot() {
    return JSON.stringify(this.state);
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.emit({ type: 'history' });
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.state = JSON.parse(this.undoStack.pop());
    this.emit({ type: 'restore' });
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.state = JSON.parse(this.redoStack.pop());
    this.emit({ type: 'restore' });
    return true;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---------- pages ----------
  addSource(docId, bytes, name, pdf) {
    this.sources.set(docId, { bytes, name, pdf });
  }

  /** Append pages for a whole source document. */
  addPagesFromSource(docId, numPages) {
    for (let i = 0; i < numPages; i++) {
      this.state.pages.push({ id: uid('p'), docId, srcIndex: i, rotation: 0 });
    }
  }

  getPage(pageId) { return this.state.pages.find((p) => p.id === pageId); }
  pageIndex(pageId) { return this.state.pages.findIndex((p) => p.id === pageId); }

  movePages(pageIds, targetIndex) {
    this.pushUndo();
    const moving = this.state.pages.filter((p) => pageIds.includes(p.id));
    const rest = this.state.pages.filter((p) => !pageIds.includes(p.id));
    // targetIndex counts positions in the *remaining* list
    rest.splice(targetIndex, 0, ...moving);
    this.state.pages = rest;
    this.emit({ type: 'pages' });
  }

  rotatePages(pageIds, delta) {
    this.pushUndo();
    for (const p of this.state.pages) {
      if (pageIds.includes(p.id)) p.rotation = ((p.rotation + delta) % 360 + 360) % 360;
    }
    this.emit({ type: 'pages' });
  }

  deletePages(pageIds) {
    if (pageIds.length >= this.state.pages.length) return false; // keep at least one
    this.pushUndo();
    this.state.pages = this.state.pages.filter((p) => !pageIds.includes(p.id));
    this.state.annotations = this.state.annotations.filter((a) => !pageIds.includes(a.pageId));
    this.emit({ type: 'pages' });
    return true;
  }

  duplicatePages(pageIds) {
    this.pushUndo();
    const out = [];
    for (const p of this.state.pages) {
      out.push(p);
      if (pageIds.includes(p.id)) out.push({ ...p, id: uid('p') });
    }
    this.state.pages = out;
    this.emit({ type: 'pages' });
  }

  insertBlankPage(index, width = 612, height = 792) {
    this.pushUndo();
    this.state.pages.splice(index, 0,
      { id: uid('p'), docId: null, srcIndex: -1, rotation: 0, blank: { width, height } });
    this.emit({ type: 'pages' });
  }

  // ---------- annotations ----------
  addAnnotation(annot, { skipUndo = false } = {}) {
    if (!skipUndo) this.pushUndo();
    const a = { id: uid('a'), ...annot };
    this.state.annotations.push(a);
    this.emit({ type: 'annots', pageId: a.pageId });
    return a;
  }

  updateAnnotation(id, patch, { skipUndo = false } = {}) {
    const a = this.state.annotations.find((x) => x.id === id);
    if (!a) return null;
    if (!skipUndo) this.pushUndo();
    Object.assign(a, patch);
    this.emit({ type: 'annots', pageId: a.pageId });
    return a;
  }

  deleteAnnotation(id) {
    const a = this.state.annotations.find((x) => x.id === id);
    if (!a) return false;
    this.pushUndo();
    this.state.annotations = this.state.annotations.filter((x) => x.id !== id);
    this.emit({ type: 'annots', pageId: a.pageId });
    return true;
  }

  annotationsForPage(pageId) {
    return this.state.annotations.filter((a) => a.pageId === pageId);
  }

  get hasDocument() { return this.state.pages.length > 0; }
}

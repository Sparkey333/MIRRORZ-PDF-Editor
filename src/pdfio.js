// All pdf-lib work: input normalization (image/text -> PDF), importing existing
// PDF annotations into the editable model (and stripping them from the bytes so
// they are not double-rendered), and the export pipeline that writes REAL PDF
// annotation objects with generated appearance streams — so MIRRORZ annotations
// show up and stay editable in Acrobat, Preview, browsers and other editors.

import {
  PDFDocument, PDFName, PDFDict, PDFString, PDFHexString, PDFRef,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
  StandardFonts, degrees, rgb, BlendMode, LineCapStyle,
} from 'pdf-lib';
import { hexToRgb01, rgbToHex, pdfDateNow, uid } from './utils.js';

const MANAGED_SUBTYPES = new Set([
  'Highlight', 'Underline', 'StrikeOut', 'Ink', 'Square', 'Circle', 'Line',
  'FreeText', 'Text',
]);

const n2 = (v) => String(Math.round(v * 100) / 100);

// ---------------------------------------------------------------------------
// Input normalization: turn any supported file into PDF bytes
// ---------------------------------------------------------------------------

export async function fileToPdfBytes(file) {
  const name = file.name || 'file';
  const lower = name.toLowerCase();
  const type = file.type || '';
  if (type === 'application/pdf' || lower.endsWith('.pdf')) {
    return { bytes: new Uint8Array(await file.arrayBuffer()), name };
  }
  if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/.test(lower)) {
    const bytes = await imageToPdf(file);
    return { bytes, name: name.replace(/\.[^.]+$/, '') + '.pdf' };
  }
  if (type.startsWith('text/') || /\.(txt|md|log|csv)$/.test(lower)) {
    const bytes = await textToPdf(await file.text(), name);
    return { bytes, name: name.replace(/\.[^.]+$/, '') + '.pdf' };
  }
  throw new Error(`Unsupported file type: ${name}`);
}

async function imageToPdf(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let kind = file.type;
  if (kind !== 'image/png' && kind !== 'image/jpeg') {
    // webp or anything else the browser can decode -> re-encode as PNG
    bytes = await reencodeAsPng(file);
    kind = 'image/png';
  }
  const doc = await PDFDocument.create();
  const img = kind === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  // assume 96dpi source, render at 72pt/inch; cap to A4-ish width for huge photos
  let w = (img.width * 72) / 96;
  let h = (img.height * 72) / 96;
  const maxW = 595, maxH = 842;
  const scale = Math.min(1, maxW / w, maxH / h);
  w *= scale; h *= scale;
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc.save();
}

async function reencodeAsPng(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function textToPdf(text, name) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 11, leading = 15.5, margin = 54;
  const pageW = 612, pageH = 792;
  const maxWidth = pageW - margin * 2;
  const lines = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    lines.push(...wrapLine(sanitizeWinAnsi(raw), font, size, maxWidth));
  }
  let page = null, y = 0;
  for (const line of lines.length ? lines : ['']) {
    if (!page || y < margin) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size, font });
    y -= leading;
  }
  doc.setTitle(name);
  return doc.save();
}

function wrapLine(line, font, size, maxWidth) {
  if (!line) return [''];
  const words = line.split(/(\s+)/);
  const out = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur + w;
    if (cur && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      out.push(cur.trimEnd());
      cur = w.trimStart();
    } else {
      cur = candidate;
    }
  }
  if (cur.trim() || out.length === 0) out.push(cur.trimEnd());
  return out;
}

/** Replace characters Helvetica/WinAnsi can't encode. */
function sanitizeWinAnsi(s) {
  return String(s).replace(/\t/g, '    ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Importing existing annotations (via pdf.js data) into the editable model
// ---------------------------------------------------------------------------

/**
 * Read the markup annotations of an already-loaded pdf.js document and map
 * them into MIRRORZ model annotations (page space, y-down from crop box top).
 * @param pdfjsDoc pdf.js PDFDocumentProxy
 * @param pageIds our page ids, index-aligned with the document's pages
 */
export async function importAnnotations(pdfjsDoc, pageIds) {
  const annots = [];
  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const view = page.view; // [x1, y1, x2, y2] user space
    const toPS = (ux, uy) => ({ x: ux - view[0], y: view[3] - uy });
    const list = await page.getAnnotations().catch(() => []);
    for (const a of list) {
      if (!a.subtype || !MANAGED_SUBTYPES.has(a.subtype)) continue;
      if (a.annotationFlags & 2) continue; // hidden
      const mapped = mapPdfjsAnnotation(a, toPS);
      if (mapped) annots.push({ id: uid('a'), pageId: pageIds[i - 1], ...mapped });
    }
  }
  return annots;
}

function mapPdfjsAnnotation(a, toPS) {
  const color = a.color ? rgbToHex(a.color) : '#ffd400';
  const text = a.contentsObj?.str || '';
  const strokeWidth = a.borderStyle?.width || 2;
  const rectPS = () => {
    const [x1, y1, x2, y2] = a.rect;
    const tl = toPS(Math.min(x1, x2), Math.max(y1, y2));
    return { x: tl.x, y: tl.y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  };
  switch (a.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut': {
      const quads = parseQuadPoints(a.quadPoints, toPS);
      if (!quads.length) return null;
      const type = a.subtype === 'Highlight' ? 'highlight'
        : a.subtype === 'Underline' ? 'underline' : 'strikeout';
      return { type, quads, color, opacity: type === 'highlight' ? 0.45 : 1, text };
    }
    case 'Ink': {
      const strokes = parseInkLists(a.inkLists, toPS);
      if (!strokes.length) return null;
      return { type: 'ink', strokes, color, opacity: 1, strokeWidth, text };
    }
    case 'Square': {
      // our whiteouts are white Squares with no border — restore them as such
      if (color.toLowerCase() === '#ffffff') {
        return { type: 'whiteout', rect: rectPS(), color: '#ffffff', opacity: 1, text };
      }
      return { type: 'rect', rect: rectPS(), color, opacity: 1, strokeWidth, text };
    }
    case 'Circle':
      return { type: 'ellipse', rect: rectPS(), color, opacity: 1, strokeWidth, text };
    case 'Line': {
      const lc = a.lineCoordinates;
      if (!lc || lc.length < 4) return null;
      const p1 = toPS(lc[0], lc[1]);
      const p2 = toPS(lc[2], lc[3]);
      const isArrow = JSON.stringify(a.lineEndings || []).includes('Arrow');
      return {
        type: isArrow ? 'arrow' : 'line',
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        color, opacity: 1, strokeWidth, text,
      };
    }
    case 'FreeText': {
      const r = rectPS();
      const fontSize = a.defaultAppearanceData?.fontSize || 14;
      const fc = a.defaultAppearanceData?.fontColor;
      return {
        type: 'freetext', rect: r, text: a.richText?.str || text,
        fontSize, color: fc ? rgbToHex(fc) : '#1c1e24', opacity: 1,
      };
    }
    case 'Text': {
      const r = rectPS();
      return { type: 'note', x: r.x, y: r.y, text, color, opacity: 1 };
    }
    default:
      return null;
  }
}

function parseQuadPoints(qp, toPS) {
  if (!qp) return [];
  const flat = [];
  if (typeof qp[0] === 'number') {
    flat.push(...qp);
  } else {
    // older pdf.js shape: [[{x,y} x4]...]
    for (const group of qp) for (const p of group) flat.push(p.x, p.y);
  }
  const quads = [];
  for (let i = 0; i + 7 < flat.length; i += 8) {
    const xs = [flat[i], flat[i + 2], flat[i + 4], flat[i + 6]];
    const ys = [flat[i + 1], flat[i + 3], flat[i + 5], flat[i + 7]];
    const tl = toPS(Math.min(...xs), Math.max(...ys));
    quads.push({
      x: tl.x, y: tl.y,
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    });
  }
  return quads;
}

function parseInkLists(lists, toPS) {
  if (!lists) return [];
  const strokes = [];
  for (const list of lists) {
    const pts = [];
    if (list.length && typeof list[0] === 'number') {
      for (let i = 0; i + 1 < list.length; i += 2) pts.push(toPS(list[i], list[i + 1]));
    } else {
      for (const p of list) pts.push(toPS(p.x, p.y));
    }
    if (pts.length > 1) strokes.push(pts);
  }
  return strokes;
}

/**
 * Remove the annotation subtypes we manage from the PDF bytes (they now live
 * in the editable model instead). Links, widgets, stamps etc. are preserved.
 * Returns null if the bytes could not be processed (e.g. encrypted).
 */
export async function stripManagedAnnotations(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return null;
  }
  const ctx = doc.context;
  const subtypeName = PDFName.of('Subtype');
  const parentName = PDFName.of('Parent');
  const isManaged = (dict) => {
    const st = dict?.get?.(subtypeName);
    if (!st) return false;
    const s = st.toString().slice(1);
    if (MANAGED_SUBTYPES.has(s)) return true;
    if (s === 'Popup') {
      const parent = ctx.lookup(dict.get(parentName));
      const pst = parent?.get?.(subtypeName);
      return !!pst && MANAGED_SUBTYPES.has(pst.toString().slice(1));
    }
    return false;
  };
  for (const page of doc.getPages()) {
    const annots = page.node.Annots?.();
    if (!annots) continue;
    const kept = [];
    for (let i = 0; i < annots.size(); i++) {
      const value = annots.get(i);
      const dict = ctx.lookup(value);
      if (!(dict instanceof PDFDict) || !isManaged(dict)) kept.push(value);
    }
    page.node.set(PDFName.of('Annots'), ctx.obj(kept));
  }
  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

/** List form fields of a document: [{name, type, value, options}] */
export async function listFormFields(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }
  const out = [];
  let fields = [];
  try { fields = doc.getForm().getFields(); } catch { return []; }
  for (const f of fields) {
    const name = f.getName();
    try {
      if (f instanceof PDFTextField) {
        out.push({ name, type: 'text', value: f.getText() || '', multiline: f.isMultiline?.() || false });
      } else if (f instanceof PDFCheckBox) {
        out.push({ name, type: 'checkbox', value: f.isChecked() });
      } else if (f instanceof PDFRadioGroup) {
        out.push({ name, type: 'radio', value: f.getSelected() || '', options: f.getOptions() });
      } else if (f instanceof PDFDropdown) {
        out.push({ name, type: 'dropdown', value: (f.getSelected() || [])[0] || '', options: f.getOptions() });
      } else if (f instanceof PDFOptionList) {
        out.push({ name, type: 'optionlist', value: (f.getSelected() || [])[0] || '', options: f.getOptions() });
      }
    } catch { /* skip unreadable field */ }
  }
  return out;
}

function applyFormValues(doc, values, helv, { flatten = false } = {}) {
  let form;
  try { form = doc.getForm(); } catch { return; }
  let touched = false;
  for (const [name, value] of Object.entries(values || {})) {
    let field;
    try { field = form.getField(name); } catch { continue; }
    try {
      if (field instanceof PDFTextField) field.setText(String(value ?? ''));
      else if (field instanceof PDFCheckBox) (value ? field.check() : field.uncheck());
      else if (field instanceof PDFRadioGroup) { if (value) field.select(String(value)); }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (value) field.select(String(value));
      }
      touched = true;
    } catch { /* ignore bad value */ }
  }
  if (touched || flatten) {
    try { form.updateFieldAppearances(helv); } catch { /* best effort */ }
  }
  if (flatten) {
    try { form.flatten(); } catch { /* best effort */ }
  }
}

/** After copyPages, widgets exist but the AcroForm catalog entry does not.
 * Rebuild a minimal AcroForm so fields stay interactive in other viewers. */
function rebuildAcroForm(out, helv) {
  const ctx = out.context;
  const subtypeName = PDFName.of('Subtype');
  const parentName = PDFName.of('Parent');
  const widget = PDFName.of('Widget');
  const seen = new Set();
  const fieldRefs = [];
  for (const page of out.getPages()) {
    const annots = page.node.Annots?.();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i);
      let dict = ctx.lookup(ref);
      if (!(dict instanceof PDFDict) || dict.get(subtypeName) !== widget) continue;
      // climb to the top-level field
      let guard = 0;
      while (dict.get(parentName) && guard++ < 32) {
        ref = dict.get(parentName);
        dict = ctx.lookup(ref);
        if (!(dict instanceof PDFDict)) break;
      }
      if (ref instanceof PDFRef && !seen.has(ref.toString())) {
        seen.add(ref.toString());
        fieldRefs.push(ref);
      }
    }
  }
  if (!fieldRefs.length) return;
  const acro = ctx.obj({
    Fields: fieldRefs,
    DA: PDFString.of('/Helv 0 Tf 0 g'),
    DR: { Font: { Helv: helv.ref } },
  });
  out.catalog.set(PDFName.of('AcroForm'), acro);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Build the output PDF from the store's page composition + annotations.
 * @param store Store instance
 * @param opts {mode: 'annots'|'flatten', optimize?: boolean, pageIds?: string[]}
 * @returns {Promise<Uint8Array>}
 */
export async function exportPdf(store, opts = {}) {
  const { mode = 'annots', optimize = false, pageIds = null } = opts;
  const included = store.state.pages.filter((p) => !pageIds || pageIds.includes(p.id));
  if (!included.length) throw new Error('No pages to export');

  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);

  // Load each needed source once; apply form values before copying pages
  const srcCache = new Map();
  let anyForms = false;
  for (const p of included) {
    if (p.docId === null || srcCache.has(p.docId)) continue;
    const src = store.sources.get(p.docId);
    const doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
    const srcHelv = await doc.embedFont(StandardFonts.Helvetica);
    try { anyForms = anyForms || doc.getForm().getFields().length > 0; } catch { /* no form */ }
    applyFormValues(doc, store.formValues, srcHelv, { flatten: mode === 'flatten' });
    srcCache.set(p.docId, doc);
  }

  // Assemble pages in order
  const outPageById = new Map();
  for (const p of included) {
    if (p.docId === null) {
      const page = out.addPage([p.blank?.width || 612, p.blank?.height || 792]);
      if (p.rotation) page.setRotation(degrees(p.rotation));
      outPageById.set(p.id, page);
    } else {
      const [copied] = await out.copyPages(srcCache.get(p.docId), [p.srcIndex]);
      out.addPage(copied);
      if (p.rotation) {
        const cur = copied.getRotation().angle || 0;
        copied.setRotation(degrees(((cur + p.rotation) % 360 + 360) % 360));
      }
      outPageById.set(p.id, copied);
    }
  }

  if (mode !== 'flatten' && anyForms) rebuildAcroForm(out, helv);

  // Image cache for stamps/signatures
  const imgCache = new Map();
  const getImage = async (dataUrl) => {
    if (!imgCache.has(dataUrl)) {
      const bytes = dataUrlToBytes(dataUrl);
      const img = dataUrl.startsWith('data:image/jpeg')
        ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      imgCache.set(dataUrl, img);
    }
    return imgCache.get(dataUrl);
  };

  // Write annotations
  for (const a of store.state.annotations) {
    const page = outPageById.get(a.pageId);
    if (!page) continue;
    try {
      if (mode === 'flatten') await flattenAnnot(out, page, a, helv, getImage);
      else await writeAnnot(out, page, a, helv, getImage);
    } catch (err) {
      console.warn('Failed to write annotation', a.type, err);
    }
  }

  // Watermark & page numbers (always drawn into content)
  if (store.watermark && (store.watermark.text || store.watermark.pagenums)) {
    drawWatermarks(out, helv, store.watermark);
  }

  // Metadata
  const m = store.meta;
  if (m) {
    if (m.title != null) out.setTitle(m.title);
    if (m.author != null) out.setAuthor(m.author);
    if (m.subject != null) out.setSubject(m.subject);
    if (m.keywords != null) out.setKeywords(String(m.keywords).split(/[,;]\s*/).filter(Boolean));
  }
  out.setProducer('MIRRORZ PDF Editor');
  out.setModificationDate(new Date());

  return out.save({ useObjectStreams: !!optimize });
}

// -------- geometry helpers (page space -> user space) --------

function cropOf(page) {
  let cb;
  try { cb = page.getCropBox(); } catch { cb = null; }
  if (!cb || !cb.width || !cb.height) {
    const mb = page.getMediaBox();
    cb = { x: mb.x, y: mb.y, width: mb.width, height: mb.height };
  }
  return cb;
}

function makeConverters(page) {
  const cb = cropOf(page);
  return {
    ux: (x) => cb.x + x,
    uy: (y) => cb.y + cb.height - y,
    cb,
  };
}

// -------- real annotation writer --------

async function writeAnnot(out, page, a, helv, getImage) {
  const ctx = out.context;
  const { ux, uy } = makeConverters(page);
  const color = hexToRgb01(a.color || '#ffd400');
  const C = [color.r, color.g, color.b];
  const opacity = a.opacity ?? 1;
  const common = {
    Type: 'Annot',
    F: 4,
    M: PDFString.of(pdfDateNow()),
    T: PDFString.of('MIRRORZ'),
    NM: PDFString.of(a.id || uid('nm')),
  };
  if (a.text) common.Contents = PDFHexString.fromText(a.text);

  const addAnnot = (dictLiteral, apStream) => {
    const dict = ctx.obj({ ...common, ...dictLiteral });
    if (apStream) dict.set(PDFName.of('AP'), ctx.obj({ N: ctx.register(apStream) }));
    const ref = ctx.register(dict);
    const annots = page.node.Annots?.();
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  };

  const ap = (ops, rect, resources) =>
    ctx.stream(ops, {
      Type: 'XObject', Subtype: 'Form', FormType: 1,
      BBox: rect, ...(resources ? { Resources: resources } : {}),
    });

  const gsResources = (blend) => ({
    ExtGState: { GS0: { Type: 'ExtGState', BM: blend, CA: opacity, ca: opacity } },
  });

  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const quadPoints = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const opsParts = [`/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} rg`];
      for (const q of a.quads || []) {
        const x1 = ux(q.x), yTop = uy(q.y), x2 = ux(q.x + q.w), yBot = uy(q.y + q.h);
        // Acrobat's (historical) order: TL TR BL BR
        quadPoints.push(x1, yTop, x2, yTop, x1, yBot, x2, yBot);
        minX = Math.min(minX, x1); maxX = Math.max(maxX, x2);
        minY = Math.min(minY, yBot); maxY = Math.max(maxY, yTop);
        if (a.type === 'highlight') {
          opsParts.push(`${n2(x1)} ${n2(yBot)} ${n2(x2 - x1)} ${n2(yTop - yBot)} re f`);
        } else {
          const th = Math.max(0.75, (yTop - yBot) * 0.055);
          const ly = a.type === 'underline' ? yBot + th : (yBot + yTop) / 2 - th / 2;
          opsParts.push(`${n2(x1)} ${n2(ly)} ${n2(x2 - x1)} ${n2(th)} re f`);
        }
      }
      if (!quadPoints.length) return;
      const rect = [minX, minY, maxX, maxY];
      const subtype = a.type === 'highlight' ? 'Highlight'
        : a.type === 'underline' ? 'Underline' : 'StrikeOut';
      addAnnot(
        { Subtype: subtype, Rect: rect, QuadPoints: quadPoints, C, CA: opacity },
        ap(opsParts.join('\n'), rect,
          gsResources(a.type === 'highlight' ? 'Multiply' : 'Normal')),
      );
      break;
    }

    case 'ink': {
      const w = a.strokeWidth || 2;
      const inkList = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const opsParts = [
        `/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} RG ${n2(w)} w 1 J 1 j`,
      ];
      for (const stroke of a.strokes || []) {
        const flat = [];
        const path = [];
        stroke.forEach((p, i) => {
          const x = ux(p.x), y = uy(p.y);
          flat.push(x, y);
          path.push(`${n2(x)} ${n2(y)} ${i === 0 ? 'm' : 'l'}`);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        });
        inkList.push(flat);
        opsParts.push(path.join(' ') + ' S');
      }
      if (!inkList.length) return;
      const pad = w + 2;
      const rect = [minX - pad, minY - pad, maxX + pad, maxY + pad];
      addAnnot(
        { Subtype: 'Ink', Rect: rect, InkList: inkList, C, CA: opacity, BS: { W: w, S: 'S' } },
        ap(opsParts.join('\n'), rect, gsResources('Normal')),
      );
      break;
    }

    case 'rect':
    case 'whiteout': {
      const r = a.rect;
      const w = a.type === 'whiteout' ? 0 : (a.strokeWidth || 2);
      const x1 = ux(r.x), y2 = uy(r.y), x2 = ux(r.x + r.w), y1 = uy(r.y + r.h);
      const pad = w + 1;
      const rect = [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
      let ops;
      let dict;
      if (a.type === 'whiteout') {
        ops = `1 1 1 rg ${n2(x1)} ${n2(y1)} ${n2(x2 - x1)} ${n2(y2 - y1)} re f`;
        dict = { Subtype: 'Square', Rect: rect, C: [1, 1, 1], IC: [1, 1, 1], CA: 1, BS: { W: 0 } };
      } else {
        ops = `/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} RG ${n2(w)} w ` +
          `${n2(x1)} ${n2(y1)} ${n2(x2 - x1)} ${n2(y2 - y1)} re S`;
        dict = { Subtype: 'Square', Rect: rect, C, CA: opacity, BS: { W: w, S: 'S' } };
      }
      addAnnot(dict, ap(ops, rect, a.type === 'whiteout' ? undefined : gsResources('Normal')));
      break;
    }

    case 'ellipse': {
      const r = a.rect;
      const w = a.strokeWidth || 2;
      const x1 = ux(r.x), y2 = uy(r.y), x2 = ux(r.x + r.w), y1 = uy(r.y + r.h);
      const pad = w + 1;
      const rect = [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      const k = 0.5523;
      const ops = [
        `/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} RG ${n2(w)} w`,
        `${n2(cx + rx)} ${n2(cy)} m`,
        `${n2(cx + rx)} ${n2(cy + ry * k)} ${n2(cx + rx * k)} ${n2(cy + ry)} ${n2(cx)} ${n2(cy + ry)} c`,
        `${n2(cx - rx * k)} ${n2(cy + ry)} ${n2(cx - rx)} ${n2(cy + ry * k)} ${n2(cx - rx)} ${n2(cy)} c`,
        `${n2(cx - rx)} ${n2(cy - ry * k)} ${n2(cx - rx * k)} ${n2(cy - ry)} ${n2(cx)} ${n2(cy - ry)} c`,
        `${n2(cx + rx * k)} ${n2(cy - ry)} ${n2(cx + rx)} ${n2(cy - ry * k)} ${n2(cx + rx)} ${n2(cy)} c`,
        'S',
      ].join('\n');
      addAnnot(
        { Subtype: 'Circle', Rect: rect, C, CA: opacity, BS: { W: w, S: 'S' } },
        ap(ops, rect, gsResources('Normal')),
      );
      break;
    }

    case 'line':
    case 'arrow': {
      const w = a.strokeWidth || 2;
      const x1 = ux(a.x1), y1 = uy(a.y1), x2 = ux(a.x2), y2 = uy(a.y2);
      const head = Math.max(8, w * 4);
      const pad = head + w;
      const rect = [
        Math.min(x1, x2) - pad, Math.min(y1, y2) - pad,
        Math.max(x1, x2) + pad, Math.max(y1, y2) + pad,
      ];
      const parts = [
        `/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} RG ${n2(w)} w 1 J 1 j`,
        `${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`,
      ];
      if (a.type === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
          const hx = x2 + head * Math.cos(ang + da);
          const hy = y2 + head * Math.sin(ang + da);
          parts.push(`${n2(x2)} ${n2(y2)} m ${n2(hx)} ${n2(hy)} l S`);
        }
      }
      addAnnot(
        {
          Subtype: 'Line', Rect: rect, L: [x1, y1, x2, y2], C, CA: opacity,
          BS: { W: w, S: 'S' },
          ...(a.type === 'arrow' ? { LE: [PDFName.of('None'), PDFName.of('OpenArrow')] } : {}),
        },
        ap(parts.join('\n'), rect, gsResources('Normal')),
      );
      break;
    }

    case 'freetext': {
      const r = a.rect;
      const size = a.fontSize || 14;
      const x1 = ux(r.x), y2 = uy(r.y), x2 = ux(r.x + r.w), y1 = uy(r.y + r.h);
      const rect = [x1, y1, x2, y2];
      const lines = [];
      for (const raw of String(a.text || '').split('\n')) {
        lines.push(...wrapLine(sanitizeWinAnsi(raw), helv, size, Math.max(10, r.w - 4)));
      }
      const leading = size * 1.18;
      const parts = [
        `/GS0 gs BT /Helv ${n2(size)} Tf ${n2(leading)} TL`,
        `${n2(color.r)} ${n2(color.g)} ${n2(color.b)} rg`,
        `${n2(x1 + 2)} ${n2(y2 - size)} Td`,
      ];
      for (let i = 0; i < lines.length; i++) {
        parts.push(`(${escapePdfString(lines[i])}) Tj${i < lines.length - 1 ? ' T*' : ''}`);
      }
      parts.push('ET');
      const da = `${n2(color.r)} ${n2(color.g)} ${n2(color.b)} rg /Helv ${n2(size)} Tf`;
      addAnnot(
        {
          Subtype: 'FreeText', Rect: rect, DA: PDFString.of(da), Q: 0, CA: opacity,
          Contents: PDFHexString.fromText(a.text || ''),
        },
        ap(parts.join('\n'), rect, {
          ...gsResources('Normal'),
          Font: { Helv: helv.ref },
        }),
      );
      break;
    }

    case 'note': {
      const W = 22, H = 20;
      const x1 = ux(a.x), y2 = uy(a.y), x2 = x1 + W, y1 = y2 - H;
      const rect = [x1, y1, x2, y2];
      const ops = [
        `${n2(color.r)} ${n2(color.g)} ${n2(color.b)} rg 0.2 0.2 0.2 RG 1 w`,
        // rounded speech bubble
        `${n2(x1 + 2)} ${n2(y1 + 6)} ${n2(W - 4)} ${n2(H - 8)} re B`,
        `${n2(x1 + 6)} ${n2(y1 + 6)} m ${n2(x1 + 5)} ${n2(y1 + 1)} l ${n2(x1 + 11)} ${n2(y1 + 6)} l B`,
        '1 1 1 RG 1.2 w',
        `${n2(x1 + 5)} ${n2(y2 - 6)} m ${n2(x2 - 5)} ${n2(y2 - 6)} l S`,
        `${n2(x1 + 5)} ${n2(y2 - 10)} m ${n2(x2 - 5)} ${n2(y2 - 10)} l S`,
      ].join('\n');
      addAnnot(
        { Subtype: 'Text', Rect: rect, Name: 'Comment', Open: false, C, CA: opacity },
        ap(ops, rect),
      );
      break;
    }

    case 'stamp': {
      const r = a.rect;
      const x1 = ux(r.x), y2 = uy(r.y), x2 = ux(r.x + r.w), y1 = uy(r.y + r.h);
      const rect = [x1, y1, x2, y2];
      if (a.imageData) {
        const img = await getImage(a.imageData);
        const ops = `q ${n2(x2 - x1)} 0 0 ${n2(y2 - y1)} ${n2(x1)} ${n2(y1)} cm /Im0 Do Q`;
        addAnnot(
          { Subtype: 'Stamp', Rect: rect, CA: opacity },
          ap(ops, rect, { XObject: { Im0: img.ref } }),
        );
      } else {
        const label = sanitizeWinAnsi(a.label || 'STAMP');
        const size = Math.min(24, (y2 - y1) * 0.55);
        const tw = helv.widthOfTextAtSize(label, size);
        const cx = (x1 + x2) / 2;
        const ops = [
          `/GS0 gs ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} RG 2 w`,
          `${n2(x1 + 1)} ${n2(y1 + 1)} ${n2(x2 - x1 - 2)} ${n2(y2 - y1 - 2)} re S`,
          `BT /Helv ${n2(size)} Tf ${n2(color.r)} ${n2(color.g)} ${n2(color.b)} rg`,
          `${n2(cx - tw / 2)} ${n2((y1 + y2) / 2 - size * 0.36)} Td (${escapePdfString(label)}) Tj ET`,
        ].join('\n');
        addAnnot(
          { Subtype: 'Stamp', Rect: rect, CA: opacity },
          ap(ops, rect, { ...gsResources('Normal'), Font: { Helv: helv.ref } }),
        );
      }
      break;
    }

    default:
      break;
  }
}

function escapePdfString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// -------- flatten writer (burn into page content) --------

async function flattenAnnot(out, page, a, helv, getImage) {
  const { ux, uy, cb } = makeConverters(page);
  const color = hexToRgb01(a.color || '#ffd400');
  const col = rgb(color.r, color.g, color.b);
  const opacity = a.opacity ?? 1;
  // drawSvgPath uses y-down coordinates from the given origin -> page space maps directly
  const svgOrigin = { x: cb.x, y: cb.y + cb.height };

  switch (a.type) {
    case 'highlight':
      for (const q of a.quads || []) {
        page.drawRectangle({
          x: ux(q.x), y: uy(q.y + q.h), width: q.w, height: q.h,
          color: col, opacity, blendMode: BlendMode.Multiply,
        });
      }
      break;
    case 'underline':
    case 'strikeout':
      for (const q of a.quads || []) {
        const th = Math.max(0.75, q.h * 0.055);
        const yTopPS = a.type === 'underline' ? q.y + q.h - th : q.y + q.h / 2 - th / 2;
        page.drawRectangle({
          x: ux(q.x), y: uy(yTopPS + th), width: q.w, height: th, color: col, opacity,
        });
      }
      break;
    case 'ink':
      for (const stroke of a.strokes || []) {
        const d = stroke.map((p, i) => `${i ? 'L' : 'M'} ${n2(p.x)} ${n2(p.y)}`).join(' ');
        page.drawSvgPath(d, {
          ...svgOrigin, borderColor: col, borderWidth: a.strokeWidth || 2,
          borderOpacity: opacity, borderLineCap: LineCapStyle.Round,
        });
      }
      break;
    case 'rect':
      page.drawRectangle({
        x: ux(a.rect.x), y: uy(a.rect.y + a.rect.h), width: a.rect.w, height: a.rect.h,
        borderColor: col, borderWidth: a.strokeWidth || 2, borderOpacity: opacity,
      });
      break;
    case 'whiteout':
      page.drawRectangle({
        x: ux(a.rect.x), y: uy(a.rect.y + a.rect.h), width: a.rect.w, height: a.rect.h,
        color: rgb(1, 1, 1),
      });
      break;
    case 'ellipse':
      page.drawEllipse({
        x: ux(a.rect.x + a.rect.w / 2), y: uy(a.rect.y + a.rect.h / 2),
        xScale: a.rect.w / 2, yScale: a.rect.h / 2,
        borderColor: col, borderWidth: a.strokeWidth || 2, borderOpacity: opacity,
      });
      break;
    case 'line':
    case 'arrow': {
      const w = a.strokeWidth || 2;
      page.drawLine({
        start: { x: ux(a.x1), y: uy(a.y1) }, end: { x: ux(a.x2), y: uy(a.y2) },
        thickness: w, color: col, opacity, lineCap: LineCapStyle.Round,
      });
      if (a.type === 'arrow') {
        const head = Math.max(8, w * 4);
        const ang = Math.atan2(uy(a.y2) - uy(a.y1), ux(a.x2) - ux(a.x1));
        for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
          page.drawLine({
            start: { x: ux(a.x2), y: uy(a.y2) },
            end: {
              x: ux(a.x2) + head * Math.cos(ang + da),
              y: uy(a.y2) + head * Math.sin(ang + da),
            },
            thickness: w, color: col, opacity, lineCap: LineCapStyle.Round,
          });
        }
      }
      break;
    }
    case 'freetext': {
      const size = a.fontSize || 14;
      const lines = [];
      for (const raw of String(a.text || '').split('\n')) {
        lines.push(...wrapLine(sanitizeWinAnsi(raw), helv, size, Math.max(10, a.rect.w - 4)));
      }
      let y = uy(a.rect.y) - size;
      for (const line of lines) {
        if (line) page.drawText(line, { x: ux(a.rect.x) + 2, y, size, font: helv, color: col, opacity });
        y -= size * 1.18;
      }
      break;
    }
    case 'note': {
      // draw the bubble + its text content beside it
      page.drawRectangle({
        x: ux(a.x) + 2, y: uy(a.y) - 14, width: 18, height: 12, color: col,
        borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1,
      });
      if (a.text) {
        page.drawText(sanitizeWinAnsi(a.text).slice(0, 400), {
          x: ux(a.x) + 24, y: uy(a.y) - 12, size: 9, font: helv, color: rgb(0.15, 0.15, 0.15),
          maxWidth: 220, lineHeight: 11,
        });
      }
      break;
    }
    case 'stamp': {
      if (a.imageData) {
        const img = await getImage(a.imageData);
        page.drawImage(img, {
          x: ux(a.rect.x), y: uy(a.rect.y + a.rect.h),
          width: a.rect.w, height: a.rect.h, opacity,
        });
      } else {
        const size = Math.min(24, a.rect.h * 0.55);
        page.drawRectangle({
          x: ux(a.rect.x), y: uy(a.rect.y + a.rect.h), width: a.rect.w, height: a.rect.h,
          borderColor: col, borderWidth: 2,
        });
        const label = sanitizeWinAnsi(a.label || 'STAMP');
        const tw = helv.widthOfTextAtSize(label, size);
        page.drawText(label, {
          x: ux(a.rect.x + a.rect.w / 2) - tw / 2,
          y: uy(a.rect.y + a.rect.h / 2) - size * 0.36,
          size, font: helv, color: col,
        });
      }
      break;
    }
    default:
      break;
  }
}

// -------- watermarks / page numbers --------

function drawWatermarks(out, helv, wm) {
  const color = hexToRgb01(wm.color || '#d63031');
  const col = rgb(color.r, color.g, color.b);
  const pages = out.getPages();
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const pageRot = page.getRotation().angle || 0;
    if (wm.text) {
      const size = Number(wm.size) || 48;
      const tw = helv.widthOfTextAtSize(wm.text, size);
      const angle = (wm.diagonal ? 45 : 0) + pageRot;
      const rad = (angle * Math.PI) / 180;
      page.drawText(sanitizeWinAnsi(wm.text), {
        x: width / 2 - (tw / 2) * Math.cos(rad) + (size / 2) * Math.sin(rad),
        y: height / 2 - (tw / 2) * Math.sin(rad) - (size / 2) * Math.cos(rad),
        size, font: helv, color: col,
        opacity: Number(wm.opacity) || 0.2,
        rotate: degrees(angle),
      });
    }
    if (wm.pagenums) {
      const label = `${i + 1} / ${pages.length}`;
      const tw = helv.widthOfTextAtSize(label, 10);
      page.drawText(label, {
        x: width / 2 - tw / 2, y: 24, size: 10, font: helv, color: rgb(0.35, 0.35, 0.35),
      });
    }
  });
}

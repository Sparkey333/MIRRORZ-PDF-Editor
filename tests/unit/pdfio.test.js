// Unit tests for the pdf-lib export pipeline — the highest-risk code in the
// app. Exported bytes are re-parsed with pdf-lib and pdf.js to prove that
// annotations, forms, page ops, watermarks and metadata really land in the file.
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { exportPdf, stripManagedAnnotations, importAnnotations, listFormFields, fileToPdfBytes } from '../../src/pdfio.js';
import { makeSamplePdf, makeFormPdf, makeAnnotatedPdf } from '../fixtures/make-fixtures.mjs';

// pdf.js legacy build works in Node (no DOM needed for parsing/text)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

let sampleBytes, formBytes, annotatedBytes;

beforeAll(async () => {
  sampleBytes = await makeSamplePdf();
  formBytes = await makeFormPdf();
  annotatedBytes = await makeAnnotatedPdf();
});

function makeStore(bytes, pageCount = 3, docId = 'd1') {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    id: `p${i}`, docId, srcIndex: i, rotation: 0,
  }));
  return {
    state: { pages, annotations: [] },
    sources: new Map([[docId, { bytes, name: 'test.pdf', pdf: null }]]),
    formValues: {},
    meta: null,
    watermark: null,
    fileName: 'test.pdf',
  };
}

async function loadPdfjs(bytes) {
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}

function pageAnnots(doc, pageIdx) {
  const page = doc.getPage(pageIdx);
  const annots = page.node.Annots?.();
  if (!annots) return [];
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const d = doc.context.lookup(annots.get(i));
    if (d instanceof PDFDict) out.push(d);
  }
  return out;
}

function subtypeOf(dict) {
  return dict.get(PDFName.of('Subtype'))?.toString();
}

const ALL_ANNOTS = (pid = 'p0') => [
  { id: 'a1', pageId: pid, type: 'highlight', quads: [{ x: 70, y: 70, w: 120, h: 14 }], color: '#ffd400', opacity: 0.45, text: 'why' },
  { id: 'a2', pageId: pid, type: 'underline', quads: [{ x: 70, y: 100, w: 100, h: 12 }], color: '#00aa00', opacity: 1 },
  { id: 'a3', pageId: pid, type: 'strikeout', quads: [{ x: 70, y: 130, w: 90, h: 12 }], color: '#cc0000', opacity: 1 },
  { id: 'a4', pageId: pid, type: 'ink', strokes: [[{ x: 100, y: 200 }, { x: 150, y: 240 }, { x: 200, y: 210 }]], color: '#1a237e', opacity: 1, strokeWidth: 2 },
  { id: 'a5', pageId: pid, type: 'rect', rect: { x: 80, y: 300, w: 120, h: 60 }, color: '#e65100', opacity: 1, strokeWidth: 3 },
  { id: 'a6', pageId: pid, type: 'ellipse', rect: { x: 250, y: 300, w: 100, h: 50 }, color: '#2e7d32', opacity: 1, strokeWidth: 2 },
  { id: 'a7', pageId: pid, type: 'line', x1: 80, y1: 420, x2: 250, y2: 460, color: '#000000', opacity: 1, strokeWidth: 2 },
  { id: 'a8', pageId: pid, type: 'arrow', x1: 300, y1: 420, x2: 420, y2: 470, color: '#6a1b9a', opacity: 1, strokeWidth: 2 },
  { id: 'a9', pageId: pid, type: 'freetext', rect: { x: 90, y: 500, w: 200, h: 48 }, text: 'Hello\nMIRRORZ', fontSize: 14, color: '#d63031', opacity: 1 },
  { id: 'a10', pageId: pid, type: 'note', x: 400, y: 90, text: 'a sticky note', color: '#fbc02d', opacity: 1 },
  { id: 'a11', pageId: pid, type: 'whiteout', rect: { x: 60, y: 560, w: 140, h: 24 }, color: '#ffffff', opacity: 1 },
  { id: 'a12', pageId: pid, type: 'stamp', rect: { x: 330, y: 550, w: 130, h: 40 }, label: 'APPROVED', color: '#2e7d32', opacity: 1 },
  {
    id: 'a13', pageId: pid, type: 'stamp', rect: { x: 330, y: 620, w: 40, h: 40 }, opacity: 1,
    // 1x1 red PNG
    imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  },
];

describe('exportPdf — editable annotations mode', () => {
  it('writes every annotation type as a real PDF annotation with an appearance stream', async () => {
    const store = makeStore(sampleBytes);
    store.state.annotations = ALL_ANNOTS();
    const bytes = await exportPdf(store, { mode: 'annots' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const annots = pageAnnots(doc, 0);
    const subtypes = annots.map(subtypeOf).sort();
    expect(subtypes).toEqual([
      '/Circle', '/FreeText', '/Highlight', '/Ink', '/Line', '/Line',
      '/Square', '/Square', '/Stamp', '/Stamp', '/StrikeOut', '/Text', '/Underline',
    ].sort());
    // every annotation carries an /AP normal appearance so it renders anywhere
    for (const a of annots) {
      const apRaw = a.get(PDFName.of('AP'));
      const ap = apRaw instanceof PDFRef ? doc.context.lookup(apRaw) : apRaw;
      expect(ap, `missing AP for ${subtypeOf(a)}`).toBeInstanceOf(PDFDict);
      expect(ap.get(PDFName.of('N'))).toBeDefined();
    }
    // highlight carries QuadPoints
    const hl = annots.find((a) => subtypeOf(a) === '/Highlight');
    const qp = hl.get(PDFName.of('QuadPoints'));
    expect(qp).toBeInstanceOf(PDFArray);
    expect(qp.size()).toBe(8);
    // ink carries an InkList
    const ink = annots.find((a) => subtypeOf(a) === '/Ink');
    expect(ink.get(PDFName.of('InkList'))).toBeInstanceOf(PDFArray);
    // other pages untouched
    expect(pageAnnots(doc, 1)).toHaveLength(0);
  });

  it('round-trips: exported annotations can be re-imported for editing', async () => {
    const store = makeStore(sampleBytes);
    store.state.annotations = ALL_ANNOTS();
    const bytes = await exportPdf(store, { mode: 'annots' });
    const pdf = await loadPdfjs(bytes);
    const imported = await importAnnotations(pdf, ['q0', 'q1', 'q2']);
    const types = imported.map((a) => a.type).sort();
    // stamps are intentionally not re-imported (kept baked); all else comes back
    expect(types).toEqual([
      'arrow', 'ellipse', 'freetext', 'highlight', 'ink', 'line',
      'note', 'rect', 'strikeout', 'underline', 'whiteout',
    ].sort());
    const hl = imported.find((a) => a.type === 'highlight');
    expect(hl.pageId).toBe('q0');
    expect(hl.quads[0].x).toBeCloseTo(70, 0);
    expect(hl.quads[0].w).toBeCloseTo(120, 0);
    const ft = imported.find((a) => a.type === 'freetext');
    expect(ft.text).toContain('Hello');
  });
});

describe('exportPdf — flatten mode', () => {
  it('burns annotations into content with no annotation objects left', async () => {
    const store = makeStore(sampleBytes);
    store.state.annotations = ALL_ANNOTS();
    const bytes = await exportPdf(store, { mode: 'flatten' });
    const doc = await PDFDocument.load(bytes);
    expect(pageAnnots(doc, 0)).toHaveLength(0);
    // flattened text must be extractable from the content stream
    const pdf = await loadPdfjs(bytes);
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('APPROVED');
  });
});

describe('exportPdf — page composition', () => {
  it('respects reordering, deletion and blank pages', async () => {
    const store = makeStore(sampleBytes);
    // order: page 3, blank(400x500), page 1  (page 2 deleted)
    store.state.pages = [
      { id: 'p2', docId: 'd1', srcIndex: 2, rotation: 0 },
      { id: 'pb', docId: null, srcIndex: -1, rotation: 0, blank: { width: 400, height: 500 } },
      { id: 'p0', docId: 'd1', srcIndex: 0, rotation: 90 },
    ];
    const bytes = await exportPdf(store, { mode: 'annots' });
    const pdf = await loadPdfjs(bytes);
    expect(pdf.numPages).toBe(3);
    const t1 = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    expect(t1).toContain('needle3');
    const p2 = await pdf.getPage(2);
    expect(p2.view[2] - p2.view[0]).toBeCloseTo(400, 0);
    const p3 = await pdf.getPage(3);
    expect(p3.rotate).toBe(90);
  });

  it('exports a subset via pageIds (extract)', async () => {
    const store = makeStore(sampleBytes);
    const bytes = await exportPdf(store, { mode: 'annots', pageIds: ['p1'] });
    const pdf = await loadPdfjs(bytes);
    expect(pdf.numPages).toBe(1);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    expect(text).toContain('needle2');
  });

  it('merges pages from two sources', async () => {
    const store = makeStore(sampleBytes);
    store.sources.set('d2', { bytes: formBytes, name: 'form.pdf', pdf: null });
    store.state.pages.push({ id: 'pf', docId: 'd2', srcIndex: 0, rotation: 0 });
    const bytes = await exportPdf(store, { mode: 'annots' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
  });
});

describe('forms', () => {
  it('lists fields', async () => {
    const fields = await listFormFields(formBytes);
    expect(fields.map((f) => f.name).sort()).toEqual(['applicant.agree', 'applicant.name']);
    expect(fields.find((f) => f.name === 'applicant.name').type).toBe('text');
    expect(fields.find((f) => f.name === 'applicant.agree').type).toBe('checkbox');
  });

  it('fills fields and keeps them interactive after copyPages (rebuilt AcroForm)', async () => {
    const store = makeStore(formBytes, 1);
    store.formValues = { 'applicant.name': 'Brandon', 'applicant.agree': true };
    const bytes = await exportPdf(store, { mode: 'annots' });
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    const fields = form.getFields();
    expect(fields.length).toBe(2);
    expect(form.getTextField('applicant.name').getText()).toBe('Brandon');
    expect(form.getCheckBox('applicant.agree').isChecked()).toBe(true);
  });

  it('flatten mode makes form values permanent (no fields left)', async () => {
    const store = makeStore(formBytes, 1);
    store.formValues = { 'applicant.name': 'Brandon' };
    const bytes = await exportPdf(store, { mode: 'flatten' });
    const doc = await PDFDocument.load(bytes);
    let count = 0;
    try { count = doc.getForm().getFields().length; } catch { count = 0; }
    expect(count).toBe(0);
    const pdf = await loadPdfjs(bytes);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    expect(text).toContain('Brandon');
  });
});

describe('watermark, page numbers, metadata, optimize', () => {
  it('draws watermark text and page numbers into every page', async () => {
    const store = makeStore(sampleBytes);
    store.watermark = { text: 'CONFIDENTIAL', size: 48, opacity: 0.2, color: '#d63031', diagonal: true, pagenums: true };
    const bytes = await exportPdf(store, { mode: 'annots' });
    const pdf = await loadPdfjs(bytes);
    for (let i = 1; i <= 3; i++) {
      const text = (await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ');
      expect(text).toContain('CONFIDENTIAL');
      expect(text).toContain(`${i} / 3`);
    }
  });

  it('applies metadata overrides', async () => {
    const store = makeStore(sampleBytes);
    store.meta = { title: 'My Title', author: 'Me', subject: 'S', keywords: 'a, b' };
    const bytes = await exportPdf(store, { mode: 'annots' });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('My Title');
    expect(doc.getAuthor()).toBe('Me');
    expect(doc.getProducer()).toContain('MIRRORZ');
  });

  it('optimized save uses object streams and is not larger', async () => {
    const store = makeStore(sampleBytes);
    store.state.annotations = ALL_ANNOTS();
    const plain = await exportPdf(store, { mode: 'annots' });
    const opt = await exportPdf(store, { mode: 'annots', optimize: true });
    expect(opt.length).toBeLessThanOrEqual(plain.length);
    const doc = await PDFDocument.load(opt);
    expect(doc.getPageCount()).toBe(3);
  });
});

describe('import & strip of pre-existing annotations', () => {
  it('imports a highlight from a real PDF', async () => {
    const pdf = await loadPdfjs(annotatedBytes);
    const imported = await importAnnotations(pdf, ['x0']);
    expect(imported).toHaveLength(1);
    expect(imported[0].type).toBe('highlight');
    expect(imported[0].pageId).toBe('x0');
    expect(imported[0].quads).toHaveLength(1);
  });

  it('strips managed annotation subtypes but keeps pages intact', async () => {
    const stripped = await stripManagedAnnotations(annotatedBytes);
    expect(stripped).not.toBeNull();
    const doc = await PDFDocument.load(stripped);
    expect(doc.getPageCount()).toBe(1);
    expect(pageAnnots(doc, 0)).toHaveLength(0);
  });

  it('leaves widgets (form fields) alone when stripping', async () => {
    const stripped = await stripManagedAnnotations(formBytes);
    const doc = await PDFDocument.load(stripped);
    expect(doc.getForm().getFields().length).toBe(2);
  });
});

describe('file conversion', () => {
  it('converts a text file to a paginated PDF', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Line ${i} of the text file content.`).join('\n');
    const file = new File([long], 'notes.txt', { type: 'text/plain' });
    const { bytes, name } = await fileToPdfBytes(file);
    expect(name).toBe('notes.pdf');
    const pdf = await loadPdfjs(bytes);
    expect(pdf.numPages).toBeGreaterThanOrEqual(2);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    expect(text).toContain('Line 0');
  });

  it('passes PDFs through unchanged', async () => {
    const file = new File([sampleBytes], 'x.pdf', { type: 'application/pdf' });
    const { bytes } = await fileToPdfBytes(file);
    expect(bytes.length).toBe(sampleBytes.length);
  });

  it('rejects unsupported types', async () => {
    const file = new File([new Uint8Array(4)], 'x.exe', { type: 'application/octet-stream' });
    await expect(fileToPdfBytes(file)).rejects.toThrow(/Unsupported/);
  });
});

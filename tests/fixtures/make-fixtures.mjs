// Generate test fixture PDFs with pdf-lib (run automatically by tests).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

export async function makeSamplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`MIRRORZ test document — page ${i}`, {
      x: 72, y: 720, size: 18, font, color: rgb(0.1, 0.1, 0.3),
    });
    page.drawText('The quick brown fox jumps over the lazy dog.', {
      x: 72, y: 680, size: 12, font,
    });
    page.drawText(`Searchable token: needle${i}`, { x: 72, y: 650, size: 12, font });
  }
  doc.setTitle('MIRRORZ sample');
  return doc.save();
}

export async function makeFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Form test', { x: 72, y: 730, size: 16, font });
  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 72, y: 660, width: 220, height: 24 });
  const agree = form.createCheckBox('applicant.agree');
  agree.addToPage(page, { x: 72, y: 620, width: 18, height: 18 });
  return doc.save();
}

export async function makeAnnotatedPdf() {
  // a PDF that already carries a Highlight annotation (low-level)
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Existing highlight lives here', { x: 72, y: 700, size: 14, font });
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'Highlight',
    Rect: [70, 694, 300, 716],
    QuadPoints: [70, 716, 300, 716, 70, 694, 300, 694],
    C: [1, 0.9, 0], CA: 0.5, F: 4,
  });
  const ref = ctx.register(annot);
  const { PDFName } = await import('pdf-lib');
  page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return doc.save();
}

const isMain = process.argv[1] && process.argv[1].endsWith('make-fixtures.mjs');
if (isMain) {
  writeFileSync(join(here, 'sample.pdf'), await makeSamplePdf());
  writeFileSync(join(here, 'form.pdf'), await makeFormPdf());
  writeFileSync(join(here, 'annotated.pdf'), await makeAnnotatedPdf());
  console.log('fixtures written to', here);
}

// End-to-end tests: drive the real app in Chromium and verify saved PDFs by
// re-parsing the downloaded bytes with pdf-lib.
import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const SAMPLE = join(fixtures, 'sample.pdf');
const FORM = join(fixtures, 'form.pdf');
const ANNOTATED = join(fixtures, 'annotated.pdf');

async function openSample(page, file = SAMPLE) {
  await page.goto('/');
  await page.setInputFiles('#fileInput', file);
  await page.waitForSelector('#viewer .page canvas.pagecanvas', { timeout: 20000 });
}

async function savedPdf(page, mode = null) {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  if (mode) {
    await page.click('#btnSaveMenu');
    await page.click(`#saveMenu button[data-save="${mode}"]`);
  } else {
    await page.click('#btnSave');
  }
  const download = await dl;
  const path = await download.path();
  return { doc: await PDFDocument.load(readFileSync(path)), name: download.suggestedFilename() };
}

function subtypes(doc, pageIdx = 0) {
  const annots = doc.getPage(pageIdx).node.Annots?.();
  if (!annots) return [];
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const d = doc.context.lookup(annots.get(i));
    if (d instanceof PDFDict) out.push(d.get(PDFName.of('Subtype'))?.toString());
  }
  return out;
}

test.describe('viewer', () => {
  test('opens a PDF, renders pages, text layer and thumbnails', async ({ page }) => {
    await openSample(page);
    await expect(page.locator('#pageCount')).toHaveText('/ 3');
    await expect(page.locator('#viewer .page')).toHaveCount(3);
    await page.waitForSelector('#viewer .page .textLayer span');
    await expect(page.locator('#panel-thumbs .thumb')).toHaveCount(3);
    await expect(page.locator('#welcome')).toBeHidden();
  });

  test('zoom controls change page size', async ({ page }) => {
    await openSample(page);
    const before = (await page.locator('#viewer .page').first().boundingBox()).width;
    await page.selectOption('#zoomSelect', '0.5');
    await page.waitForTimeout(400);
    const after = (await page.locator('#viewer .page').first().boundingBox()).width;
    expect(after).toBeLessThan(before);
    expect(Math.round(after)).toBe(306); // 612pt * 0.5
  });

  test('search finds and counts matches', async ({ page }) => {
    await openSample(page);
    await page.click('#btnSearch');
    await page.fill('#searchInput', 'needle');
    await expect(page.locator('#searchCount')).toHaveText('1 / 3', { timeout: 10000 });
    await page.click('#searchNext');
    await expect(page.locator('#searchCount')).toHaveText('2 / 3');
    await expect(page.locator('.search-hit.current')).toHaveCount(1);
  });

  test('dark/light theme toggles', async ({ page }) => {
    await page.goto('/');
    const initial = await page.evaluate(() => document.documentElement.dataset.theme || 'dark');
    await page.click('#btnTheme');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(initial);
  });
});

test.describe('annotating', () => {
  test('ink drawing creates an annotation and saves as /Ink with AP', async ({ page }) => {
    await openSample(page);
    await page.click('[data-tool="ink"]');
    const pg = await page.locator('#viewer .page').first().boundingBox();
    await page.mouse.move(pg.x + 120, pg.y + 220);
    await page.mouse.down();
    await page.mouse.move(pg.x + 260, pg.y + 300, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1);

    const { doc } = await savedPdf(page);
    expect(subtypes(doc)).toContain('/Ink');
  });

  test('text selection highlight becomes a /Highlight annotation', async ({ page }) => {
    await openSample(page);
    await page.waitForSelector('#viewer .page .textLayer span');
    await page.click('[data-tool="highlight"]');
    const span = page.locator('#viewer .page .textLayer span').first();
    const box = await span.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('#panel-comments .comment-item')).toHaveCount(1);

    const { doc } = await savedPdf(page);
    expect(subtypes(doc)).toContain('/Highlight');
  });

  test('undo/redo works for annotations', async ({ page }) => {
    await openSample(page);
    await page.click('[data-tool="rect"]');
    const pg = await page.locator('#viewer .page').first().boundingBox();
    await page.mouse.move(pg.x + 100, pg.y + 100);
    await page.mouse.down();
    await page.mouse.move(pg.x + 220, pg.y + 180);
    await page.mouse.up();
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1);
    await page.click('#btnUndo');
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(0);
    await page.click('#btnRedo');
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1);
  });

  test('stamp placement', async ({ page }) => {
    await openSample(page);
    await page.click('[data-tool="stamp"]');
    await page.click('#stampGrid button:has-text("APPROVED")');
    const pg = await page.locator('#viewer .page').first().boundingBox();
    await page.mouse.click(pg.x + 300, pg.y + 300);
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1);
    const { doc } = await savedPdf(page);
    expect(subtypes(doc)).toContain('/Stamp');
  });

  test('flattened save leaves no annotation objects', async ({ page }) => {
    await openSample(page);
    await page.click('[data-tool="rect"]');
    const pg = await page.locator('#viewer .page').first().boundingBox();
    await page.mouse.move(pg.x + 100, pg.y + 100);
    await page.mouse.down();
    await page.mouse.move(pg.x + 200, pg.y + 160);
    await page.mouse.up();
    const { doc, name } = await savedPdf(page, 'flatten');
    expect(name).toContain('flattened');
    expect(subtypes(doc)).toHaveLength(0);
  });

  test('existing annotations are imported for editing and listed as comments', async ({ page }) => {
    await openSample(page, ANNOTATED);
    await expect(page.locator('#panel-comments .comment-item')).toHaveCount(1);
    await expect(page.locator('svg.annotLayer .annot')).toHaveCount(1);
    // saving keeps exactly one highlight (no duplicates from double-rendering)
    const { doc } = await savedPdf(page);
    expect(subtypes(doc)).toEqual(['/Highlight']);
  });
});

test.describe('page organization', () => {
  test('rotate and delete pages via organizer', async ({ page }) => {
    await openSample(page);
    await page.click('#btnOrganize');
    await expect(page.locator('#orgGrid .org-page')).toHaveCount(3);
    await page.click('#orgGrid .org-page:nth-child(2)');
    await page.click('#orgRotateR');
    await page.click('#orgGrid .org-page:nth-child(3)');
    await page.click('#orgDelete');
    await expect(page.locator('#orgGrid .org-page')).toHaveCount(2);
    await page.click('#orgClose');
    await expect(page.locator('#pageCount')).toHaveText('/ 2');

    const { doc } = await savedPdf(page);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  test('duplicate and blank pages', async ({ page }) => {
    await openSample(page);
    await page.click('#btnOrganize');
    await page.click('#orgGrid .org-page:nth-child(1)');
    await page.click('#orgDuplicate');
    await expect(page.locator('#orgGrid .org-page')).toHaveCount(4);
    await page.click('#orgBlank');
    await expect(page.locator('#orgGrid .org-page')).toHaveCount(5);
    const { doc } = await savedPdf(page);
    expect(doc.getPageCount()).toBe(5);
  });

  test('merging appends another PDF', async ({ page }) => {
    await openSample(page);
    await page.click('#btnMore');
    await page.click('#miMerge');
    await page.setInputFiles('#mergeInput', FORM);
    await expect(page.locator('#pageCount')).toHaveText('/ 4', { timeout: 15000 });
    const { doc } = await savedPdf(page);
    expect(doc.getPageCount()).toBe(4);
  });
});

test.describe('forms', () => {
  test('fills form fields and preserves them in the saved file', async ({ page }) => {
    await openSample(page, FORM);
    await page.click('.side-tab[data-panel="forms"]');
    const nameInput = page.locator('#panel-forms .form-field input[type="text"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Brandon');
    await page.locator('#panel-forms .form-field input[type="checkbox"]').check();

    const { doc } = await savedPdf(page);
    const form = doc.getForm();
    expect(form.getTextField('applicant.name').getText()).toBe('Brandon');
    expect(form.getCheckBox('applicant.agree').isChecked()).toBe(true);
  });
});

test.describe('non-PDF inputs', () => {
  test('opens a text file by converting it to PDF', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', {
      name: 'notes.txt', mimeType: 'text/plain',
      buffer: Buffer.from('Hello from a plain text file.\nSecond line.'),
    });
    await page.waitForSelector('#viewer .page canvas.pagecanvas', { timeout: 20000 });
    await expect(page.locator('#pageCount')).toHaveText('/ 1');
  });

  test('opens a PNG image as a PDF page', async ({ page }) => {
    // 1x1 red pixel PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    await page.goto('/');
    await page.setInputFiles('#fileInput', { name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#viewer .page canvas.pagecanvas', { timeout: 20000 });
    await expect(page.locator('#pageCount')).toHaveText('/ 1');
  });
});

test.describe('privacy', () => {
  test('makes zero network requests after load (fully offline behaviour)', async ({ page }) => {
    const external = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (!url.startsWith('http://localhost:4173')) external.push(url);
      route.continue();
    });
    await openSample(page);
    // annotate + save to exercise the full pipeline
    await page.click('[data-tool="rect"]');
    const pg = await page.locator('#viewer .page').first().boundingBox();
    await page.mouse.move(pg.x + 80, pg.y + 80);
    await page.mouse.down();
    await page.mouse.move(pg.x + 160, pg.y + 140);
    await page.mouse.up();
    await savedPdf(page);
    expect(external).toEqual([]);
  });
});

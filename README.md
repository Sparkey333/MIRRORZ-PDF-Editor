# MIRRORZ PDF Editor

A fast, private, **offline** PDF viewer, annotator and editor that runs entirely in your
browser. No uploads, no account, no watermarks, no limits — your files never leave your
device.

Built from deep research into the open-source PDF ecosystem and years of user reviews of
the leading PDF apps (Adobe Acrobat, Foxit, Nitro, PDFelement, PDF Expert, Xodo,
Smallpdf, iLovePDF, Sejda). The five improvements users ask for most — and never get —
are the foundation of this app, not an afterthought. See
[docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) and [docs/RESEARCH.md](docs/RESEARCH.md).

## Download & use offline (no install, no server)

Grab **[`downloads/MIRRORZ-PDF-Editor-offline.html`](downloads/MIRRORZ-PDF-Editor-offline.html)**
— the entire app in a single HTML file. Save it anywhere, double-click it, and it works
forever, fully offline. That file is the product: viewer, annotator, editor, everything.

Or run the hosted/dev version:

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build in dist/ (for hosting)
npm run build:single   # rebuild the single-file offline app into downloads/
```

## Features

**View** — open PDFs (drag & drop or picker), images (PNG/JPG/WebP) and text files
(auto-converted to PDF); continuous scrolling with lazy rendering; zoom presets +
fit-width/fit-page; page thumbnails; outline/bookmarks; full-text search with highlighted
hits; text selection layer; dark/light theme; keyboard shortcuts throughout; recent files
(stored only on this device); password-protected PDFs.

**Annotate** — highlight, underline and strikeout from real text selection; sticky
notes; free text; freehand ink; rectangles, ellipses, lines and arrows; whiteout;
draw-or-type signatures; stamps (APPROVED, DRAFT, …); place images; per-annotation
color, width and opacity; move/resize/edit/delete; comments sidebar with export to text;
full undo/redo.

**Annotations are real PDF annotations.** Saves write standard annotation objects
(`/Highlight`, `/Ink`, `/FreeText`, …) *with generated appearance streams*, so they
render in Acrobat, Preview, browsers — everywhere — and stay editable. Re-opening a PDF
in MIRRORZ imports its existing annotations back into the editor. A separate
**flatten** mode burns everything permanently into the page.

**Edit & organize** — reorder pages by drag & drop; rotate; delete; duplicate; insert
blank pages; extract selected pages to a new PDF; merge multiple PDFs; watermarks and
page numbers; document properties (title/author/subject/keywords); optimized (smaller)
saves; print.

**Forms** — list and fill AcroForm fields (text, checkbox, radio, dropdown), save
filled forms that stay interactive in other viewers, or flatten them permanently.

## The five improvements users have begged the big PDF apps for

| # | Years-old complaint (every major app) | Built into MIRRORZ |
|---|---|---|
| 1 | Subscription traps, cancellation fees, upsell nags | Free for personal use forever; optional Pro is $5/mo or **$69 once** — a real perpetual license, never revoked ([docs/PRICING.md](docs/PRICING.md)) |
| 2 | Forced cloud upload & accounts (privacy) | 100% client-side; the e2e suite asserts **zero network requests**; no account, no telemetry |
| 3 | Bloat, slow startup, hangs on large files | Single lightweight page, instant start, lazy page rendering, work in a background worker |
| 4 | Crippled free tiers: watermarks, size/task caps | No watermarks, no file-size limits, no daily task caps, no pay-to-save |
| 5 | Clunky UI, fragile text editing | Task-first single toolbar; honest tools (whiteout is labeled cosmetic, not "redaction"); annotations that don't break the document |

## Testing

```bash
npm test                # 42 unit tests (vitest): export pipeline, annots, forms, pages
npm run test:e2e        # 17 end-to-end tests (Playwright): real browser, real saves
```

The e2e suite re-parses every downloaded PDF with pdf-lib to prove annotations, page
operations and form values actually land in the file — and includes a privacy test that
fails if the app makes a single network request.

## Architecture

- **[Mozilla pdf.js](https://github.com/mozilla/pdf.js)** (Apache-2.0) — rendering, text
  layer, search, outline, annotation parsing. Legacy build for wide browser support;
  worker bundled inline so everything works offline.
- **[pdf-lib](https://github.com/Hopding/pdf-lib)** (MIT) — document writing: page
  composition, merge/extract, form filling, and a custom low-level **annotation writer**
  that emits standard annotation dictionaries + appearance streams
  ([src/pdfio.js](src/pdfio.js)).
- Vanilla JS + Vite. No framework, no server, no state outside your browser.

All dependencies are permissively licensed (Apache-2.0/MIT) — verified against the
copyleft traps in this space (MuPDF/Ghostscript/iText are AGPL). Details in
[docs/RESEARCH.md](docs/RESEARCH.md).

## Docs

- [docs/RESEARCH.md](docs/RESEARCH.md) — the full research: OSS landscape, library
  capabilities, review mining, feature parity, market pricing
- [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) — the top-5 improvements, with receipts
- [docs/FEATURES.md](docs/FEATURES.md) — feature matrix vs. the paid editors + honest
  limitations + roadmap
- [docs/PRICING.md](docs/PRICING.md) — free/pro pricing model and the fairness math

## License

Apache-2.0. Free for personal use as shipped; the planned Pro tiers cover commercial
use and future power features ([docs/PRICING.md](docs/PRICING.md)).

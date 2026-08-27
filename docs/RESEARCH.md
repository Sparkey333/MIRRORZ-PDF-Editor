# Research: building a DIY PDF viewer/editor

Deep research performed August 2026 across GitHub, npm, vendor sites, and years of user
reviews (G2, Capterra, Trustpilot, Reddit, vendor forums). Six parallel research passes:
open-source landscape, JS/WASM library capabilities, user-complaint mining, premium
feature parity, pricing, and a verification pass that closed gaps by running code
against the real libraries.

## 1. Open-source landscape (what exists, what we can use)

**Permissive building blocks (safe for a future commercial product):**

- **Mozilla pdf.js** (Apache-2.0, ~54k stars, pdfjs-dist 6.2.x) — the de-facto
  client-side renderer: canvas rendering, selectable/searchable text layer, outline,
  AcroForm rendering, annotation parsing. Proves everything MIRRORZ's viewer does is
  possible in a browser. *Node-side use requires the `legacy` build.*
- **pdf-lib** (MIT, ~8.6k stars) — pure-JS PDF writing: create/modify, copyPages
  (merge/split/reorder), embed images/fonts, draw text/shapes, fill/flatten forms.
  Original repo unmaintained since ~2021; the maintained MIT fork **@cantoo/pdf-lib**
  adds encrypted-PDF loading, AES-128/256 `encrypt()` on save, and SVG drawing — the
  designated upgrade path for password features.
- **PDFium** (Apache/BSD — the only permissive production-grade native engine) via WASM
  (`@embedpdf/pdfium`, `pdfium-lib`) — fallback engine if pdf.js ever falls short.
- **EmbedPDF** (~4.4k stars) — closest existing analog to MIRRORZ: headless client-side
  viewer SDK on PDFium WASM with annotation/redaction/search plugins. SDK packages are
  permissive (Apache-2.0/MIT); only its optional cloud *server* is Fair Core licensed.
  Both a validation and an architecture reference.
- **pdfcpu** (Go, Apache-2.0) and **qpdf** (Apache-2.0) — WASM-able byte-level tools
  (compress, linearize, encrypt) for later roadmap items.
- **Tesseract.js** (Apache-2.0) — client-side OCR for the roadmap.

**Copyleft — study, never embed:** MuPDF/mupdf.js (AGPL, dual-licensed by Artifex),
Ghostscript (AGPL), iText (AGPL), PDFsam (AGPL), Xournal++ (GPL — best-in-class ink UX
to learn from), Okular (GPL), PDF Arranger (GPL-3.0 — the canonical page-organizer UX),
SumatraPDF (GPL).

**Market validation:** Stirling-PDF (~91k stars, the biggest PDF project on GitHub) is a
*server-side* Java toolbox that moved to open-core with paid tiers in 2025 — proving
(a) enormous demand for a self-controlled PDF toolbox, (b) open-core monetization works,
and (c) the gap MIRRORZ attacks: Stirling needs a server; MIRRORZ runs 100% in the
browser. Commercial SDK pricing (Apryse, Nutrient/PSPDFKit) confirms a real paid market
for exactly this feature set.

## 2. Library capabilities (verified empirically, not just from docs)

The verification pass ran actual code against the installed packages:

- **pdf.js exposes exact text geometry** — `getTextContent()` items carry
  `transform`, `width`, `height` per run: everything needed to compute QuadPoints for
  Highlight/Underline/StrikeOut annotations. *(Used by MIRRORZ's selection-to-quads
  pipeline.)*
- **pdf-lib preserves existing annotations** across load→save, save-after-modify, and
  copyPages — the strip/re-add round-trip architecture is sound. But `embedPage()`
  strips all annotations (issues #849/#606): never use it for page composition.
- **pdf-lib `copyPages` orphans AcroForm fields** (issues #1205/#1240/#1615): widgets
  are copied onto pages but never registered in the destination catalog, so filled forms
  break in Acrobat after a merge. *MIRRORZ works around this by (a) baking field
  appearances before copying and (b) rebuilding a minimal AcroForm from the copied
  widget dictionaries — covered by unit tests.*
- **pdfjs-dist 6.x needs its legacy build** outside very new browsers/Node (the modern
  build uses bleeding-edge JS like `Map.getOrInsertComputed`). MIRRORZ ships the legacy
  build for compatibility.
- What is genuinely hard client-side: true reflow editing of existing text,
  content-stream redaction, PDF/A, digital signature certificates. See
  [FEATURES.md](FEATURES.md) for how MIRRORZ handles each honestly.

**The standard architecture** (validated across open-source editors): keep original
bytes in memory → pdf.js renders display + text layer → own overlay/state model for
edits → pdf-lib writes the final file. MIRRORZ follows it, with one refinement: on open,
existing markup annotations are imported into the editable model and *stripped* from the
working bytes, so nothing double-renders and every annotation stays editable.

## 3. User-complaint mining → the top 5 improvements

Nine apps (Adobe Acrobat Pro/Reader, Foxit, Nitro, PDFelement, PDF Expert, Xodo,
Smallpdf, iLovePDF, Sejda), years of reviews. Five themes recur with striking unanimity
— full detail with sources in [IMPROVEMENTS.md](IMPROVEMENTS.md):

1. **Subscription/billing hostility** (every single app): cancellation fees up to
   ~$315, auto-renew traps, "lifetime" licenses retroactively downgraded (PDFelement,
   PDF Expert, Nitro), relentless upsell popups. "Expensive" is Acrobat's #1 G2 con
   (224 mentions).
2. **Privacy / forced cloud & accounts**: Smallpdf and iLovePDF upload every file;
   security reviews flag both as unsuitable for medical/legal/tax documents; Adobe
   forces sign-in and phones home every 30 days.
3. **Bloat & slowness**: 15–30 s hangs opening PDFs in Acrobat across multi-year
   threads; 43% of Foxit reviewers cite lag; Nitro's top con is crashes on large files.
4. **Crippled free tiers**: Sejda's 3-tasks-per-hour wall, PDFelement's edit-free/
   pay-to-save giant watermark, Xodo's 1 action/day, iLovePDF's caps and ads.
5. **Clunky UI & fragile text editing**: Adobe's 2023 redesign backlash (thousands of
   complaints); font substitution silently breaking layout across Sejda/Foxit/others.

## 4. Premium feature parity

The paid tier of Acrobat Pro / Foxit / Nitro / PDFelement / PDF Expert clusters into
VIEW / ANNOTATE / EDIT / FORMS / ADVANCED. Roughly **70% of the canonical checklist is
fully feasible client-side** with the permissive stack. The build priority recommended
by research — all of VIEW, an annotation writer over pdf-lib for full ANNOTATE, page
organization + watermarks + forms for EDIT/FORMS — is exactly what MIRRORZ v1 ships.
Feature-by-feature matrix: [FEATURES.md](FEATURES.md).

## 5. Pricing research

- Adobe anchors the top: Acrobat Standard $14.99/mo, Pro $19.99/mo (annual commitment;
  $239.88/yr), **no perpetual option**.
- Mid-tier: Foxit ~$129–160/yr (+$209.99 perpetual ≈1.6× annual), PDFelement $79.99/yr
  (+$129.99 perpetual), Xodo $9.99/mo, PDF Expert ~$79.99/yr (+~$79.99–139.99 lifetime).
  Nitro killed true perpetual licenses and is deactivating old ones — the single most
  trust-destroying move in the market.
- Web tools: Smallpdf ~$9–15/mo, Sejda $7.50/mo (with a clever non-renewing $5 week
  pass), iLovePDF ~$5–9/mo.
- Indie/offline band (MIRRORZ's real competitive set): PDF-XChange $62–79 one-time,
  UPDF $79.99 lifetime, deal-site lifetimes $20–70. Free floor: PDFgear, PDF24,
  Stirling.
- SaaS guidance: price lifetime at ~12–16× monthly; scope "lifetime" in writing;
  never revoke.

Resulting MIRRORZ model (full rationale in [PRICING.md](PRICING.md)): **Free** (personal,
forever, no limits) / **$5 monthly** / **$39 annual** / **$69 lifetime** — 13.8× monthly
and 1.77× annual, deliberately the buyer's side of the fair band.

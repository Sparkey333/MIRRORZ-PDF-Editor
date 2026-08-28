# Feature matrix

MIRRORZ v1 versus the canonical premium checklist assembled from Adobe Acrobat Pro,
Foxit PDF Editor, Nitro PDF Pro, PDFelement Pro and PDF Expert Premium
(see [RESEARCH.md](RESEARCH.md) §4).

Legend: ✅ shipped · 🔶 shipped with noted limits · 🗺 roadmap · ✖ deliberately not shipped

## VIEW

| Feature | Status | Notes |
|---|---|---|
| Open PDFs (drag & drop, picker, multi-file) | ✅ | multi-select merges into one document |
| Open images (PNG/JPG/WebP) as PDF | ✅ | auto-converted client-side |
| Open text files (.txt/.md/.csv/.log) as PDF | ✅ | wrapped & paginated |
| Password-protected PDFs | 🔶 | opens with password; saving re-writes without encryption (encrypt-on-save is roadmap via @cantoo/pdf-lib) |
| Continuous scroll, lazy rendering | ✅ | large files stay fast |
| Zoom presets, fit-width, fit-page | ✅ | keyboard +/− |
| Page thumbnails sidebar | ✅ | lazy-rendered |
| Outline / bookmarks sidebar | ✅ | click-to-jump |
| Full-text search with highlighted hits | ✅ | match count, next/prev, cross-line matches |
| Text selection & copy | ✅ | pdf.js text layer |
| Dark / light theme | ✅ | remembered locally |
| Recent files | ✅ | stored only in this browser (IndexedDB) |
| Print | ✅ | via the browser's native PDF print |
| Tabs (multiple documents) | 🗺 | one document per tab today (browser tabs work) |

## ANNOTATE

| Feature | Status | Notes |
|---|---|---|
| Highlight / underline / strikeout from text selection | ✅ | real QuadPoint annotations |
| Sticky notes | ✅ | with popup text |
| Free text | ✅ | inline editing, font size, color |
| Freehand ink | ✅ | pressure-free smooth strokes |
| Shapes: rectangle, ellipse, line, arrow | ✅ | color/width/opacity |
| Whiteout (cover content) | 🔶 | **cosmetic only — explicitly not redaction** |
| Signatures (draw or type) | ✅ | placed as image stamps |
| Stamps (APPROVED, DRAFT, …) | ✅ | 9 built-ins |
| Place images | ✅ | PNG/JPG/WebP |
| Select, move, resize, recolor, delete | ✅ | plus arrow-key nudge |
| Undo / redo | ✅ | 60 levels |
| Comments sidebar + export summary | ✅ | text export |
| **Saved as real PDF annotations with appearance streams** | ✅ | render everywhere, stay editable; unit-tested for all 13 types |
| Re-import existing annotations for editing | ✅ | on open; originals stripped so nothing double-renders |
| Flatten (burn-in) mode | ✅ | separate save option |
| Squiggly, cloud, polygon, replies, XFDF | 🗺 | annotation writer already supports adding these |

## EDIT & ORGANIZE

| Feature | Status | Notes |
|---|---|---|
| Reorder pages (drag & drop grid) | ✅ | multi-select with Ctrl/Shift |
| Rotate / delete / duplicate pages | ✅ | |
| Insert blank pages | ✅ | |
| Extract selected pages → new PDF | ✅ | this is also "split" |
| Merge PDFs | 🔶 | full page merge; forms from *merged-in* files keep working via rebuilt AcroForm (see RESEARCH §2 on the upstream pdf-lib bug) |
| Watermark text | ✅ | size/opacity/color/diagonal, applied at save |
| Page numbers | ✅ | bottom-center at save |
| Document properties (title/author/subject/keywords) | ✅ | |
| Optimized save | 🔶 | lossless (object streams); image recompression is roadmap |
| Add text / images to pages | ✅ | via free text & image annotations (flatten to make permanent) |
| Edit *existing* page text with reflow | ✖→🗺 | the most complained-about broken feature in the category when done cheaply (font substitution). Not half-shipped. Cover-and-retype works today (whiteout + text); true editing is roadmap behind a quality bar |
| Crop, headers/footers, Bates numbering | 🗺 | straightforward pdf-lib additions |

## FORMS

| Feature | Status | Notes |
|---|---|---|
| List & fill text/checkbox/radio/dropdown fields | ✅ | forms panel |
| Save filled forms, still interactive elsewhere | ✅ | appearances baked + AcroForm rebuilt (unit-tested against Acrobat-breaking upstream bug) |
| Flatten forms | ✅ | via flatten save |
| Create new form fields | 🗺 | pdf-lib supports it; UI to come |

## ADVANCED (the classic "Pro-only" tier)

| Feature | Status | Notes |
|---|---|---|
| OCR (searchable scans) | 🗺 | Tesseract.js (Apache-2.0), fully client-side; planned as a Pro feature |
| True redaction | 🗺 | planned as rasterize-and-rebuild with metadata stripping — never a black box; whiteout is clearly labeled cosmetic today |
| Encrypt / password-protect on save | 🗺 | via @cantoo/pdf-lib AES-256 |
| Compress with image downsampling | 🗺 | canvas-based recompression |
| Document compare | 🗺 | Acrobat-Pro-only in the market, feasible client-side — strong Pro differentiator |
| Office (Word/Excel) conversion | ✖ | not feasible to commercial quality client-side; being honest about it beats shipping the "inaccurate conversion" every competitor gets panned for |
| E-sign with certificates | 🗺 | drawn/typed signatures ship today; cryptographic signing is roadmap |

## Why this line-up

Research (RESEARCH §4) shows ~70% of the premium checklist is fully feasible
client-side; v1 ships essentially all of that 70%. The rest is either roadmap (OCR,
redaction, encryption, compare — all client-side feasible with permissive libraries)
or deliberately excluded where the honest answer is that browser tech can't match
desktop quality yet (Office conversion, reflow text editing) — the exact features
whose cheap implementations generate the loudest complaints about competitors.

# The top 5 improvements users have asked the big PDF apps for — built in

Method: mined years of reviews and forum threads for the nine dominant PDF apps —
Adobe Acrobat Pro/Reader, Foxit PDF Editor, Nitro PDF Pro, Wondershare PDFelement,
PDF Expert (Readdle), Xodo, Smallpdf, iLovePDF, Sejda — across G2, Capterra,
Trustpilot, Reddit, MacRumors and the vendors' own communities (research pass run
August 2026). Ranked by how unanimously the complaint recurs across apps and years.

---

## 1. Honest pricing — no subscription traps, no revoked "lifetimes"

**The complaint (every one of the 9 apps):** early-cancellation fees of $85–$314.96
reported by Adobe Trustpilot reviewers, with deliberately difficult cancel flows;
"Expensive" is Acrobat's most-mentioned G2 con (224 mentions); Smallpdf users
auto-renewed into $108/yr with no reminder; iLovePDF refund refusals; PDFelement
retroactively re-imposed watermarks and OCR paywalls on "perpetual" owners after v9;
Readdle "lied about the lifetime in version 2" (MacRumors users) when PDF Expert went
subscription; Nitro is deactivating already-sold perpetual licenses by end of 2026;
Xodo cut its free tier to 1 action/day after acquisition; Adobe Reader is "almost
unusable with all these popups".

**Built into MIRRORZ:**
- The free tier is the full product for personal use, forever. Not a trial.
- Pro is $5/mo (cancel anytime, no fee), $39/yr, or **$69 once** — the one-time price
  is deliberately *below* the fair 12–15× monthly band so committed buyers get the deal.
- "Lifetime" is scoped in writing ([PRICING.md](PRICING.md)) and can't be revoked even
  if the business disappears: the app is a single offline file that keeps working.
- Zero upsell popups in the product. The pricing screen exists only behind the menu.

## 2. Privacy — offline by architecture, not by promise

**The complaint:** Smallpdf and iLovePDF process every file server-side; independent
2025–26 security reviews conclude neither should be used for medical PHI,
attorney-client documents, tax returns or financial statements. Adobe forces Adobe ID
sign-in, validates licenses online every 30 days, and mines usage for upsells.
PDF Expert 3 forced account creation on paid customers.

**Built into MIRRORZ:**
- Everything — rendering, annotating, page surgery, form filling, saving — runs in the
  browser. There is no server to upload to.
- No account, no sign-in, no telemetry, no ads. Recent files live in your browser's
  local storage only.
- **Enforced by test:** the e2e suite ([tests/e2e/app.spec.js](../tests/e2e/app.spec.js))
  opens, annotates and saves a document while asserting the app makes **zero** network
  requests.
- The downloadable single-file build works from a double-click with no network at all.

## 3. Speed — instant startup, responsive on large files

**The complaint:** multi-year Adobe threads titled "acrobat unusably slow" (20–30 s
black-screen launches, 15–30 s hangs opening any PDF); 43% of 4,180+ aggregated Foxit
reviews cite lag; Nitro's top Capterra cons are freezes and crashes that lose open
documents on large PDFs.

**Built into MIRRORZ:**
- The whole app is one small page (~740 KB gzipped, including the entire PDF engine).
  Startup is effectively instant — there is nothing to install and no splash screen.
- Pages render lazily (IntersectionObserver) — a 500-page file opens as fast as a
  5-page one; only visible pages are rasterized.
- PDF parsing/rendering runs in a background worker; the UI thread stays responsive.
- Thumbnails and page-organizer previews are also lazy.

## 4. A free tier that isn't bait — no watermarks, no caps

**The complaint:** Sejda's 3-tasks-per-hour wall (which resets on the clock hour) and
50 MB/200-page caps; PDFelement's classic bait pattern — edit free, then a giant
watermark unless you pay at save time; iLovePDF's daily task limits and ads; Xodo's
1 action/day; Smallpdf's ~2 tasks/day funneling into trials.

**Built into MIRRORZ:**
- No watermarks on anything, ever. The watermark tool exists for *your* documents.
- No file-size limits, no page limits, no per-day task counters, no pay-to-save.
- Saving, merging, extracting, flattening, forms — all in the free tier.
- The paid tiers add commercial licensing and power features on top; they never
  subtract from the free tier ([PRICING.md](PRICING.md)).

## 5. A simple UI that doesn't wreck documents

**The complaint:** Adobe's 2023 UI redesign drew thousands of complaints
("counterintuitive, illogical, imposes a huge productivity hit") and 100 "learning
curve" mentions on G2; Foxit's dense ribbon is repeatedly called hard to navigate. On
the editing side the most common functional failure across editors: text edits silently
substitute fonts and break layout with no warning (Sejda: "it changes the fonts
completely").

**Built into MIRRORZ:**
- One toolbar, task-first: open → annotate → save. Every tool has a keyboard shortcut
  and a tooltip; a shortcuts card is one click away. No ribbons, no modes, no upsells.
- Tools are honest about what they do: whiteout is labeled as a cosmetic cover (not
  "redaction"); flatten vs. editable-annotations save is an explicit, explained choice.
- Annotations are written as standard PDF annotations with proper appearance streams —
  they render identically in Acrobat/Preview/browsers and never touch the underlying
  page content, so MIRRORZ cannot corrupt your document's text or fonts.
- True text *reflow* editing of existing content is deliberately not half-shipped —
  research showed font-substitution text editing is the most complained-about broken
  feature in the category. It's on the roadmap behind a quality bar
  ([FEATURES.md](FEATURES.md)) rather than shipped badly.

# Pricing model

Goal (from the project brief): free and offline for personal use first; later sold
online with **both** a monthly subscription and a one-time purchase, balanced fairly,
with a slight deal for the buyer. Grounded in the market research in
[RESEARCH.md](RESEARCH.md) §5. The in-app pricing screen renders from
[`src/pricing.js`](../src/pricing.js) — one source of truth.

## The tiers

| Tier | Price | What it adds |
|---|---|---|
| **Free** | $0 forever | The full core product for personal use: view, annotate, edit, organize, merge, forms, export. No watermarks, no size/task caps, no account, offline. |
| **Pro Monthly** | **$5 / month** | Commercial-use license, batch operations, saved signature/stamp libraries, priority support & feature votes. Cancel anytime, zero fees. |
| **Pro Annual** | **$39 / year** | Everything in Monthly at $3.25/mo effective (35% off) — one payment, one reminder before renewal. |
| **Pro Lifetime** | **$69 one-time** | Everything in Pro, forever. All 1.x updates + security fixes; 2.0 at 50% off. |

## The fairness math (the "slight deal for the buyer")

- **Lifetime vs monthly:** $69 / $5 = **13.8×** — inside the industry-recommended
  12–15× band, and *under* 12 × $5.99-style pricing games. A buyer who would have
  subscribed ~14 months or longer comes out ahead; that's the deal, stated openly.
- **Lifetime vs annual:** $69 / $39 = **1.77×** — exactly the market norm observed at
  Foxit (~1.6×), PDFelement (~1.6×), Xodo (~2×), UPDF (~1.6×).
- **Vs the market:** the monthly undercuts Smallpdf ($9–15), Xodo ($9.99) and Sejda
  ($7.50); the lifetime sits below UPDF's $79.99 and far below Foxit's $209.99
  perpetual, while staying above throwaway $20 deal-site tools. The marketing line
  writes itself: *Acrobat Pro is $239.88 every year with no lifetime option; MIRRORZ
  Pro is $69 once.*

## Non-negotiable commitments (the anti-complaint contract)

Directly derived from the #1 complaint cluster in [IMPROVEMENTS.md](IMPROVEMENTS.md):

1. **The free tier never shrinks.** No watermarks, upload requirements, size caps or
   task caps will ever be added to it (the PDFelement/Xodo bait pattern is the single
   fastest way to burn trust in this market).
2. **Lifetime means lifetime.** Licenses are never revoked or retroactively downgraded
   (the Nitro/PDFelement failure). Scope in writing: lifetime = every 1.x release +
   security fixes; major paid upgrades (2.0) at 50% off for lifetime holders, optional.
3. **It works even if we vanish.** The product is an offline file; a purchased copy
   keeps working forever with no activation server.
4. **Cancellation is one click, no fees, no retention flows.** (Adobe's cancellation
   fees are its most-cited Trustpilot complaint.)
5. **No upsell nags inside the product.** Pricing lives behind a menu item.

## Launch tactic (when going on sale)

- Early-bird "founder's license" at **$49** for the first 3–6 months, then the
  permanent $69 — early buyers grandfathered forever.
- Consider Sejda's well-liked non-renewing **week pass** (~$5, explicitly does not
  auto-renew) as a trust-building later addition for one-off commercial jobs.
- Gate Pro by *use-case and power features* (commercial use, batch, OCR when it lands,
  compare, encryption presets) — never by crippling the core.

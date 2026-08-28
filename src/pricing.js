// Pricing model — the single source of truth for tiers shown in-app and in
// docs/PRICING.md. Numbers come from the market research in docs/RESEARCH.md:
// the in-browser competitor band clears at ~$5-10/mo or $60-110/yr; the indie
// offline band sells lifetime licenses at $50-80; and "subscription fatigue" +
// billing traps are the #1 complaint across every major PDF app. MIRRORZ
// prices at the credible bottom of the market and makes the one-time license
// a genuine (slight) deal for the buyer: $69 / $5 = 13.8x monthly, inside the
// recommended 12-15x lifetime band, and 1.77x annual — the market norm.
export const PRICING = {
  free: {
    name: 'Free',
    price: '$0',
    per: 'forever · offline',
    features: [
      'View, annotate & edit without limits',
      'No watermarks, no file-size caps, no task caps',
      '100% offline — files never uploaded, no account',
      'Personal use, free forever (not a trial)',
    ],
  },
  monthly: {
    name: 'Pro Monthly',
    price: '$5',
    per: 'per month · cancel anytime, no fees',
    features: [
      'Everything in Free, licensed for commercial use',
      'Batch operations across many files',
      'Saved signature & stamp libraries',
      'Priority support & feature votes',
    ],
  },
  annual: {
    name: 'Pro Annual',
    price: '$39',
    per: 'per year · $3.25/mo effective',
    features: [
      'Everything in Pro Monthly',
      '35% off the monthly price',
      'One payment, one reminder before renewal',
    ],
  },
  lifetime: {
    name: 'Pro Lifetime',
    price: '$69',
    per: 'one-time · yours forever',
    badge: 'Best value',
    features: [
      'Everything in Pro',
      'Beats monthly after 14 months (13.8×) — you get the deal',
      'All 1.x updates + security fixes included; 2.0 at 50% off',
      'Works offline forever — even if we disappear',
    ],
  },
  footnote:
    'The one-time price is deliberately a slight deal for the buyer: $69 is under 14× the $5 monthly ' +
    '(the fair 12–15× band) and 1.77× the annual — the market norm. Compare: Acrobat Pro is $239.88 ' +
    'every year with no lifetime option; MIRRORZ Pro is $69 once. Lifetime means lifetime: licenses ' +
    'are never revoked or downgraded, and the free tier never grows watermarks or limits.',
};

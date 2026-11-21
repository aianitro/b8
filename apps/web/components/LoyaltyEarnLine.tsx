// Loyalty (P8-42b2) — what a linked card's spend should have earned since the last reading, and how
// the last estimate compared with what the program then reported. Shown on the membership's line on
// /travel and under "Earns into" on the card's own /accounts/[id] page, so the wording lives here once
// and the two pages cannot drift apart.
//
// NO HOOKS AND NO 'use client', like `LoyaltyFeeWatchLine`: it renders on whichever side imports it.
// Every figure and date arrives decided by the server — priced, summed and rounded once by Postgres,
// dates as `YYYY-MM-DD` text — so nothing here does arithmetic, compares a date or reads a clock.
// Digits are grouped by the shared `formatBalance`, which works on text; a second formatter, or a
// figure passed through a JS number, could print a different figure than the API carries.
//
// ESTIMATED, EVERYWHERE. The figure is a model, not a balance: every figure carries the word, and
// the scope sentence says what the model leaves out. No per-rule, per-merchant or per-row breakdown
// is shown — the view carries none, and a breakdown would be row-derived text on a page whose gift
// class is `numeric-only`.
//
// ABSENCE IS A PHRASE. A card with no earn rates says so; a unit with no per-currency earn (nights)
// says so; neither is ever a zero. A real zero — rates set, nothing spent — is a figure and shows as
// one. An unlinked membership renders nothing at all: its rates are kept, but there is no card to
// estimate.
//
// The text of each sentence sits in ONE element with no nested tags, so the page reads as one
// sentence — the approximate sign, the formatted figure, then the period's start — and the surface
// check can find it whole.
//
// TWO PALETTES, ONE SHAPE, as the fee line: /travel is `gray-*`, the accounts pages `slate-*`. "Worth
// a look" is the design system's warning amber, and appears only when the server's flag is true.

import type { LoyaltyMembership } from '@b8/contracts/loyalty';
import { formatBalance } from '@/lib/domain/loyalty';

const INK = {
  gray: { base: 'text-gray-500', strong: 'text-gray-700', muted: 'text-gray-400' },
  slate: { base: 'text-slate-500', strong: 'text-slate-700', muted: 'text-slate-400' },
} as const;

/** What the estimate is not. Said on every line that carries a figure. */
const SCOPE = 'Estimated from card spend at the rates set here; no caps, tiers or rotating categories.';

export default function LoyaltyEarnLine({ m, tone }: { m: LoyaltyMembership; tone: 'gray' | 'slate' }) {
  const ink = INK[tone];
  if (m.cardAccountId === null) return null;
  if (m.earn === null) return <span className={ink.base}>No earn rates set</span>;
  const est = m.earnEstimate;
  if (est === null) return <span className={ink.base}>No estimate for this unit</span>;
  const cmp = m.earnComparison;
  return (
    <span className={`grid gap-0.5 ${ink.base}`}>
      <span className={ink.strong}>
        ≈ {formatBalance(est.amount, est.unit)} estimated since {est.since}
        {est.basis === 'last_30_days' && ' (no reading yet, last 30 days)'}
      </span>
      {cmp !== null && (
        <span>
          Estimate vs actual, {cmp.from} to {cmp.to}: estimated {formatBalance(cmp.estimated, cmp.unit)}, reported {formatBalance(cmp.actual, cmp.unit)}
          {cmp.differencePercent !== null && ` (${cmp.differencePercent}%)`}
          {cmp.worthALook && <span className="font-medium text-amber-600"> · worth a look</span>}
        </span>
      )}
      <span className={ink.muted}>{SCOPE}</span>
    </span>
  );
}

// Loyalty (P8-42b) — the one sentence that says where a linked card's annual benefit stands. Shown on
// the membership's line on /travel and on the card's own /accounts/[id] page, so the wording lives
// here once and the two pages cannot drift apart.
//
// NO HOOKS AND NO 'use client'. It renders on whichever side imports it: inside the /travel board
// (a client tree) and inside the account page (a server tree). Everything it prints arrives already
// decided by the server — the dates are Postgres `YYYY-MM-DD` text and the state was derived there
// from CURRENT_DATE — so nothing here compares a date or reads a clock.
//
// THE FEE AMOUNT IS NOT SHOWN (SPEC.md Open question 9): no figure is needed to say whether the
// benefit arrived, and the view carries none to show.
//
// ABSENCE IS A PHRASE. No fee is "No annual fee seen yet", never a zero, an empty date or "null".
// "expected by" appears only while the state is awaiting: on an overdue line the same date is the
// one that passed, and calling it "expected" would read as if there were still time.
//
// TWO PALETTES, ONE SHAPE. /travel is `gray-*` and the accounts pages are `slate-*`; the caller says
// which, so a line never mixes the two hues. The state colours are the design system's: amber for a
// warning (overdue), green for done (received), the muted ink for everything still in progress.

import type { LoyaltyBenefit, LoyaltyFeeWatch } from '@b8/contracts/loyalty';

const INK = {
  gray: { base: 'text-gray-500', strong: 'text-gray-700' },
  slate: { base: 'text-slate-500', strong: 'text-slate-700' },
} as const;

export default function LoyaltyFeeWatchLine({
  watch, benefit, tone,
}: { watch: LoyaltyFeeWatch; benefit: LoyaltyBenefit | null; tone: 'gray' | 'slate' }) {
  const ink = INK[tone];
  if (watch.feeDate === null) {
    return (
      <span className={ink.base}>
        No annual fee seen yet
        {benefit !== null && <> · watching for <span className={ink.strong}>{benefit.description}</span></>}
      </span>
    );
  }
  return (
    <span className={ink.base}>
      Annual fee posted {watch.feeDate}
      {benefit !== null && (
        <>
          {' · '}<span className={ink.strong}>{benefit.description}</span>{' '}
          {watch.state === 'awaiting' && <>expected by {watch.expectedBy}</>}
          {watch.state === 'received' && <span className="font-medium text-green-600">received</span>}
          {watch.state === 'overdue' && <span className="font-medium text-amber-600">overdue, was due {watch.expectedBy}</span>}
        </>
      )}
    </span>
  );
}

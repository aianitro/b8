// Loyalty (P8-42b) — on a credit card's own /accounts/[id] page: the program it earns into and where
// that card's annual benefit stands. Rendered only when a membership has linked this account, so an
// unlinked card — and every account that is not a credit card, which can never be linked — shows no
// "Earns into" at all.
//
// A SERVER COMPONENT, no 'use client': it only renders what the page hands it. The page gets it from
// `earningOfCard` in the loyalty store, the same membership view /travel and the API show, so the
// fee date and the state here are the ones there. Nothing is edited here; the link and the benefit
// are managed on /travel, which the card links to.
//
// P8-42b2: under the fee line, what this card's spend should have earned since the program's last
// reading and how the last estimate compared (`LoyaltyEarnLine`, the same component /travel renders),
// or the phrase saying no rates are set. The rates themselves are set on /travel.
//
// The accounts pages are `slate-*`, so the fee and earn lines are asked for their slate palette.

import Link from 'next/link';
import type { LoyaltyMembership } from '@b8/contracts/loyalty';
import LoyaltyFeeWatchLine from './LoyaltyFeeWatchLine';
import LoyaltyEarnLine from './LoyaltyEarnLine';

export default function AccountEarnsInto({ programName, membership }: { programName: string; membership: LoyaltyMembership }) {
  const watch = membership.feeWatch;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-slate-900">
          Earns into {programName}
          <span className="font-normal text-slate-500"> · {membership.memberDisplayName}</span>
        </p>
        <Link href="/travel" className="inline-flex min-h-8 items-center text-xs font-medium text-slate-500 hover:text-slate-900">
          Nights &amp; Miles
        </Link>
      </div>
      {watch !== null && (
        <p className="text-xs mt-1">
          <LoyaltyFeeWatchLine watch={watch} benefit={membership.benefit} tone="slate" />
        </p>
      )}
      <p className="text-xs mt-1">
        <LoyaltyEarnLine m={membership} tone="slate" />
      </p>
    </div>
  );
}

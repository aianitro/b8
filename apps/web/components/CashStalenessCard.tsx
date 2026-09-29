import Link from 'next/link';
import { Wallet } from 'lucide-react';
import type { WalletFinding } from '@/lib/domain/walletStaleness';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/**
 * Cash balances that have stopped being trustworthy.
 *
 * Amber and one line, like `FeedHealthCard` and `DriftAlertCard`, and NOT red: red is over-budget in
 * this app's vocabulary, and this says "a figure below may be wrong", not "you have overspent".
 *
 * ─── UNLIKE THE OTHER TWO, THIS ONE HAS SOMETHING TO PRESS ────────────────────────────────────
 *
 * The feed card deliberately offers no button — a degraded institution is Plaid's to fix and usually
 * clears itself, so a button there would imply the fix is re-linking. Cash is the opposite: nothing
 * will ever clear this on its own, there is exactly one cure, and it is a person opening their wallet
 * and typing what they find. So the card names the action and links to where it happens.
 */
export default function CashStalenessCard({ findings }: { findings: WalletFinding[] }) {
  // Silence when every wallet is current. A strip reporting good health daily is noise competing
  // with the figures the page exists to show.
  if (findings.length === 0) return null;

  const worst = findings[0];
  const others = findings.length - 1;

  // The two reasons stay distinct to the reader. They ask for the same action and describe different
  // situations, and a wallet that has never been counted is not "counted a very long time ago" — it
  // is a figure on the net-worth total that nobody has ever confirmed.
  const headline = worst.reason === 'never'
    ? `${worst.name} has never been counted`
    : `${worst.name} was last counted ${worst.daysSinceCount} days ago`;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <Wallet size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            {headline}
            {others > 0 && (
              <span className="font-normal text-amber-700">
                {' '}and {others} other {others === 1 ? 'wallet' : 'wallets'}
              </span>
            )}
          </p>
          {/* States the reader's situation rather than the mechanism: the figure is carried in the
              totals above, and the only thing that can correct it is counting. */}
          <p className="text-xs text-amber-700 mt-0.5">
            {fmt(worst.balance)} is counted in your totals on trust. Cash has no feed — it only
            becomes true again when you count it.
          </p>
        </div>
        <Link
          href="/accounts"
          className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
        >
          Count
        </Link>
      </div>
    </div>
  );
}

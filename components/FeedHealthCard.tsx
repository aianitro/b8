import { CloudOff } from 'lucide-react';
import type { FeedFinding } from '@/lib/domain/feedHealth';

// Amber, and shaped as a one-line strip like DriftAlertCard — for the same reason, and more so.
// There is no button here at all: a degraded institution is Plaid's to fix and usually clears
// itself within a day or two, so this can legitimately sit on the dashboard with nothing for the
// reader to press. What it must not do is imply the fix is re-linking the account. The item's
// error is null throughout an outage of this kind, nothing needs re-authenticating, and a re-link
// risks breaking a connection that is otherwise healthy.
//
// Deliberately NOT red. Red is over-budget in this app's vocabulary, and this is "the figures
// below may be missing recent days", not "you have overspent".
const fmtWhen = (d: Date | null) =>
  d === null ? 'never' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function FeedHealthCard({ findings }: { findings: FeedFinding[] }) {
  // Silence when every feed is current. A strip reporting good health daily is noise competing
  // with the figures the page exists to show.
  if (findings.length === 0) return null;

  const worst = findings[0];
  const others = findings.length - 1;

  // States the reader's situation, not Plaid's internals: the point is that the numbers below may
  // be short of recent days, and roughly how short.
  const headline = worst.state === 'failing'
    ? `${worst.institution} is not updating — last successful refresh ${fmtWhen(worst.lastSuccessfulUpdate)}`
    : `${worst.institution} has not updated in ${worst.hoursStale} hours`;

  const affected = `${worst.accountCount} ${worst.accountCount === 1 ? 'account' : 'accounts'} affected`;
  const alsoOthers = others > 0
    ? `, and ${others} other ${others === 1 ? 'institution' : 'institutions'}`
    : '';
  const detail = `· ${affected}${alsoOthers}. Figures below may be missing recent days.`
    + ' No action needed — this usually clears on its own.';

  return (
    <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs">
      <CloudOff size={14} className="shrink-0 text-amber-500" />
      <span className="text-amber-800 font-medium">{headline}</span>
      {/* One expression, not three siblings: JSX turns the newline between adjacent expressions
          into a space, which put one in front of the full stop. */}
      <span className="text-amber-600">{detail}</span>
    </div>
  );
}

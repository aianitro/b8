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
    ? `${worst.institution} is not updating`
    : `${worst.institution} has not updated in ${worst.hoursStale} hours`;

  const affected = `${worst.accountCount} ${worst.accountCount === 1 ? 'account' : 'accounts'}`;
  const alsoOthers = others > 0
    ? `, and ${others} other ${others === 1 ? 'institution' : 'institutions'}`
    : '';
  // Narrow card, so the sentence is the short one: what is stale, since when, and that there is
  // nothing to press. The full reasoning is one scroll away in the figures it qualifies.
  const detail = worst.state === 'failing'
    ? `Last refresh ${fmtWhen(worst.lastSuccessfulUpdate)} · ${affected}${alsoOthers}. Usually clears on its own.`
    : `${affected}${alsoOthers}. Figures may be missing recent days.`;

  /**
   * The CAUSE, which is the whole point of asking Plaid for institution status.
   *
   * Without it the reader is left guessing between "my bank needs re-authenticating", "Plaid is
   * having a bad day" and "nothing is wrong" — three situations wanting three different reactions,
   * only one of them any work. Each line below says which of the three this is.
   *
   * NULL SAYS NOTHING AT ALL. It means nobody has asked yet, which is true of every item until its
   * next sync; a line reading "status unknown" would be noise on a card already reporting a problem.
   * And HEALTHY is deliberately NOT silent: a healthy institution behind a stale feed is the most
   * actionable case on this card, because it points at this connection rather than at the bank.
   */
  const since = worst.institutionStatusAt === null ? null : fmtWhen(worst.institutionStatusAt);
  const cause =
    worst.institutionStatus === 'DOWN'
      ? `Plaid reports ${worst.institution} down${since ? ` since ${since}` : ''}.`
      : worst.institutionStatus === 'DEGRADED'
        ? `Plaid reports ${worst.institution} degraded${since ? ` since ${since}` : ''}.`
        : worst.institutionStatus === 'HEALTHY'
          ? `Plaid reports ${worst.institution} healthy, so this may be the connection rather than the bank.`
          : null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs">
      <CloudOff size={14} className="shrink-0 mt-0.5 text-amber-500" />
      <div className="min-w-0">
        <p className="text-amber-800 font-medium">{headline}</p>
        {/* One expression, not siblings: JSX turns the newline between adjacent expressions into a
            space, which put one in front of the full stop. */}
        <p className="text-amber-600 mt-0.5">{detail}</p>
        {/* Below the detail, because the symptom is what the reader came for and the cause is what
            tells them whether to act on it. Absent entirely when nobody has asked yet. */}
        {cause && <p className="text-amber-700 mt-1 font-medium">{cause}</p>}
      </div>
    </div>
  );
}

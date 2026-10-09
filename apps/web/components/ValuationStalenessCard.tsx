import Link from 'next/link';
import { FileClock } from 'lucide-react';
import { valuationFindingText, type ValuationFinding } from '@/lib/domain/valuationStaleness';

/**
 * Investment accounts valued by hand whose figure is out of date — the cash card's sibling.
 *
 * Amber and one line, for the cash card's reasons: this says "a figure in your total is old", not
 * "something is wrong". And like it, it carries an action, because like cash nothing will clear it
 * on its own — a person has to upload the statement. The link goes to the Capital tab of the
 * accounts page, where the account's value and its Statement button sit.
 *
 * Silent when every hand-valued account is current.
 */
export default function ValuationStalenessCard({ findings }: { findings: ValuationFinding[] }) {
  if (findings.length === 0) return null;
  const worst = findings[0];
  const others = findings.length - 1;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <FileClock size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            {valuationFindingText(worst)}
            {others > 0 && (
              <span className="font-normal text-amber-700">
                {' '}And {others} other {others === 1 ? 'account' : 'accounts'}.
              </span>
            )}
          </p>
        </div>
        <Link
          href="/accounts?landscape=capital"
          className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
        >
          Update
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import type { RecentArrival } from '@/app/dashboard/page';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Math.abs(n));

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * What landed since the last sync — the reason to open this page today rather than on Sunday.
 *
 * Ordered by size, not by time. Twelve rows is already more than a glance, and the $400 charge is
 * the one worth seeing whether it arrived first or last; a reverse-chronological feed buries it
 * under three coffees on the strength of a timestamp nobody is reading.
 *
 * A refund is shown as what it is rather than as a negative expense, because a row reading
 * "−$150.00" in a list of spending is read as spending by anyone moving quickly.
 */
export default function RecentArrivals({ arrivals, staleFeed }: {
  arrivals: RecentArrival[]; staleFeed: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">What arrived since yesterday</p>
        {arrivals.length > 0 && (
          <Link href="/transactions" className="text-[10px] text-blue-600 hover:underline">All transactions</Link>
        )}
      </div>

      {arrivals.length === 0 ? (
        // Distinguishes the two reasons for an empty feed. "Nothing new" is a fact about spending;
        // "nothing new WHILE a bank has stopped reporting" is a fact about the pipe, and reading
        // the first when the second is true is how a stale dashboard gets trusted.
        <div className="flex items-start gap-2.5 text-sm text-slate-400">
          <Inbox size={15} className="mt-0.5 shrink-0 text-slate-300" />
          <p>
            Nothing new since yesterday.
            {staleFeed && (
              <span className="text-amber-600">
                {' '}A bank feed is not updating, so this may be the connection rather than a quiet day.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {arrivals.map((a) => {
            const refund = a.amount < 0;
            return (
              <div key={a.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="text-[10px] font-mono text-slate-300 w-11 shrink-0">{dayLabel(a.date)}</span>
                <span className="text-sm text-slate-700 truncate flex-1">{a.label}</span>
                {a.category ? (
                  <Link
                    href={`/transactions?category=${encodeURIComponent(a.category)}&from=dashboard`}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 hover:bg-slate-100 shrink-0 max-w-[9rem] truncate"
                  >
                    {a.category}
                  </Link>
                ) : (
                  <Link
                    href="/transactions?filter=uncategorized"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 shrink-0"
                  >
                    uncategorized
                  </Link>
                )}
                <span className={`text-xs font-mono shrink-0 w-20 text-right ${
                  refund ? 'text-emerald-600' : 'text-slate-700'
                }`}>
                  {refund ? `+${fmt(a.amount)}` : fmt(a.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

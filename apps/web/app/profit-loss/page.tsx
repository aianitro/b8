export const dynamic = 'force-dynamic';

import ProfitLossChart from '@/components/charts/ProfitLossChart';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { loadOverview } from '@/lib/overviewRead';
import { dashboardFromWire } from '@/lib/overviewFromWire';
import { MONTHS } from '@/lib/drilldown';

/**
 * The year's profit and loss, off the dashboard.
 *
 * ─── Why it moved ─────────────────────────────────────────────────────────────────────────────
 *
 * Owner's request, and it is the same argument the "year by category" move made: the dashboard
 * answers "is anything wrong today" in a glance, and this chart answers "how is the year going" —
 * twelve months of money in, money out, and a cumulative line, half of it forecast. That is a
 * sit-down read, and a page trying to do both does the glance worse.
 *
 * It sits below Net Worth in the menu rather than beside the dashboard because that is the company
 * it keeps: both are whole-year, whole-position views that reward being looked at deliberately.
 *
 * ─── Why it loads the whole overview for one chart ────────────────────────────────────────────
 *
 * `monthlySpending` and `yearEnd` are computed inside `loadOverview` with every other figure on that
 * payload, and pulling one reader out to serve one page would be a second definition of figures the
 * budget page already shows. One round of queries on a single-user app behind a tailnet costs less
 * than two answers to one question — the same trade `app/sandbox/page.tsx` records.
 */
export default async function ProfitLossPage() {
  // The page's one clock read, as everywhere else: everything dated below derives from these three
  // integers, so nothing here can straddle midnight.
  const now = new Date();
  const asOf = asOfFromDate(now);
  const { monthlySpending: monthly, yearEnd } = dashboardFromWire(await loadOverview(now));

  // `pl` and `plProjected` overlap on the last settled month. Without that shared point the dashed
  // line would start a month adrift of where the solid one ended, leaving a visible gap exactly at
  // the boundary the chart exists to show.
  const lastSettled = asOf.month - 1;
  const plSeries = MONTHS.map((month, i) => ({
    month,
    // Bars stop where the data does. A future month drawn at $0 reads as a month that cost nothing,
    // which is a claim; absent reads as not yet, which is the truth.
    //
    // Money OUT is the negated one: it hangs below the axis, money in rises above it. The value
    // carries the sign the chart needs and the tooltip puts it back, because "money out −$26,000" is
    // nonsense on the way to a reader.
    //
    // Settled and forecast are separate series so they can be drawn differently, and the boundary is
    // the same one the line uses — `lastSettled`. The current month is FORECAST on both: it is part
    // way through, and a solid bar for it would claim a finished month.
    spent:    i <= lastSettled ? -(monthly[i]?.operational ?? 0) : null,
    received: i <= lastSettled ?  (monthly[i]?.received ?? 0)    : null,
    spentProjected:    i >= asOf.month ? -yearEnd.monthly[i].expense : null,
    receivedProjected: i >= asOf.month ?  yearEnd.monthly[i].income  : null,
    pl: i <= lastSettled ? yearEnd.monthly[i].cumulative : null,
    plProjected: i >= lastSettled ? yearEnd.monthly[i].cumulative : null,
  }));

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Profit &amp; Loss</h1>
        <p className="text-sm text-slate-500 mt-1">
          {asOf.year} · settled through {MONTHS[lastSettled] ?? 'the start of the year'}, forecast after
        </p>
      </div>

      <ProfitLossChart data={plSeries} />
    </div>
  );
}

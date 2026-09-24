export const dynamic = 'force-dynamic';

import BudgetTracks from '@/components/charts/BudgetTracks';
import { asOfFromDate } from '@/lib/domain/monthOutlook';
import { loadOverview } from '@/lib/overviewRead';
import { dashboardFromWire } from '@/lib/overviewFromWire';
import { MONTHS } from '@/lib/drilldown';

/**
 * Somewhere for a widget to live that is not the dashboard.
 *
 * ─── What this page is for ────────────────────────────────────────────────────────────────────
 *
 * "The year by category" moved here at the owner's request. It is a good widget and it is a slow
 * read — twenty tracks, each wanting a comparison against a pace mark — which is a different thing
 * from what the dashboard is for. The dashboard answers "is anything wrong today" in a glance;
 * this answers "how is the year going, category by category", and a page that does both does the
 * first one worse.
 *
 * The name is the owner's and it is the honest one: this is where a widget goes while its home is
 * being decided. Anything here is expected to move again.
 *
 * ─── Why it loads the whole overview for one widget ───────────────────────────────────────────
 *
 * `budgetVsActual` is computed inside `loadOverview`, with every other figure on that payload, and
 * pulling one reader out to serve one page would be a second definition of a figure the dashboard
 * already shows. The payload is one round of queries on a single-user app behind a tailnet; the
 * cost of reading it twice is smaller than the cost of two answers to one question.
 */
export default async function SandboxPage() {
  // The page's one clock read, as everywhere else — see the dashboard's note. Everything dated
  // below is derived from these three integers so nothing here can straddle midnight.
  const now = new Date();
  const asOf = asOfFromDate(now);
  const { budgetVsActual } = dashboardFromWire(await loadOverview(now));

  // Share of the year gone, which is what the tick on every track marks. Same arithmetic as the
  // dashboard's, and it is UTC so a DST boundary cannot move the mark by a day.
  const startOfYear = Date.UTC(asOf.year, 0, 1);
  const yearElapsed =
    (Date.UTC(asOf.year, asOf.month, asOf.day) - startOfYear) / (Date.UTC(asOf.year + 1, 0, 1) - startOfYear);

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Sandbox</h1>
        <p className="text-sm text-slate-500 mt-1">
          {MONTHS[asOf.month]} {asOf.year} · widgets that are not on the dashboard
        </p>
      </div>

      <BudgetTracks rows={budgetVsActual} yearElapsed={yearElapsed} />
    </div>
  );
}

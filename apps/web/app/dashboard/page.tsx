export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import Link from 'next/link';
import BudgetTracks from '@/components/charts/BudgetTracks';
import ProfitLossChart from '@/components/charts/ProfitLossChart';
import { STATUS_CLASS, type StatusColor } from '@/lib/chartColors';
import DriftAlertCard from '@/components/DriftAlertCard';
import FeedHealthCard from '@/components/FeedHealthCard';
import JobHealthCard from '@/components/JobHealthCard';
import AlertBell from '@/components/AlertBell';
import CategoryBubbles, { type BubbleCategory } from '@/components/CategoryBubbles';
import RecentArrivals from '@/components/RecentArrivals';
import WatchlistCard from '@/components/WatchlistCard';
import ExpandableKpiCards from '@/components/ExpandableKpiCards';
import PushSetup from '@/components/PushSetup';
import BudgetBar from '@/components/BudgetBar';
// The whole verdict comes from one pure function, called once. This page issues SQL and renders;
// it computes no adherence, no pacing and no headline of its own. BUILD.md §7.5's rule — no
// surface computes a shared concept independently of `lib/domain/` — is the reason, and the page
// this one replaces was already in tension with it.
import { asOfFromDate, type OutlookCategory } from '@/lib/domain/monthOutlook';
import { loadOverview } from '@/lib/overviewRead';
import { dashboardFromWire } from '@/lib/overviewFromWire';
// The SQL behind that verdict now lives in `lib/`, shared with the daily job's breach alert, so the
// page and the email can never drift on what this month's outlook is. It moved for the same reason
// `lib/` already holds a shared reader for the scheduler's other daily computation: a scheduler
// cannot import a page's private function, and copying the queries would have put two definitions
// of the same figures one directory apart. Nothing a reader sees changed — the queries moved
// verbatim, and the page is touched here only by a deletion and this import.
import { MONTHS, drillHref } from '@/lib/drilldown';
// The calendar rule, imported rather than restated: `./pacing` exports it precisely so a caller
// formatting "day 8 of 30" agrees with the module that computed the projection about how long
// April is. A second leap-year rule here would drift on 2100.
import { daysInMonth } from '@/lib/domain/pacing';



const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtCents = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/** A fraction of budget as a percentage. `2.6625` reads "266%" — of budget, not over it. */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * One recently arrived transaction, as `RecentArrivals` renders it. Kept here because the component
 * imports its type from this page.
 */
export interface RecentArrival {
  id: number;
  date: string;
  amount: number;
  label: string;
  category: string | null;
}

function KpiCard({ label, value, sub, subColor, highlight, href, footer }: {
  label: string; value: string; sub?: string; subColor?: StatusColor;
  highlight?: StatusColor; href?: string; footer?: ReactNode;
}) {
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-bold mt-2 font-mono ${highlight ? STATUS_CLASS[highlight] : 'text-slate-900'}`}>
        {value}
      </p>
      {sub && <p className={`text-xs mt-1.5 ${subColor ? STATUS_CLASS[subColor] : 'text-slate-400'}`}>{sub}</p>}
      {footer && <div className="mt-3 pt-3 border-t border-slate-100">{footer}</div>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block bg-white rounded-2xl border border-slate-100 shadow-sm p-6 hover:border-slate-200 hover:shadow-md transition-all"
      >
        {content}
      </a>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      {content}
    </div>
  );
}

function paceColor(ratio: number): StatusColor {
  if (ratio > 1.1) return 'red';
  if (ratio > 1.0) return 'amber';
  return 'green';
}



/**
 * The transactions behind one verdict: the named categories, in the month the verdict is about.
 *
 * `month` is 0-based everywhere in `lib/domain` and 1-based in the transactions page's query, and
 * the conversion happens HERE rather than at each call site — an off-by-one in a drilldown href
 * shows the owner a real, well-formed, wrong month, which is the failure that looks like data.
 *
 * `from=dashboard` so the breadcrumb over there points back to this page rather than to /budget.
 */


/**
 * One category line. `elapsedDays` and `daysInMonth` travel with every projection: a projection
 * with no day attached is the roadmap's own sentence with its qualifier removed, and the pacing
 * module built those two fields to carry precisely so a renderer has no excuse.
 *
 * The whole line is the target, not the name alone: a verdict the owner disagrees with is only
 * answerable by the rows underneath it, and a row's own month is the only month worth opening —
 * `c.month` rather than the as-of month, because `offCycleElsewhere` records name an earlier one.
 */
function CategoryLine({ c, note }: { c: OutlookCategory; note: string }) {
  // THE FIGURE THE ROW LEADS WITH IS THE ONE THE ROW OPENS. `projected` is a forecast — Sport's
  // $265 over eight elapsed days of thirty projects to $993.75 — and the drilldown under this row
  // can only ever list the $265, because the other $728.75 has not been spent. Leading with the
  // forecast made the row and its own transactions disagree by a factor of four, with nothing on
  // screen saying they were different quantities. So `actual` leads, labelled, and the projection
  // is demoted and named.
  //
  // `complete` projects to its own actual by arithmetic — its elapsed fraction is 1 — so it prints
  // no forecast line: repeating the same dollars under the word "projected" would invent a
  // prediction about a month that has already ended. `off-cycle`, `no-budget`, `too-early` and
  // `future` carry no projection at all, and used to render an empty right column.
  const forecast = c.status === 'projected' && c.projected !== null && c.projectedVariance !== null;
  return (
    <Link
      href={drillHref([c.category], c.month)}
      className="group -mx-2 px-2 rounded-lg flex items-baseline justify-between gap-3 py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate group-hover:underline">{c.category}</p>
        <p className="text-xs text-slate-400">
          {note} · day {c.elapsedDays} of {c.daysInMonth}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-mono text-slate-800">
          {fmtCents(c.actual)}
          <span className="mx-1 font-sans text-[10px] font-medium uppercase tracking-wider text-slate-400">
            spent of
          </span>
          <span className="text-slate-400">{fmtCents(c.budgeted)}</span>
        </p>
        {forecast ? (
          <>
            <p className={`text-xs font-mono ${c.projectedVariance! > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              {fmtCents(c.projected!)}
              <span className="ml-1 font-sans text-[10px] font-medium uppercase tracking-wider">projected</span>
              {c.projectedRatio !== null && ` · ${pct(c.projectedRatio)}`}
            </p>
            {/* Said out loud wherever it moved the figure, because the projection is now two
                claims of different kinds and the owner is entitled to know which is which. A gym
                membership is a contract and the rest of a category is a decision; a reader who
                cannot tell them apart cannot act on either. */}
            {c.recurringExpected !== null && c.recurringExpected > 0 && (
              <p className="text-[10px] text-slate-400">
                incl. {fmtCents(c.recurringExpected)} recurring, not pro-rated
              </p>
            )}
          </>
        ) : c.spentRatio !== null ? (
          // The share so far, and the day it is "so far" as of sits on the left of this same row —
          // the qualifier `./pacing` built `elapsedDays`/`daysInMonth` to carry. A percentage means
          // a different thing in each status, and this one is never printed without its day.
          <p className={`text-xs font-mono ${c.actual > c.budgeted ? 'text-red-500' : 'text-emerald-500'}`}>
            {pct(c.spentRatio)} of budget
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** Static strings, because Tailwind reads this file rather than the value of an expression. */

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  // The page's ONE clock read. Everything downstream — the domain module's as-of point, every
  // date-bounded query, the year in the header — is derived from these three integers, in local
  // calendar time, so nothing on this page can straddle midnight or a New Year in two directions.
  const now = new Date();
  const asOf = asOfFromDate(now);
  const monthLength = daysInMonth(asOf.year, asOf.month);

  // P1-11a: EVERYTHING BELOW IS READ FROM THE /overview PAYLOAD — the same object the mobile client
  // will consume, produced by the same function the API handler wraps. The page used to run ten
  // queries and six loaders of its own; those were copied into `lib/overviewRead.ts` for the
  // endpoint on 2026-09-13, and on 2026-09-17 they were checked to be identical before this switch
  // (one differed by a constant column nothing read). Reading the payload is what keeps the two
  // from ever diverging again: a field this screen needs and the payload lacks is now a type error.
  //
  // `now` is the same Date the page's own clock read produced, so the payload's as-of point and the
  // page's are one calendar, not two that disagree around midnight.
  const {
    stats, today: todayStats, week: weekStats, monthlySpending: monthly, budgetVsActual,
    recentArrivals, recentArrivalsTotal, watchlist, yearEnd, offCycleElsewhere, monthCategories,
    feedFindings, driftFindings, jobHealth,
  } = dashboardFromWire(await loadOverview(now));

  // Share of the year gone, from the page's own clock read. The tracks compare a year's spend to
  // a year's budget, and without this the reader has to date the figure themselves.
  const startOfYear = Date.UTC(asOf.year, 0, 1);
  const yearElapsed =
    (Date.UTC(asOf.year, asOf.month, asOf.day) - startOfYear) / (Date.UTC(asOf.year + 1, 0, 1) - startOfYear);

  // One name for the condition, used by both short-horizon cards. Their figures are the most
  // sensitive on the page to a feed that has stopped: a day is one data point and a week is five.
  const staleFeed = feedFindings.length > 0;

  const todayDelta = todayStats.spent - todayStats.avgSameWeekday;
  const todayVsAvgRatio = todayStats.avgSameWeekday > 0 ? todayStats.spent / todayStats.avgSameWeekday : 0;

  const weekDelta = weekStats.spent - weekStats.spentComparableLastWeek;
  const expectedWeekSpend = weekStats.weeklyBudgetReference * (weekStats.isoDow / 7);
  const weekPaceRatio = expectedWeekSpend > 0 ? weekStats.spent / expectedWeekSpend : 0;

  // `pl` and `plProjected` overlap on the last settled month. Without that shared point the dashed
  // line would start a month adrift of where the solid one ended, leaving a visible gap exactly at
  // the boundary the chart exists to show.
  const lastSettled = asOf.month - 1;
  const plSeries = MONTHS.map((month, i) => ({
    month,
    // Bars stop where the data does. A future month drawn at $0 reads as a month that cost
    // nothing, which is a claim; absent reads as not yet, which is the truth.
    // Money OUT is the negated one: it hangs below the axis, money in rises above it. The value
    // carries the sign the chart needs and the tooltip puts it back, because "money out −$26,000"
    // is nonsense on the way to a reader.
    //
    // Settled and forecast are separate series so they can be drawn differently, and the boundary
    // is the same one the line uses — `lastSettled`. The current month is FORECAST on both: it is
    // eleven days old, and a solid bar for it would claim a finished month.
    spent:    i <= lastSettled ? -(monthly[i]?.operational ?? 0) : null,
    received: i <= lastSettled ?  (monthly[i]?.received ?? 0)    : null,
    spentProjected:    i >= asOf.month ? -yearEnd.monthly[i].expense : null,
    receivedProjected: i >= asOf.month ?  yearEnd.monthly[i].income  : null,
    pl: i <= lastSettled ? yearEnd.monthly[i].cumulative : null,
    plProjected: i >= lastSettled ? yearEnd.monthly[i].cumulative : null,
  }));

  // EVERY operational spending category with an allocation this month, not the scored subset —
  // the bubbles are a map, not a judgement, and a map that omits groceries, fuel and utilities is
  // the wrong shape. Scoping and shaping now happen in `lib/overviewRead.ts`, once, for this page
  // and the mobile client alike.
  const bubbleCategories: BubbleCategory[] = monthCategories;

  // `p-4` on a phone, the original `p-8` from `sm:` up. 32px of padding each side costs 64px of a
  // 390px screen — a sixth of it — spent on whitespace beside figures that need the room.
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Header, with the warnings behind a counter in the corner.
          
          They can legitimately sit here for days — a degraded bank feed clears on Plaid's
          schedule, a drift needs a missing transaction found — so anything permanently on screen
          permanently repeats what the owner already knows. A count says it in one glyph. Feed
          health leads inside the popover, because a stale feed is what explains the drift under
          it. */}
      <div className="flex items-start justify-between gap-4 sm:gap-6 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {MONTHS[asOf.month]} {asOf.year} · day {asOf.day} of {monthLength}
          </p>
        </div>
        {/* Counted by CARD, not by finding: two institutions behind is one message about the
            feed, and five drifting accounts is one message about the ledger. The number is how
            many things there are to read, which is the only sense in which a reader counts them. */}
        <AlertBell count={(feedFindings.length > 0 ? 1 : 0) + (driftFindings.length > 0 ? 1 : 0)
          + (jobHealth.status !== 'fresh' ? 1 : 0)}>
          {/* First in the bell, because it outranks the other two: they each say a figure may be
              wrong, this says every figure may be old and the backups are missing as well. */}
          <JobHealthCard health={jobHealth} />
          <FeedHealthCard findings={feedFindings} />
          <DriftAlertCard findings={driftFindings} />
        </AlertBell>
      </div>

      {/* The month, category by category. It leads the page now that the verdict card is gone:
          the card said "2 categories heading $219 over" and these bubbles say which two, how big
          each is, and what everything around them is doing — the same finding with the evidence
          attached. */}
      <CategoryBubbles categories={bubbleCategories} />

      {/* THE WATCHLIST AND THE ARRIVALS FEED MOVED INTO THE KPI ROW BELOW, as counts that open.
          They used to sit here open, which cost the top of the page to two lists that are usually
          short and occasionally long — the dashboard's height moved with the owner's week, above
          the picture it was supposed to be framing. As counts they sit beside Uncategorized, where
          the other "waiting on you" figures already live, and the rows are one click away.

          The argument that put the watchlist here — that a pending return qualifies the bubbles and
          should be read in the same breath — still holds, and is why it is in the row immediately
          under them rather than at the foot of the page. */}

      {/* One panel where there were three, so the grid that sized itself to the survivors is gone
          with them — a single-column grid is a div, and the arithmetic behind it was machinery for
          a layout that no longer varies. */}
      {offCycleElsewhere.length > 0 && (
        <div className="mb-6">
          <Panel title="Off-cycle earlier this year">
            {offCycleElsewhere.map((c) => (
              <CategoryLine key={`${c.categoryId}-${c.month}`} c={c} note={`${MONTHS[c.month]} drew outside its schedule`} />
            ))}
          </Panel>
        </div>
      )}

      {/* The annual ceiling, kept as context rather than as a verdict. The year-pace bar that used
          to sit here counted the current month as fully elapsed — 33% of the year on 1 April
          against a true 25% — which inflated expected spend and flattered the pace. It is deleted
          rather than repaired: the per-category month above is the figure the page exists for. */}
      {/* TWO ROWS: the targets, then the counts. They were one three-column grid, which put
          Uncategorized beside two money figures it has nothing to do with and pushed the other two
          counts onto a line of their own — so the three questions of the form "what is waiting on
          you" were read across a row break. Splitting by KIND rather than by count is what lets
          all three sit together. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* The same figure /budget's header carries, from the same reader — where the operational
            year closes if the plan holds. It leads the page's figures because it is the one the
            others are judged against; the row it shares is now the two TARGETS, the counts having
            moved to their own line below. */}
        <KpiCard
          label="Projected P/L"
          value={`${yearEnd.profitLoss < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.profitLoss))}`}
          sub={`${yearEnd.netToDate < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.netToDate))} so far`
            + (yearEnd.uncategorizedNet !== 0
                ? ` · ${fmt(Math.abs(yearEnd.uncategorizedNet))} unfiled, not counted`
                : '')}
          highlight={yearEnd.profitLoss < 0 ? 'red' : 'green'}
          href="/budget"
        />
        {/* ONE CARD WHERE THERE WERE TWO. "Annual Budget" was a constant — it changes when the
            owner edits a category and never otherwise — and "Remaining" was that constant minus a
            number shown nowhere on this row. Side by side they asked the reader to subtract two
            large figures to find the one they came for, and the target took a quarter of the row
            to say something that does not move.

            The headline is what is LEFT, because that is the figure anyone acts on. The target and
            the spend become the line under it, where they are context rather than competition, and
            the bar turns the pair into a ratio neither card could show alone.

            NO YEAR-ELAPSED MARKER on the track, deliberately. Spending 60% of an annual plan by
            mid-September means something quite different from spending it by March, so a marker
            would help — but this page already answers pacing twice, in the bubbles and in Projected
            P/L, and both are computed per category per month. A third answer on an annual basis
            would disagree with them in exactly the months that matter. */}
        <KpiCard
          label="Budget remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : 'green'}
          sub={`${fmt(stats.spent)} spent of ${fmt(stats.budget)}`}
          footer={<BudgetBar spent={stats.spent} budget={stats.budget} />}
        />
      </div>

      {/* THE THREE COUNTS OF THINGS WAITING ON THE OWNER, on one line. Three columns at every
          width rather than a responsive 2-then-3: the point of the row is that they are read
          together, and a breakpoint that splits them two-and-one defeats it on exactly the narrow
          screens where scanning is hardest. These are counts, so the columns can be narrow — the
          argument against three across is about not truncating a five-figure amount. */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Uncategorized leads: it is the one with work attached rather than a state to read, and
            the only one of the three that NAVIGATES rather than opening — its list is the
            transactions page's own filter, which is where the filing actually happens.

            The count alone. A percentage of 1,476 transactions rounds to 0% at one unfiled row and
            still at six, so the card used to read "0%" in amber while there was work waiting.

            No denominator either: the total is context nobody acts on. Filing is per transaction,
            so the count IS the size of the job, and "1" says it without a ratio to interpret. */}
        <KpiCard
          label="Uncategorized"
          value={stats.uncategorized.toLocaleString()}
          highlight={stats.uncategorized > 0 ? 'amber' : 'green'}
          href="/transactions?filter=uncategorized"
        />
        {/* The other two counts of things waiting on the owner, beside the first. These OPEN rather
            than navigate, because both answer their question in a list short enough to read in
            place — and leaving the dashboard to read six rows loses the picture they qualify.

            The panels are the same two components that used to sit above, rendered here and passed
            through: they are server components, and handing them in already rendered keeps them
            that way. `watchlist` is ordered oldest first by its reader, so `[0]` is the age. */}
        <ExpandableKpiCards
          watchCount={watchlist.length}
          watchOldest={watchlist[0]?.daysOpen ?? 0}
          watchPanel={<WatchlistCard items={watchlist} />}
          arrivalsCount={recentArrivalsTotal}
          arrivalsShown={recentArrivals.length}
          arrivalsPanel={
            <RecentArrivals arrivals={recentArrivals} staleFeed={feedFindings.length > 0} />
          }
          staleFeed={feedFindings.length > 0}
        />
      </div>

      {/* Charts */}
      <div className="space-y-6">
        <ProfitLossChart data={plSeries} />
        {/* Two shorter horizons. They used to sit directly under the month's verdict, on the
            grounds that they are the same question at a different scale — but that put a $47 day
            three lines below the year's projected P/L, and a reader scanning down met the smallest
            horizon before the charts that explain the largest.

            Between the two charts, the page reads longest horizon to shortest and then back out:
            where the year closes, then this week and today, then the year category by category.
            The P/L chart above ends on the current month, so these two continue it inward at the
            same scale rather than interrupting it — and the category track below is a different
            question, per category rather than per horizon, which makes it the natural place to
            stop rather than a step in the sequence.

            Still a pair, still side by side: today only means something against the week. */}
        {/* Stacked below `sm:`, side by side above it. These carry CURRENCY, so the two-per-row
            rule the counts row is exempt from applies here: at a third of a phone a four-figure
            amount with cents overflows its card at `text-3xl`, and a truncated figure is worse
            than a taller page. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KpiCard
            label="Today"
            value={fmt(todayStats.spent)}
            sub={todayStats.avgSameWeekday > 0
              ? `${todayDelta >= 0 ? '+' : ''}${fmt(todayDelta)} vs the same weekday's recent average`
              : undefined}
            subColor={todayStats.avgSameWeekday > 0 ? paceColor(todayVsAvgRatio) : undefined}
            footer={
              todayStats.transactions.length === 0 ? (
                // "No spending yet today" is a claim about behaviour, and while a feed is behind it
                // is a claim about the pipe wearing behaviour's clothes. Chase last reported on the
                // 8th, so a $0 today and a flattering delta against the weekday average are both
                // artefacts. Said here rather than left for the reader to remember.
                <p className="text-xs text-slate-300">
                  {staleFeed
                    ? <span className="text-amber-600">A bank feed is behind — nothing recorded today may be the connection, not a quiet day.</span>
                    : 'No spending yet today'}
                </p>
              ) : (
                <div className="space-y-1">
                  {todayStats.transactions.map((t, i) => (
                    <div key={i} className="flex justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">{t.label}</span>
                      <span className="font-mono text-slate-400 shrink-0">{fmt(t.amount)}</span>
                    </div>
                  ))}
                  {todayStats.totalCount > todayStats.transactions.length && (
                    <p className="text-[10px] text-slate-300">+{todayStats.totalCount - todayStats.transactions.length} more</p>
                  )}
                </div>
              )
            }
          />
          <KpiCard
            label="This Week"
            value={fmt(weekStats.spent)}
            sub={`${weekDelta >= 0 ? '+' : ''}${fmt(weekDelta)} vs same point last week`}
            subColor={expectedWeekSpend > 0 ? paceColor(weekPaceRatio) : undefined}
            footer={
              <p className="text-xs text-slate-400">
                {fmt(weekStats.weeklyBudgetReference)}/wk reference
                {staleFeed && (
                  <span className="block text-amber-600 mt-0.5">
                    A bank feed is behind, so recent days may be short.
                  </span>
                )}
              </p>
            }
          />
        </div>

        {/* The donut lost the pair it sat beside when Cash Flow went. Full width rather than half
            a row with white space next to it — the operational book has fourteen categories and
            the legend was the cramped half of that layout anyway. */}
        {/* One widget where there were two. The donut said how big each category is and nothing
            about whether it is on plan; the budget-vs-actual bars said whether it is on plan and
            drew a $378 line the same length as a $29,000 one. */}
        <BudgetTracks rows={budgetVsActual} yearElapsed={yearElapsed} />
      </div>

      {/* Turning the daily ping on, at the very foot of the page — settings rather than reading,
          reachable without being in the way. The phone put its own ping setup in the same place
          for the same reason.

          The PUBLIC key only. It is handed to every browser that subscribes and is not secret; the
          private half signs the push and never leaves the server. Read here rather than in the
          client component because `process.env` is not there to read. */}
      <div className="mt-10 pt-6 border-t border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Notifications</p>
        <PushSetup vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </div>
    </div>
  );
}

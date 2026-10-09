export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import Link from 'next/link';
import DriftAlertCard from '@/components/DriftAlertCard';
import FeedHealthCard from '@/components/FeedHealthCard';
import JobHealthCard from '@/components/JobHealthCard';
import AlertBell from '@/components/AlertBell';
import CashStalenessCard from '@/components/CashStalenessCard';
import ValuationStalenessCard from '@/components/ValuationStalenessCard';
import { loadValuationFindings } from '@/lib/valuationStalenessRead';
import WhereTheMonthSits, { type MonthCategoryView } from '@/components/WhereTheMonthSits';
import RecentArrivals from '@/components/RecentArrivals';
import UncategorizedCard from '@/components/UncategorizedCard';
import WatchlistCard from '@/components/WatchlistCard';
import ExpandableKpiCards from '@/components/ExpandableKpiCards';
import KpiCard from '@/components/KpiCard';
import PushSetup from '@/components/PushSetup';
import NotificationBell from '@/components/NotificationBell';
// The whole verdict comes from one pure function, called once. This page issues SQL and renders;
// it computes no adherence, no pacing and no headline of its own. BUILD.md §7.5's rule — no
// surface computes a shared concept independently of `lib/domain/` — is the reason, and the page
// this one replaces was already in tension with it.
import { asOfFromDate, type OutlookCategory } from '@/lib/domain/monthOutlook';
import { loadMonthCategories, loadOffCycle, loadOverview } from '@/lib/overviewRead';
import DashboardMonthNav from '@/components/DashboardMonthNav';
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
import { loadCategoryOptions } from '@/lib/categoryOptionsRead';



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
/**
 * One unfiled row, as the dashboard's panel renders it.
 *
 * Structurally `RecentArrival`'s twin and separate for the same reason the contract keeps the two
 * schemas apart: they are selected by different predicates and should be free to diverge at the
 * one place they might. `category` is always null — that is what makes a row unfiled — and is
 * carried because the editor these rows open reads it.
 */
export interface UnfiledTransaction {
  id: number;
  date: string;
  amount: number;
  label: string;
  /** The payee as Plaid names it, or null when the feed gave only a descriptor. `label` falls back
   *  to that descriptor; a merchant RULE must not be keyed on the fallback. */
  merchant: string | null;
  category: string | null;
  watched: boolean;
  note: string | null;
}

export interface RecentArrival {
  id: number;
  date: string;
  amount: number;
  label: string;
  /** The payee as Plaid names it, or null when the feed gave only a descriptor. `label` falls back
   *  to that descriptor; a merchant RULE must not be keyed on the fallback. */
  merchant: string | null;
  category: string | null;
  /** Carried so the row's editor opens from the truth rather than from an assumption.
   *  An arrival can ALSO be watched — the reader has no watched bound and the watchlist has no
   *  date bound, so a row flagged today that also landed today is in both lists. */
  watched: boolean;
  note: string | null;
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
 * `c.month` rather than the as-of month, because off-cycle records from earlier months name their own month.
 */
/** The fields a row reads — shared by an outlook verdict and a raw pace record, so either renders. */
type CategoryLineData = Pick<OutlookCategory, 'category' | 'month' | 'status' | 'elapsedDays' | 'daysInMonth' | 'actual'
  | 'budgeted' | 'projected' | 'projectedVariance' | 'projectedRatio' | 'recurringExpected' | 'spentRatio'>;

function CategoryLine({ c, note }: { c: CategoryLineData; note: string }) {
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

/**
 * A closed month of this year, looked back on: its tiles and what they add up to.
 *
 * Only the month outlook is read for it, as of the month's last day. Everything else on the
 * dashboard describes the present — alerts, arrivals, the watchlist, what is unfiled, the year-end
 * forecast — and dated to an earlier month would be wrong rather than merely old, so it is not
 * shown here at all.
 */
async function PastMonth({ year, month, current }: { year: number; month: number; current: number }) {
  const monthLength = daysInMonth(year, month);
  const categories: MonthCategoryView[] = await loadMonthCategories({ year, month, day: monthLength });
  const budget = categories.reduce((s, c) => s + c.budgeted, 0);
  const spent = categories.reduce((s, c) => s + c.actual, 0);
  const left = budget - spent;
  const over = categories.filter((c) => c.actual > c.budgeted).length;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* In the installed app the month sits on the title's line, on the right — see DashboardMonthNav. */}
      <div className="mb-6 sm:mb-8 standalone:flex standalone:items-center standalone:justify-between standalone:gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <DashboardMonthNav year={year} month={month} current={current} day={monthLength} monthLength={monthLength} />
      </div>

      {/* The same three-figure grid the current month's counts use, for the same reason: on a
          phone three across is the glance, and these are read together. */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <KpiCard label="Spent" value={fmt(spent)} sub={`of ${fmt(budget)} budgeted`} />
        <KpiCard
          label={left < 0 ? 'Over budget' : 'Under budget'}
          value={fmt(Math.abs(left))}
          highlight={left < 0 ? 'red' : 'green'}
          sub={budget > 0 ? `${pct(spent / budget)} of plan used` : undefined}
        />
        <KpiCard
          label="Categories over"
          value={String(over)}
          highlight={over > 0 ? 'red' : 'green'}
          sub={`of ${categories.length} budgeted`}
        />
      </div>

      <WhereTheMonthSits categories={categories} month={month} />

      <p className="mt-6 text-xs text-slate-400">
        Budgeted operational categories only, as the tiles show them. Alerts, new arrivals and what
        is waiting on you describe today —{' '}
        <Link href="/dashboard" className="underline hover:text-slate-600">back to {MONTHS[current]}</Link>.
      </p>
    </div>
  );
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  // The page's ONE clock read. Everything downstream — the domain module's as-of point, every
  // date-bounded query, the year in the header — is derived from these three integers, in local
  // calendar time, so nothing on this page can straddle midnight or a New Year in two directions.
  const now = new Date();
  const asOf = asOfFromDate(now);
  const monthLength = daysInMonth(asOf.year, asOf.month);

  // `?month=` is 1-based, like the Transactions drilldown's. Anything that is not an earlier month
  // of this year — garbage, the current month, the future — is simply the current month.
  const params = await searchParams;
  const asked = typeof params.month === 'string' && /^\d{1,2}$/.test(params.month) ? Number(params.month) - 1 : null;
  if (asked !== null && asked >= 0 && asked < asOf.month) {
    return <PastMonth year={asOf.year} month={asked} current={asOf.month} />;
  }

  // The picker behind every row editor in the panels below. Not from the payload, and not a figure
  // — see the note on the reader. Awaited beside the overview rather than after it, so the page
  // still issues one round of I/O.
  const categoryOptionsPromise = loadCategoryOptions();
  // Hand-valued accounts gone stale. Its own read rather than a field on /overview: it is a
  // reminder for this screen and the email, not a figure the payload's other consumers need.
  // Off-cycle draws for every budgeted category, not only the discretionary ones the outlook
  // scores — see `offCycleFrom`. Read beside the overview, like the two reads above.
  const offCyclePromise = loadOffCycle(asOf);
  const valuationFindingsPromise = loadValuationFindings(
    `${asOf.year}-${String(asOf.month + 1).padStart(2, '0')}-${String(asOf.day).padStart(2, '0')}`);

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
    // `monthlySpending` left the destructuring with the P&L chart on 2026-10-01: it fed that series
    // and nothing else here. It is still on the payload, and `/profit-loss` reads it.
    stats,
    recentArrivals, recentArrivalsTotal, uncategorized: unfiled, watchlist, yearEnd,
    monthCategories,
    feedFindings, driftFindings, jobHealth, walletFindings,
  } = dashboardFromWire(await loadOverview(now));
  // Started before the overview and collected here, so the two reads overlap rather than queue.
  const categoryOptions = await categoryOptionsPromise;
  const valuationFindings = await valuationFindingsPromise;
  const { thisMonth: offCycleThisMonth, earlier: offCycleEarlier } = await offCyclePromise;

  // EVERY operational spending category with an allocation this month, not the scored subset —
  // the bubbles are a map, not a judgement, and a map that omits groceries, fuel and utilities is
  // the wrong shape. Scoping and shaping now happen in `lib/overviewRead.ts`, once, for this page
  // and the mobile client alike.
  const monthShape: MonthCategoryView[] = monthCategories;

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
        {/* `flex-1` so that in the installed app, where the month moves onto the title's line, the
            row is as wide as the header and the month can sit at its right edge. In a tab this div
            stays a block of two lines and the extra width changes nothing. */}
        <div className="flex-1 min-w-0 standalone:flex standalone:items-center standalone:justify-between standalone:gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <DashboardMonthNav year={asOf.year} month={asOf.month} current={asOf.month} day={asOf.day} monthLength={monthLength} />
        </div>
        {/* Counted by CARD, not by finding: two institutions behind is one message about the
            feed, and five drifting accounts is one message about the ledger. The number is how
            many things there are to read, which is the only sense in which a reader counts them. */}
        <AlertBell count={(feedFindings.length > 0 ? 1 : 0) + (driftFindings.length > 0 ? 1 : 0)
          + (jobHealth.status !== 'fresh' ? 1 : 0) + (walletFindings.length > 0 ? 1 : 0)
          + (valuationFindings.length > 0 ? 1 : 0)}>
          {/* First in the bell, because it outranks the other two: they each say a figure may be
              wrong, this says every figure may be old and the backups are missing as well. */}
          <JobHealthCard health={jobHealth} />
          <FeedHealthCard findings={feedFindings} />
          <DriftAlertCard findings={driftFindings} />
          {/* Last of the four, because it is the mildest: the other three say a figure may be wrong
              through no fault of the reader's, while this says a figure is as old as the last time
              they chose to check it. It is also the only one whose cure the reader can apply today,
              which is why it is the only card here carrying an action. */}
          <CashStalenessCard findings={walletFindings} />
          {/* Cash's sibling, for the same reason last: a figure as old as the last time the owner
              refreshed it, with the action that refreshes it. */}
          <ValuationStalenessCard findings={valuationFindings} />
        </AlertBell>
        {/* The installed app's notification switch, in the app bar after the warning sign. It
            portals there, so its place in this markup only decides that it comes second. */}
        <NotificationBell vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </div>

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
      {/* OFF-CYCLE: spending in a category whose schedule gives it nothing that month. This
          month's lead, because they are the ones still happening; the earlier months follow. A
          category with no budget this month has no tile in the picture below, so without this
          panel a draw in the current month was nowhere on the page until the month after. */}
      {(offCycleThisMonth.length > 0 || offCycleEarlier.length > 0) && (
        <div className="mb-6">
          <Panel title="Off-cycle spending">
            {offCycleThisMonth.map((c) => (
              <CategoryLine key={`now-${c.categoryId}`} c={c} note="No budget this month" />
            ))}
            {offCycleEarlier.map((c) => (
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
        {/* The same figure /budget's header carries, from the same reader — where the operational
            year closes if the plan holds. It leads the page's figures because it is the one the
            others are judged against; the row it shares is now the two TARGETS, the counts having
            moved to their own line below. */}
        <KpiCard
          label="Projected P/L"
          value={`${yearEnd.profitLoss < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.profitLoss))}`}
          // No "unfiled, not counted" note, at the owner's request: Uncategorized sits in the row
          // below with its own count, which is where unfiled records are dealt with.
          sub={`${yearEnd.netToDate < 0 ? '−' : '+'}${fmt(Math.abs(yearEnd.netToDate))} so far`}
          highlight={yearEnd.profitLoss < 0 ? 'red' : 'green'}
          href="/budget"
        />
        {/* ONE CARD WHERE THERE WERE TWO. "Annual Budget" was a constant — it changes when the
            owner edits a category and never otherwise — and "Remaining" was that constant minus a
            number shown nowhere on this row. Side by side they asked the reader to subtract two
            large figures to find the one they came for, and the target took a quarter of the row
            to say something that does not move.

            The headline is what is LEFT, because that is the figure anyone acts on. The target and
            the spend become the line under it, where they are context rather than competition.

            NO PROGRESS BAR, removed at the owner's request. It showed annual spend as a share of
            the annual plan, which reads as pacing without being it — this page already answers
            pacing twice, in the bubbles and in Projected P/L, both per category per month. */}
        <KpiCard
          label="Budget remaining"
          value={fmt(stats.remaining)}
          highlight={stats.remaining < 0 ? 'red' : 'green'}
          sub={`${fmt(stats.spent)} spent of ${fmt(stats.budget)}`}
        />
      </div>

      {/* THE THREE COUNTS OF THINGS WAITING ON THE OWNER, on one line. Three columns at every
          width rather than a responsive 2-then-3: the point of the row is that they are read
          together, and a breakpoint that splits them two-and-one defeats it on exactly the narrow
          screens where scanning is hardest. These are counts, so the columns can be narrow — the
          argument against three across is about not truncating a five-figure amount. */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {/* ALL THREE COUNTS, as figures that open. Uncategorized was a separate `KpiCard` with an
            `href` until 2026-09-23, which made it the one of the three that left the page; it now
            opens beside the other two. They answer their questions in lists short enough to read
            in place, and leaving the dashboard to read six rows loses the picture they qualify.

            The panels are the same two components that used to sit above, rendered here and passed
            through: they are server components, and handing them in already rendered keeps them
            that way. `watchlist` is ordered oldest first by its reader, so `[0]` is the age. */}
        <ExpandableKpiCards
          unfiledCount={stats.uncategorized}
          unfiledPanel={
            <UncategorizedCard items={unfiled} total={stats.uncategorized} categories={categoryOptions} />
          }
          watchCount={watchlist.length}
          watchOldest={watchlist[0]?.daysOpen ?? 0}
          watchPanel={<WatchlistCard items={watchlist} categories={categoryOptions} />}
          arrivalsCount={recentArrivalsTotal}
          arrivalsShown={recentArrivals.length}
          arrivalsPanel={
            <RecentArrivals arrivals={recentArrivals} staleFeed={feedFindings.length > 0} categories={categoryOptions} />
          }
          staleFeed={feedFindings.length > 0}
        />
      </div>

      {/* THE MONTH, CATEGORY BY CATEGORY — moved BELOW the five counts on 2026-09-23 at the
          owner's request, to match the phone's order.

          It used to lead the page, on the argument that the picture says which categories are going
          wrong with the evidence attached. That still holds, but it is an argument about depth
          rather than order: the five figures above are read in a glance and this is read for a
          minute, so the glance goes first and the picture answers the question it raises.

          Tiles rather than the bubbles it packed for months, on the same day and at the same
          request — this dashboard is mostly read in the PWA now, and circle packing spends a third
          of a phone-width box on the gaps between circles. `asOf.month` rather than the component's
          own clock: the tiles and the link out of them should name one month. */}
      <WhereTheMonthSits categories={monthShape} month={asOf.month} />

      {/* Charts. THE PROFIT & LOSS CHART MOVED to `/profit-loss` on 2026-10-01 at the owner's
          request. It is a twelve-month read, half of it forecast, which is a sit-down question —
          and this page answers a glance. Same argument that moved "the year by category" to its
          own page: a page doing both does the glance worse. */}
      {/* TODAY AND THIS WEEK WERE HERE, and were removed on 2026-09-24 at the owner's request.
          They were a day's spend against the same weekday's average, and a week's against the
          same point last week.

          The figures are still read and still served — `today` and `week` remain in the
          /overview payload, which the phone consumes and the API answers with. Nothing about
          them was wrong; the page simply stopped showing them, and the reader that produces
          them is untouched so the decision is reversible with a component rather than a query. */}
      {/* "The year by category" MOVED TO /sandbox on 2026-09-24 at the owner's request. It is a
          good widget and a slow read — twenty tracks, each wanting a comparison against a pace
          mark — which is a different job from the one this page does. The dashboard answers "is
          anything wrong today" in a glance, and a page that also answers "how is the year going,
          category by category" does the first one worse. */}
      {/* The wrapper these three sat in is gone with the last of them. An empty `space-y-6` div
          renders nothing — `space-y` only applies BETWEEN children — so it cost no layout, but it
          was markup describing a section that no longer exists. */}

      {/* Turning the daily ping on, at the very foot of the page — settings rather than reading,
          reachable without being in the way. The phone put its own ping setup in the same place
          for the same reason.

          The PUBLIC key only. It is handed to every browser that subscribes and is not secret; the
          private half signs the push and never leaves the server. Read here rather than in the
          client component because `process.env` is not there to read. */}
      {/* Not in the installed app on a phone, where the bell in the app bar replaces it. */}
      <div className="mt-10 pt-6 border-t border-slate-100 max-md:standalone:hidden">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Notifications</p>
        <PushSetup vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </div>
    </div>
  );
}

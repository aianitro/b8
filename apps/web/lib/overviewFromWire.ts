import type { OverviewData } from '@b8/contracts/overview';
import type { DriftFinding } from './domain/drift';
import type { FeedFinding } from './domain/feedHealth';
import type { JobHealth } from './domain/jobHealth';
import type { OutlookCategory } from './domain/monthOutlook';
import type { WatchedTransaction } from './watchlistRead';

/**
 * The `/overview` payload, turned back into the shapes the dashboard's components take.
 *
 * ─── Why the dashboard reads the wire format at all ───────────────────────────────────────────
 *
 * P1-11a: the web dashboard adopts the payload the mobile client will consume. The page is a server
 * component and could keep reading domain objects directly — which is exactly why it must not.
 * An endpoint nothing reads drifts, and this one already did: it went four days missing three
 * sections the dashboard had grown. With the dashboard consuming it, a field the screen needs and
 * the payload lacks is a type error on the next build, not a surprise on a phone.
 *
 * It calls `loadOverview()` rather than fetching `/api/v1/overview` over HTTP. The handler is a
 * three-line wrapper around that function, so the payload is identical; an HTTP hop to itself would
 * add latency and require forwarding the session cookie, for no change in what is read.
 *
 * ─── What changes in the conversion, and what cannot ──────────────────────────────────────────
 *
 * Money arrives as strings, cent-rounded by the server. `Number()` of a cent-rounded decimal string
 * is exact to the cent, and every figure on the page is displayed to the dollar or the cent, so no
 * displayed value can differ. Timestamps arrive as ISO strings and become `Date`s where a component
 * takes one.
 *
 * A NULL STAYS NULL. `Number(null)` is 0, and on this page 0 and null mean different things — "on
 * plan" against "no basis to judge". Every nullable money field goes through `nullableMoney`.
 */

function money(value: string): number {
  const n = Number(value);
  // The schema already rejected anything that is not a numeric string; this is the second fence,
  // because a NaN reaching a chart renders as a silent gap rather than an error.
  if (!Number.isFinite(n)) throw new RangeError(`overviewFromWire: not a money value: ${value}`);
  return n;
}

function nullableMoney(value: string | null): number | null {
  return value === null ? null : money(value);
}

export function outlookCategoryFromWire(c: OverviewData['monthOutlook']['offCycleElsewhere'][number]): OutlookCategory {
  return {
    ...c,
    budgeted: money(c.budgeted),
    actual: money(c.actual),
    projected: nullableMoney(c.projected),
    projectedVariance: nullableMoney(c.projectedVariance),
    recurringExpected: nullableMoney(c.recurringExpected),
    recurringPosted: nullableMoney(c.recurringPosted),
  };
}

export function feedFindingFromWire(f: OverviewData['feedHealth'][number]): FeedFinding {
  return { ...f, lastSuccessfulUpdate: f.lastSuccessfulUpdate === null ? null : new Date(f.lastSuccessfulUpdate) };
}

export function driftFindingFromWire(d: OverviewData['driftFindings'][number]): DriftFinding {
  return {
    ...d,
    ledgerBalance: money(d.ledgerBalance),
    expectedBalance: money(d.expectedBalance),
    drift: money(d.drift),
    suggestedBeginningBalance: money(d.suggestedBeginningBalance),
  };
}

/** Everything the dashboard renders, in the types its components take. */
export function dashboardFromWire(data: OverviewData) {
  const stats = {
    budget: money(data.stats.budget),
    spent: money(data.stats.spent),
    remaining: money(data.stats.remaining),
    uncategorized: data.stats.uncategorized,
    totalTxns: data.stats.totalTxns,
  };

  return {
    asOf: data.asOf,
    stats,
    today: {
      spent: money(data.today.spent),
      avgSameWeekday: money(data.today.avgSameWeekday),
      transactions: data.today.transactions.map((t) => ({ label: t.label, amount: money(t.amount) })),
      totalCount: data.today.totalCount,
    },
    week: {
      spent: money(data.week.spent),
      spentComparableLastWeek: money(data.week.spentComparableLastWeek),
      weeklyBudgetReference: money(data.week.weeklyBudgetReference),
      isoDow: data.week.isoDow,
    },
    monthlySpending: data.monthlySpending.map((m) => ({
      month: m.month,
      operational: money(m.operational),
      received: money(m.received),
    })),
    recentArrivals: data.recentArrivals.map((r) => ({ ...r, amount: money(r.amount) })),
    // The sample behind the Uncategorized card. `stats.uncategorized` remains the COUNT — this is
    // capped, so its length is not it, and the panel says so when the two differ.
    uncategorized: data.uncategorized.map((r) => ({ ...r, amount: money(r.amount) })),
    // The count BEFORE the reader's limit of twelve, so a card counting arrivals says how many
    // there are rather than how many it was handed. See the field's note in the contract.
    recentArrivalsTotal: data.recentArrivalsTotal,
    budgetVsActual: data.budgetVsActual.map((b) => ({
      category: b.category,
      budget: money(b.budget),
      spent: money(b.spent),
    })),
    offCycleElsewhere: data.monthOutlook.offCycleElsewhere.map(outlookCategoryFromWire),
    monthCategories: data.monthCategories.map((c) => ({
      category: c.category,
      budgeted: money(c.budgeted),
      actual: money(c.actual),
      projectedRatio: c.projectedRatio,
      tooEarly: c.tooEarly,
    })),
    yearEnd: {
      profitLoss: money(data.yearEnd.profitLoss),
      netToDate: money(data.yearEnd.netToDate),
      uncategorizedNet: money(data.yearEnd.uncategorized.net),
      monthly: data.yearEnd.monthly.map((p) => ({
        income: money(p.income),
        expense: money(p.expense),
        cumulative: money(p.cumulative),
        projected: p.projected,
      })),
    },
    feedFindings: data.feedHealth.map(feedFindingFromWire),
    driftFindings: data.driftFindings.map(driftFindingFromWire),
    watchlist: data.watchlist.map(
      (w): WatchedTransaction => ({ ...w, amount: money(w.amount) })
    ),
    jobHealth: data.jobHealth as JobHealth,
  };
}

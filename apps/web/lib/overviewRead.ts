// The dashboard's whole payload, composed once and formatted for the wire — the data shell behind
// `GET /api/v1/overview`.
//
// WHY THE COMPOSITION LIVES HERE AND NOT IN THE ROUTE FILE. `vitest.config.mts` states the rule in
// its own header — "Unit tests only, deliberately… API-route contract tests against a test DB are
// tier 2" — and its `include` list is `lib/`, `shared/` and the hooks. `app/**` is not in it and
// this task does not add it. So every part of this endpoint that can be proved without a database
// (the money formatting, the null preservation, the Date-to-string boundary, the one subtraction)
// has to be reachable from a test file under `lib/` to run in the suite this repo already has.
// `app/api/v1/overview/route.ts` is left as the HTTP wrapper: it calls `loadOverview()` and hands
// the result to `Response.json`. The naming follows the convention already in this directory —
// `lib/feedHealthRead.ts`, `lib/monthOutlookRead.ts`, `lib/yearEndRead.ts` are each the I/O shell
// for one dashboard concept, and this is the shell for all of them at once.
//
// THE SPLIT INSIDE THIS FILE. `composeOverview` is pure: raw reads in, wire payload out, no `db`
// anywhere in it. `loadOverview` is the shell that issues the queries and calls it. The pure half
// is where every rule below is testable, and it is the half the fixtures exercise.
//
// WHAT THIS FILE MAY NOT DO, because it is the defect BUILD.md §14's own worked example ends on:
// re-derive a figure one of the four shared readers already owns. `loadFeedHealth`,
// `loadMonthOutlook`, `loadYearEnd` and `findBalanceDrift` are each the single definition of their
// concept, shared today with the dashboard and (for the outlook) with the daily breach-alert job.
// A second SQL path computing the same numbers passes every test that checks a figure looks
// plausible and fails only the one that checks it AGREES with the other caller. They are called,
// never copied.
//
// THE SIX QUERIES BELOW ARE NOW THE ONLY COPY. They began as private functions inside
// `app/dashboard/page.tsx` — `getStats`, `getTodayStats`, `getWeekStats`, `getMonthlySpending`,
// `getRecentArrivals`, `getBudgetVsActual` — and were carried here for the endpoint with their
// predicates unchanged. P1-11a checked the two copies were still identical on 2026-09-17, deleted
// the page's, and pointed the dashboard at `loadOverview`. The dashboard and the API therefore read
// one definition; a change to a figure made here changes both, which is the point.

import db from './db';
import { roundCents } from './budgetMath';
import { withoutNegativeZero } from './domain/adherence';
import type { AsOf } from './domain/pacing';
import type { MonthOutlook, OutlookCategory } from './domain/monthOutlook';
import { asOfFromDate } from './domain/monthOutlook';
import type { CategorizationCoverage } from './domain/monthOutlook';
import type { AdherenceFinding, MonthVariance, ScoredHeadline } from './domain/adherence';
import type { MonthPoint } from './domain/yearEnd';
import type { FeedFinding } from './domain/feedHealth';
import type { DriftFinding } from './domain/drift';
import { findBalanceDrift } from './drift';
import type { JobHealth } from './domain/jobHealth';
import { loadJobHealth } from './jobHealthRead';
import type { WatchedTransaction } from './watchlistRead';
import { loadWatchlist } from './watchlistRead';
import { loadFeedHealth } from './feedHealthRead';
import { loadMonthOutlook } from './monthOutlookRead';
import { loadYearEnd, type YearEndRead } from './yearEndRead';
import { MONTHS } from './drilldown';
import type { Assert, Equals } from '@b8/contracts/exact';
import type { OverviewData } from '@b8/contracts/overview';

// ---------------------------------------------------------------------------------------------
// The compile-time half of the contract, relocated here on the guardian's instruction.
//
// `shared/contracts/overview.ts` cannot state these itself. enums.ts and shapes.ts pin each schema
// to its TypeScript counterpart with `Assert<Equals<…>>`, so a divergence is an `npx tsc --noEmit`
// failure rather than a review item; the overview contract gives that up deliberately, because
// `YearEndRead` is declared in `lib/yearEndRead.ts`, which imports `./db`. A type-only import is
// erased at runtime but is still a real `ImportDeclaration` in the AST, and the checks this repo
// uses to prove the contract surface cannot reach a connection pool parse exactly those nodes.
// A module specifier pointing at a database shell, sitting in a contract file, is indistinguishable
// from the violation those checks exist to catch.
//
// This module may legitimately import both sides, so the assertion lands here instead. The cost was
// relocated, not waived.
//
// KEY SETS, NOT VALUE TYPES, and that is the point rather than a weakening. The values diverge ON
// PURPOSE: `MonthOutlook.headline.budgeted` is a `number` because `lib/domain/adherence.ts` computes
// it as one, and `OverviewData`'s is a `string` because money crosses this wire as a two-decimal
// decimal string. `Equals` over the value types would fail on every money field and would have to be
// deleted. Over the key sets it fails on exactly what it is for: a field added to, removed from or
// renamed in `lib/domain/**` that this payload then silently stops carrying.

export type AsOfFieldsAreExact = Assert<Equals<keyof OverviewData['asOf'], keyof AsOf>>;

export type MonthOutlookFieldsAreExact = Assert<
  Equals<keyof OverviewData['monthOutlook'], keyof MonthOutlook>
>;

export type OutlookCategoryFieldsAreExact = Assert<
  Equals<keyof OverviewData['monthOutlook']['sayingNo'][number], keyof OutlookCategory>
>;

export type ScoredHeadlineFieldsAreExact = Assert<
  Equals<keyof NonNullable<OverviewData['monthOutlook']['headline']>, keyof ScoredHeadline>
>;

export type CategorizationCoverageFieldsAreExact = Assert<
  Equals<keyof OverviewData['monthOutlook']['coverage'], keyof CategorizationCoverage>
>;

/**
 * `MonthVariance` is reached through the chronic-underspend branch's `months`, not through
 * `findings[number]`: `keyof` over a union yields only the keys both branches share, which would
 * make this assertion pass while a breach gained a field nobody carried.
 */
export type MonthVarianceFieldsAreExact = Assert<
  Equals<
    keyof Extract<
      OverviewData['monthOutlook']['findings'][number],
      { kind: 'chronic-underspend' }
    >['months'][number],
    keyof MonthVariance
  >
>;

export type BreachFindingFieldsAreExact = Assert<
  Equals<
    keyof Extract<OverviewData['monthOutlook']['findings'][number], { kind: 'breach' }>,
    keyof Extract<AdherenceFinding, { kind: 'breach' }>
  >
>;

export type ChronicUnderspendFindingFieldsAreExact = Assert<
  Equals<
    keyof Extract<OverviewData['monthOutlook']['findings'][number], { kind: 'chronic-underspend' }>,
    keyof Extract<AdherenceFinding, { kind: 'chronic-underspend' }>
  >
>;

export type YearEndReadFieldsAreExact = Assert<Equals<keyof OverviewData['yearEnd'], keyof YearEndRead>>;

export type YearEndUncategorizedFieldsAreExact = Assert<
  Equals<keyof OverviewData['yearEnd']['uncategorized'], keyof YearEndRead['uncategorized']>
>;

export type MonthPointFieldsAreExact = Assert<
  Equals<keyof OverviewData['yearEnd']['monthly'][number], keyof MonthPoint>
>;

export type FeedFindingFieldsAreExact = Assert<
  Equals<keyof OverviewData['feedHealth'][number], keyof FeedFinding>
>;

export type DriftFindingFieldsAreExact = Assert<
  Equals<keyof OverviewData['driftFindings'][number], keyof DriftFinding>
>;

// ---------------------------------------------------------------------------------------------
// Money, on the wire.

/**
 * A dollar figure as this payload puts it on the wire: a decimal string at exactly cent scale.
 *
 * ROUNDING HAPPENS HERE AND NOWHERE ELSE, once per figure. Most values reaching this function are
 * already at cent scale — they came off a `NUMERIC(12,2)` column or a SQL sum of them — but the
 * ones from `lib/domain/**` are float arithmetic and are not: a projection is a run rate multiplied
 * by a day count, and `Sport` projecting to `993.7500000000001` is the literal value the dashboard's
 * own renderer has been hiding behind `Intl.NumberFormat` since it shipped. This is that same
 * rounding, moved from the client to the response boundary. It is not a new rule, and the rounded
 * figure is never fed back into a comparison — `shared/contracts/overview.ts` describes and refuses
 * to round for the same reason.
 *
 * THREE STEPS, IN THIS ORDER, and the order is the part that is easy to get wrong:
 *
 *   1. `roundCents` — the one rounding, explicit rather than delegated to `toFixed`'s binary
 *      behaviour, so the cent the payload states is a cent this code chose. Imported from
 *      `lib/budgetMath.ts`, where eight other modules already get it, rather than respelled as
 *      `Math.round(value * 100) / 100` — which is that function's byte-identical body and would be
 *      a second copy of one rounding rule, the same argument that applies to `withoutNegativeZero`
 *      below.
 *   2. `withoutNegativeZero` — imported from `lib/domain/adherence.ts` rather than rewritten as
 *      `n === 0 ? 0 : n`, because a second copy of a rule is a second place for it to drift. It has
 *      to run AFTER the rounding, not before: `-0.004` is not `-0`, so a normalization applied to
 *      the input passes it through untouched and `.toFixed(2)` then prints `"-0.00"` — a minus sign
 *      in front of a figure that is not negative. Rounding is what produces the `-0` this call
 *      exists to catch.
 *   3. `.toFixed(2)` — padding, not rounding, on a value that is already at cent scale. `"7.5"` and
 *      `"7.50"` are the same number and a consumer parsing by rule should not have to know that.
 *
 * `moneyString` in the contract is `numericString` narrowed to `/^-?\d+\.\d{2}$/`, so a figure that
 * skipped this function fails validation rather than reaching a client unrounded.
 *
 * NO SIGN HANDLING. This ledger's convention is positive = money out, negative = income, and every
 * value arriving here has already been normalized by whatever read it. Flipping or clamping a sign
 * at a formatting step is how a refund becomes a charge.
 */
export function wireMoney(value: number): string {
  return withoutNegativeZero(roundCents(value)).toFixed(2);
}

/**
 * The same, for a figure that is legitimately absent.
 *
 * `null` IN, `null` OUT — never `"0.00"`. `OutlookCategory.projected` is `null` when the month is
 * too young to project or the record carries no budget to project against, and a formatting helper
 * that ran `.toFixed(2)` unconditionally would turn "we cannot say" into "this category is heading
 * for nothing", which is a different and false statement. BUILD.md §10.3 names `null` rendered as
 * `0` as a defect class by itself, and an unguarded formatter is the single likeliest way a payload
 * this size commits it.
 */
export function wireMoneyOrNull(value: number | null): string | null {
  return value === null ? null : wireMoney(value);
}

// ---------------------------------------------------------------------------------------------
// The pure composition.

/**
 * Everything the composer needs, as the readers hand it over — unformatted, unrounded, signed.
 *
 * `stats` carries `budget` and `spent` and NOT `remaining`: the subtraction is the one arithmetic
 * operation this endpoint performs, and it belongs on the far side of this boundary so a fixture
 * can watch it happen. See `composeOverview`.
 *
 * `feedHealth` arrives with a live `Date` on `lastSuccessfulUpdate`, exactly as
 * `lib/domain/feedHealth.ts` declares it. That is the N4 shape, and converting it is this module's
 * job — see `wireFeedFinding`.
 */
export interface OverviewSources {
  asOf: AsOf;
  stats: { budget: number; spent: number; uncategorized: number; totalTxns: number };
  today: {
    spent: number;
    avgSameWeekday: number;
    transactions: { label: string; amount: number }[];
    totalCount: number;
  };
  week: {
    spent: number;
    spentComparableLastWeek: number;
    weeklyBudgetReference: number;
    isoDow: number;
  };
  monthlySpending: { month: string; operational: number; received: number }[];
  recentArrivalsTotal: number;
  recentArrivals: {
    id: number;
    date: string;
    amount: number;
    label: string;
    category: string | null;
    watched: boolean;
    note: string | null;
  }[];
  /** A capped sample of what `stats.uncategorized` counts — see the field's note in the contract. */
  uncategorized: {
    id: number;
    date: string;
    amount: number;
    label: string;
    category: string | null;
    watched: boolean;
    note: string | null;
  }[];
  budgetVsActual: { category: string; budget: number; spent: number }[];
  monthOutlook: MonthOutlook;
  /**
   * Every category with a budget this month, already narrowed to what a bubble needs.
   *
   * Narrowed by the CALLER rather than here, because the narrowing is a scope decision — the as-of
   * month only, and categories with an allocation — and `composeOverview` is a pure shaper that
   * should not be deciding which rows exist.
   */
  monthCategories: {
    category: string;
    budgeted: number;
    actual: number;
    projectedRatio: number | null;
    tooEarly: boolean;
  }[];
  yearEnd: YearEndRead;
  feedHealth: FeedFinding[];
  driftFindings: DriftFinding[];
  watchlist: WatchedTransaction[];
  jobHealth: JobHealth;
}

function wireMonthVariance(v: MonthVariance): Extract<
  OverviewData['monthOutlook']['findings'][number],
  { kind: 'chronic-underspend' }
>['months'][number] {
  return {
    month: v.month,
    budgeted: wireMoney(v.budgeted),
    actual: wireMoney(v.actual),
    variance: wireMoney(v.variance),
    // A ratio, not money. Cent-rounding a percentage quantizes it into 1% steps, and `null` here
    // means nothing was budgeted to be a percentage of — never `0`, which reads "on budget".
    ratio: v.ratio,
  };
}

function wireFinding(f: AdherenceFinding): OverviewData['monthOutlook']['findings'][number] {
  // Switched on `kind` rather than spread-and-patched, because the two branches carry money at two
  // different SCALES — a breach is one month, a chronic-underspend defect is a whole window — and
  // the discriminant is what keeps a consumer from adding them. P0.5-29a removed a field to make
  // that addition unrepresentable; flattening the union here would put it back.
  if (f.kind === 'breach') {
    return {
      ...wireMonthVariance(f),
      kind: 'breach',
      categoryId: f.categoryId,
      category: f.category,
      scored: f.scored,
    };
  }
  return {
    kind: 'chronic-underspend',
    categoryId: f.categoryId,
    category: f.category,
    scored: f.scored,
    months: f.months.map(wireMonthVariance),
    budgeted: wireMoney(f.budgeted),
    actual: wireMoney(f.actual),
    variance: wireMoney(f.variance),
  };
}

function wireHeadline(h: ScoredHeadline): NonNullable<OverviewData['monthOutlook']['headline']> {
  return {
    scoredCategoryCount: h.scoredCategoryCount,
    breachCount: h.breachCount,
    defectCount: h.defectCount,
    budgeted: wireMoney(h.budgeted),
    actual: wireMoney(h.actual),
    variance: wireMoney(h.variance),
    varianceRatio: h.varianceRatio,
  };
}

/**
 * The coverage record — three money figures and three counts, and the split is the module's own.
 *
 * `scoredSpend`/`unattributedSpend`/`orphanedSpend` are dollar amounts and are formatted, even
 * though SPEC.md's illustrative list of `monthOutlook` money fields does not name them: the rule it
 * states is "every field representing a dollar amount, in every section", and a payload where
 * twenty-eight of its dollar figures are strings and three are numbers is one no consumer can parse
 * by rule. The counts stay integers, because `categorizationCoverage` computes a share of DOLLARS
 * and never divides the counts — one uncategorized $4,000 transfer against forty $12 coffees is
 * 97.6% by count and useless by dollars.
 */
function wireCoverage(c: CategorizationCoverage): OverviewData['monthOutlook']['coverage'] {
  return {
    scoredSpend: wireMoney(c.scoredSpend),
    scoredCount: c.scoredCount,
    unattributedSpend: wireMoney(c.unattributedSpend),
    unattributedCount: c.unattributedCount,
    orphanedSpend: wireMoney(c.orphanedSpend),
    orphanedCount: c.orphanedCount,
    coverageShare: c.coverageShare,
    coveragePercent: c.coveragePercent,
    authoritative: c.authoritative,
  };
}

function wireOutlookCategory(c: OutlookCategory): OverviewData['monthOutlook']['sayingNo'][number] {
  return {
    categoryId: c.categoryId,
    category: c.category,
    controlMode: c.controlMode,
    status: c.status,
    month: c.month,
    // Days, not money. The qualifier a projection may not be printed without.
    elapsedDays: c.elapsedDays,
    daysInMonth: c.daysInMonth,
    budgeted: wireMoney(c.budgeted),
    actual: wireMoney(c.actual),
    spentRatio: c.spentRatio,
    // The four nullable money fields, every one of them through the null-preserving formatter.
    projected: wireMoneyOrNull(c.projected),
    projectedVariance: wireMoneyOrNull(c.projectedVariance),
    projectedRatio: c.projectedRatio,
    recurringExpected: wireMoneyOrNull(c.recurringExpected),
    recurringPosted: wireMoneyOrNull(c.recurringPosted),
    reason: c.reason,
    withheldReason: c.withheldReason,
  };
}

/**
 * The month's verdict, carried whole.
 *
 * `coverageShare`/`coveragePercent`/`authoritative` appear both here and one level down on
 * `coverage`, and both copies are carried rather than one being pruned: the domain module duplicates
 * them deliberately so a renderer cannot reach the hero without the caveat under it. They are the
 * same values and a consumer may rely on them agreeing.
 */
function wireMonthOutlook(o: MonthOutlook): OverviewData['monthOutlook'] {
  return {
    asOf: { year: o.asOf.year, month: o.asOf.month, day: o.asOf.day },
    state: o.state,
    scoredCategoryCount: o.scoredCategoryCount,
    sayingNo: o.sayingNo.map(wireOutlookCategory),
    holding: o.holding.map(wireOutlookCategory),
    withheld: o.withheld.map(wireOutlookCategory),
    offCycleElsewhere: o.offCycleElsewhere.map(wireOutlookCategory),
    headline: o.headline === null ? null : wireHeadline(o.headline),
    findings: o.findings.map(wireFinding),
    coverage: wireCoverage(o.coverage),
    coverageShare: o.coverageShare,
    coveragePercent: o.coveragePercent,
    authoritative: o.authoritative,
  };
}

function wireMonthPoint(m: MonthPoint): OverviewData['yearEnd']['monthly'][number] {
  return {
    income: wireMoney(m.income),
    expense: wireMoney(m.expense),
    net: wireMoney(m.net),
    cumulative: wireMoney(m.cumulative),
    // A BOOLEAN, and the one field in this payload whose name collides with a money field
    // elsewhere in it: `OutlookCategory.projected` is nullable dollars, this one is "is this month
    // forecast rather than settled". Named rather than renamed — renaming on the way through would
    // make the payload disagree with the module that produced it.
    projected: m.projected,
  };
}

function wireYearEnd(y: YearEndRead): OverviewData['yearEnd'] {
  return {
    income: wireMoney(y.income),
    expense: wireMoney(y.expense),
    profitLoss: wireMoney(y.profitLoss),
    netToDate: wireMoney(y.netToDate),
    uncategorized: {
      income: wireMoney(y.uncategorized.income),
      expense: wireMoney(y.uncategorized.expense),
      net: wireMoney(y.uncategorized.net),
    },
    monthly: y.monthly.map(wireMonthPoint),
  };
}

/**
 * THE N4 CONVERSION, and it is the reason this endpoint was judged likely to ship a known defect.
 *
 * `lastSuccessfulUpdate` is typed `Date | null` all the way through `lib/domain/feedHealth.ts` and
 * `lib/feedHealthRead.ts`, because `pg` parses a `TIMESTAMPTZ` into a JS `Date` and nothing between
 * there and here converts it. The contract models the field with `timestamptz` — the existing
 * STRING schema — because that is what a consumer receives once `Response.json` has called
 * `Date.prototype.toJSON` on it.
 *
 * Converted explicitly here rather than left for `JSON.stringify` to do implicitly. Both produce
 * the same bytes on the wire, and the difference is what the compiler can see: with the conversion
 * written down, `composeOverview` genuinely returns an `OverviewData` and `npx tsc --noEmit` proves
 * it. Left implicit, the function would have to claim a `string` where it held a `Date`, and the
 * first person to call `.parse()` on the composed object — rather than on the round-tripped one —
 * gets a rejection the types told them could not happen. That is P1-10 NITS.md N4, measured.
 *
 * `driftFindings[].observedAt` is the instructive contrast and needs no conversion at all:
 * `lib/drift.ts` calls `.toISOString()` itself, so it is already a string. Same wire type, different
 * provenance — the one that has to be converted is the one that is easy to miss.
 */
function wireFeedFinding(f: FeedFinding): OverviewData['feedHealth'][number] {
  return {
    institution: f.institution,
    accountCount: f.accountCount,
    state: f.state,
    lastSuccessfulUpdate: f.lastSuccessfulUpdate === null ? null : f.lastSuccessfulUpdate.toISOString(),
    // Whole hours, and `null` when there has never been a successful update — not `0`, which would
    // read as "fresh". A count of hours, not money.
    hoursStale: f.hoursStale,
  };
}

function wireDriftFinding(d: DriftFinding): OverviewData['driftFindings'][number] {
  return {
    accountId: d.accountId,
    name: d.name,
    ledgerBalance: wireMoney(d.ledgerBalance),
    expectedBalance: wireMoney(d.expectedBalance),
    drift: wireMoney(d.drift),
    observedAt: d.observedAt,
    suggestedBeginningBalance: wireMoney(d.suggestedBeginningBalance),
    safeToDerive: d.safeToDerive,
  };
}

/**
 * Raw reads in, wire payload out. Pure — no `db`, no clock, no `Date.now()`.
 *
 * `stats.remaining` IS THE ONE ARITHMETIC OPERATION THIS ENDPOINT PERFORMS, and it is computed from
 * the two raw numbers BEFORE either is formatted. Never by parsing the two decimal strings back:
 * that is invisible on already-2-decimal data, which is all this payload normally carries, and goes
 * live the moment either operand gains precision — the two roundings then compound in the same
 * direction and the remainder is off by a cent that reconciles against nothing.
 */
export function composeOverview(sources: OverviewSources): OverviewData {
  const { budget, spent } = sources.stats;

  return {
    asOf: { year: sources.asOf.year, month: sources.asOf.month, day: sources.asOf.day },
    stats: {
      budget: wireMoney(budget),
      spent: wireMoney(spent),
      remaining: wireMoney(budget - spent),
      // Counts. `stats.uncategorized > 0` is the condition the dashboard colours an alert on, and
      // stringifying it would make that a string comparison that is right for the wrong reason.
      uncategorized: sources.stats.uncategorized,
      totalTxns: sources.stats.totalTxns,
    },
    today: {
      spent: wireMoney(sources.today.spent),
      // `"0.00"` when there is no trailing-30-day baseline. That is the page's own pre-existing
      // `COALESCE(AVG(...), 0)` carried through unchanged, not a null rendered as zero by this
      // step — this task composes rather than repairs it, and the distinction is recorded so
      // nobody converts it to a nullable field without deciding to.
      avgSameWeekday: wireMoney(sources.today.avgSameWeekday),
      transactions: sources.today.transactions.map((t) => ({
        label: t.label,
        amount: wireMoney(t.amount),
      })),
      totalCount: sources.today.totalCount,
    },
    week: {
      spent: wireMoney(sources.week.spent),
      spentComparableLastWeek: wireMoney(sources.week.spentComparableLastWeek),
      weeklyBudgetReference: wireMoney(sources.week.weeklyBudgetReference),
      // Monday = 1 … Sunday = 7. A day index, read database-side, not money.
      isoDow: sources.week.isoDow,
    },
    monthlySpending: sources.monthlySpending.map((m) => ({
      month: m.month,
      operational: wireMoney(m.operational),
      received: wireMoney(m.received),
    })),
    recentArrivalsTotal: sources.recentArrivalsTotal,
    recentArrivals: sources.recentArrivals.map((r) => ({
      id: r.id,
      date: r.date,
      amount: wireMoney(r.amount),
      label: r.label,
      watched: r.watched,
      note: r.note,
      // `null` for an uncategorized row, never `''` and never the string `'Uncategorized'`.
      category: r.category,
    })),
    uncategorized: sources.uncategorized.map((r) => ({
      id: r.id,
      date: r.date,
      amount: wireMoney(r.amount),
      label: r.label,
      category: r.category,
      watched: r.watched,
      note: r.note,
    })),
    budgetVsActual: sources.budgetVsActual.map((b) => ({
      category: b.category,
      budget: wireMoney(b.budget),
      spent: wireMoney(b.spent),
    })),
    monthOutlook: wireMonthOutlook(sources.monthOutlook),
    monthCategories: sources.monthCategories.map((c) => ({
      category: c.category,
      budgeted: wireMoney(c.budgeted),
      actual: wireMoney(c.actual),
      // A RATIO, NOT MONEY — not passed through `wireMoney`, which cent-rounds. Quantising a
      // projection into 1% steps would be precision the projection does not have, and `null` here
      // means "no basis to project from", which `bubbleColor` reads as "too early to call".
      projectedRatio: c.projectedRatio,
      tooEarly: c.tooEarly,
    })),
    yearEnd: wireYearEnd(sources.yearEnd),
    feedHealth: sources.feedHealth.map(wireFeedFinding),
    driftFindings: sources.driftFindings.map(wireDriftFinding),
    watchlist: sources.watchlist.map((w) => ({
      id: w.id,
      date: w.date,
      label: w.label,
      amount: wireMoney(w.amount),
      category: w.category,
      note: w.note,
      daysOpen: w.daysOpen,
    })),
    jobHealth: sources.jobHealth,
  };
}

// ---------------------------------------------------------------------------------------------
// The six ad hoc reads, carried over from `app/dashboard/page.tsx` with their predicates unchanged.
//
// The comments on each are the page's own, because they record what the predicate cost to get
// right — which figure was wrong before it, and by how much. Dropping them in transit would leave
// six WHERE clauses that look arbitrary and invite the next reader to "simplify" one.

/**
 * The four headline counters — rendered by the dashboard and served by the API.
 */
async function readStats(asOf: AsOf): Promise<OverviewSources['stats']> {
  const result = await db.query<{
    total_budget: string; ytd_spent: string; uncategorized: string; total_txns: string;
  }>(`
    SELECT
      -- OPERATIONAL only, and expenses only.
      --
      -- is_income was already excluded on both halves: a salary category carries an annual_budget
      -- too, and counting it made "Annual Budget" the sum of what is planned to be spent AND what
      -- is expected to come in.
      --
      -- The landscape predicate is newer and fixes the same shape of error one level up. These two
      -- cards were summing both books while everything around them — the hero, the bubbles, the
      -- P/L chart and card — reads operational, so "Annual Budget" was $309,946 against an
      -- operational plan of $139,237, and "Remaining" was −$58,312, a figure driven almost entirely
      -- by a bathroom remodel overrunning its capital allocation rather than by anything in the
      -- monthly budget beneath it.
      --
      -- Net of refunds, not gross, matching app/budget/page.tsx. Those two disagreed by $11,169
      -- across 2026, which was enough for the same year to read over pace on one page and on track
      -- on the other.
      (SELECT COALESCE(SUM(annual_budget), 0) FROM budget_categories
        WHERE exclude_from_budget = FALSE AND is_income = FALSE
          AND landscape = 'operational')::text AS total_budget,
      (SELECT COALESCE(SUM(t.amount), 0)
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         JOIN budget_categories bc ON bc.name = t.mapped_category
              AND bc.exclude_from_budget = FALSE AND bc.is_income = FALSE
              AND bc.landscape = 'operational'
         WHERE EXTRACT(YEAR FROM t.date) = $1 AND t.hidden = FALSE)::text AS ytd_spent,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         -- readUncategorized LISTS these same rows and repeats this predicate. The two must
         -- agree: a card reading four above a panel showing five is a contradiction a reader
         -- resolves by distrusting both. They cannot be one query — this is unbounded, that is
         -- capped — so each names the other instead.
         WHERE t.mapped_category IS NULL AND t.hidden = FALSE)::text AS uncategorized,
      (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.hidden = FALSE)::text AS total_txns
  `, [asOf.year]);
  const r = result.rows[0];
  return {
    budget: Number(r.total_budget),
    spent: Number(r.ytd_spent),
    uncategorized: Number(r.uncategorized),
    totalTxns: Number(r.total_txns),
  };
}

/**
 * What arrived since the previous day's sync — rendered by the dashboard and served by the API.
 *
 * Keyed on `created_at`, not on the transaction DATE: the question is what is new to the reader,
 * and a charge dated the 9th that landed this morning is news while one dated today that arrived
 * two syncs ago is not. Those differ by a day or more on every card feed.
 *
 * 36 hours rather than 24 so a sync running an hour later than yesterday's does not silently drop
 * a day's arrivals out of the window.
 *
 * THE ONE SECTION WITH NO LANDSCAPE FILTER AND NO `exclude_from_budget` FILTER. It deliberately
 * shows both books, because the question it answers is "what is new", not "what counts against a
 * budget". Only `hidden = FALSE` applies. Copying the other sections' predicate onto it by
 * resemblance is one of the failure modes this endpoint was specified to avoid.
 */
async function readRecentArrivals(): Promise<{
  rows: OverviewSources['recentArrivals'];
  total: number;
}> {
  // COUNTED AND LISTED IN ONE ROUND TRIP, over one predicate written once. The count exists because
  // the list is capped at twelve and the cap is invisible in the array's length: a card counting
  // the rows reads "12" whether twelve arrived or forty did. Two queries would be two copies of
  // the WHERE clause, and the day they drift the count stops describing the list beneath it.
  const { rows } = await db.query<{
    id: number; date: string; amount: string; label: string;
    category: string | null; created_at: string; watched: boolean; note: string | null;
    total: string;
  }>(`
    SELECT t.id, t.date::text, t.amount::text,
           COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
           t.mapped_category AS category, t.created_at::text,
           -- An arrival can ALSO be watched: this read has no watched bound and loadWatchlist has
           -- no date bound. Carried so an editor opened from this list starts from the truth
           -- rather than from an assumption that the two lists cannot overlap.
           (t.watched_at IS NOT NULL) AS watched,
           t.note,
           COUNT(*) OVER ()::text AS total
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.created_at > NOW() - INTERVAL '36 hours'
       AND t.hidden = FALSE
     ORDER BY t.amount DESC, t.id
     LIMIT 12
  `);
  return {
    // `COUNT(*) OVER ()` is evaluated BEFORE the LIMIT, so it is the size of the window rather than
    // of the page. Zero rows means zero arrivals, which is the only case the window function cannot
    // report — hence the fallback rather than a non-null assertion.
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({
      id: r.id, date: r.date, amount: Number(r.amount),
      label: r.label, category: r.category, watched: r.watched, note: r.note,
    })),
  };
}

/** Today, against the same weekday's recent average — rendered by the dashboard and served by the API. */
async function readToday(): Promise<OverviewSources['today']> {
  const [todayResult, avgResult, txnsResult] = await Promise.all([
    db.query<{ spent: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date = CURRENT_DATE
        AND t.hidden = FALSE
        -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
        -- whether an unfiled row is income, spend or half a transfer, and the last one to
        -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
        -- them, because a row with no category row fails it.
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    // Average of the same weekday's total spend over the trailing 30 days (excluding today) —
    // "is today unusual" without building full anomaly detection.
    //
    // EXTRACT(DOW) here is 0–6 with Sunday = 0, while `readWeek` below uses EXTRACT(ISODOW),
    // which is 1–7 with Monday = 1. Both are correct for what they do and swapping them is a
    // one-word edit that still returns a plausible integer.
    db.query<{ avg_spent: string }>(`
      SELECT COALESCE(AVG(daily_total), 0)::text AS avg_spent
      FROM (
        SELECT t.date, SUM(t.amount) FILTER (WHERE t.amount > 0) AS daily_total
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
        LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
        WHERE t.date >= CURRENT_DATE - INTERVAL '30 days'
          AND t.date < CURRENT_DATE
          AND EXTRACT(DOW FROM t.date) = EXTRACT(DOW FROM CURRENT_DATE)
          AND t.hidden = FALSE
          AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
        GROUP BY t.date
      ) daily
    `),
    db.query<{ name: string | null; merchant_name: string | null; amount: string; total_count: string }>(`
      SELECT t.name, t.merchant_name, t.amount::text, COUNT(*) OVER()::text AS total_count
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      WHERE t.date = CURRENT_DATE AND t.hidden = FALSE AND t.amount > 0
      ORDER BY t.amount DESC
      LIMIT 3
    `),
  ]);
  return {
    spent: Number(todayResult.rows[0]?.spent ?? 0),
    avgSameWeekday: Number(avgResult.rows[0]?.avg_spent ?? 0),
    transactions: txnsResult.rows.map((r) => ({
      label: r.merchant_name ?? r.name ?? 'Transaction',
      amount: Number(r.amount),
    })),
    totalCount: Number(txnsResult.rows[0]?.total_count ?? 0),
  };
}

/** This week, against the same point last week — rendered by the dashboard and served by the API. */
async function readWeek(): Promise<OverviewSources['week']> {
  const [weekResult, lastWeekResult, budgetResult] = await Promise.all([
    db.query<{ spent: string; iso_dow: number }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent,
             -- Read database-side, beside the CURRENT_DATE the same query filters on, rather than
             -- from a second clock in JS that can disagree with it across midnight.
             EXTRACT(ISODOW FROM CURRENT_DATE)::int AS iso_dow
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date >= date_trunc('week', CURRENT_DATE)
        AND t.hidden = FALSE
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    // Same portion of the week, shifted back exactly 7 days — a fair week-over-week comparison
    // regardless of which day of the week "today" is.
    db.query<{ spent: string }>(`
      SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text AS spent
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
      WHERE t.date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
        AND t.date <= CURRENT_DATE - INTERVAL '7 days'
        AND t.hidden = FALSE
        AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
    `),
    db.query<{ weekly_budget: string }>(`
      -- Operational only, matching the spend it is compared against. It was summing both books,
      -- so a week of operational spending was measured against $5,960.50 when the operational
      -- reference is $2,677.63 — the week read twice as comfortable as it is.
      --
      -- A DIVISION, so it arrives from Postgres at whatever scale that produces and is the one
      -- figure in the six ad hoc reads that is not already at cent scale. wireMoney rounds it.
      SELECT COALESCE(SUM(annual_budget) / 52, 0)::text AS weekly_budget
      FROM budget_categories
      WHERE exclude_from_budget = FALSE AND is_income = FALSE AND landscape = 'operational'
    `),
  ]);
  return {
    spent: Number(weekResult.rows[0]?.spent ?? 0),
    spentComparableLastWeek: Number(lastWeekResult.rows[0]?.spent ?? 0),
    weeklyBudgetReference: Number(budgetResult.rows[0]?.weekly_budget ?? 0),
    isoDow: Number(weekResult.rows[0]?.iso_dow ?? 1),
  };
}

/**
 * A capped sample of the unfiled rows — the list behind the dashboard's Uncategorized card.
 *
 * ─── THE PREDICATE IS `readStats`'s, AND THAT IS THE WHOLE RISK HERE ──────────────────────────
 *
 * `stats.uncategorized` counts `mapped_category IS NULL AND hidden = FALSE` over accounts the app
 * tracks. This lists the same rows and must keep listing the same rows: a card reading four above
 * a panel showing five is the kind of contradiction a reader resolves by distrusting both. The two
 * cannot be one query — the count is unbounded and this is capped — so the predicate is written
 * twice, deliberately, with each side naming the other.
 *
 * NO DATE BOUND, unlike the arrivals list. An unfiled row from March is still unfiled, and it is
 * the one most likely to have been forgotten; a 36-hour window would show only what the reader has
 * already seen this morning.
 *
 * Largest first, which is the arrivals reader's order and the same argument: twelve rows is more
 * than a glance, and the row worth filing first is the one carrying the most money, whenever it
 * happened to land. `t.id` breaks ties so the order is total and a re-read cannot reshuffle.
 */
async function readUncategorized(): Promise<OverviewSources['uncategorized']> {
  const { rows } = await db.query<{
    id: number; date: string; amount: string; label: string;
    watched: boolean; note: string | null;
  }>(`
    SELECT t.id, t.date::text, t.amount::text,
           COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
           (t.watched_at IS NOT NULL) AS watched,
           t.note
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.mapped_category IS NULL AND t.hidden = FALSE
     ORDER BY t.amount DESC, t.id
     LIMIT 12
  `);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    label: r.label,
    // Null by construction — the predicate above is what makes these rows unfiled. Carried because
    // the editor these open reads it; see the contract's note on the field.
    category: null,
    watched: r.watched,
    note: r.note,
  }));
}

/** Operational spending per elapsed month — rendered by the dashboard and served by the API. */
async function readMonthlySpending(asOf: AsOf): Promise<OverviewSources['monthlySpending']> {
  const { rows } = await db.query<{ month_num: number; total: string; received: string }>(`
    SELECT EXTRACT(MONTH FROM t.date)::int AS month_num,
           COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text        AS total,
           COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text   AS received
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    LEFT JOIN budget_categories bc ON bc.name = t.mapped_category
    WHERE EXTRACT(YEAR FROM t.date) = $1
      -- Uncategorized rows are excluded here as they are from the P/L: the app cannot say
      -- whether an unfiled row is income, spend or half a transfer, and the last one to
      -- arrive was half a transfer worth $2,175. A LEFT JOIN plus this predicate drops
      -- them, because a row with no category row fails it.
      AND bc.exclude_from_budget = FALSE AND bc.landscape = 'operational'
      AND t.hidden = FALSE
    GROUP BY month_num
  `, [asOf.year]);

  // Twelve entries, January first, POSITIONAL: index `i` is month `i`. A short array does not
  // render eleven months, it shifts every month it does render. `MONTHS` is imported from
  // `lib/drilldown.ts` rather than respelled here, because that module owns the labels precisely so
  // a renderer cannot take one without the indexing convention that goes with it.
  const out = MONTHS.map((month) => ({ month, operational: 0, received: 0 }));
  for (const r of rows) {
    out[r.month_num - 1].operational = Number(r.total);
    out[r.month_num - 1].received = Number(r.received);
  }
  return out;
}

/** Each operational category's year against its allocation — rendered by the dashboard and served by the API. */
async function readBudgetVsActual(asOf: AsOf): Promise<OverviewSources['budgetVsActual']> {
  const result = await db.query<{ category: string; budget: string; spent: string }>(`
    -- Net of refunds, like every other spend figure on this page. Gross was overstating Travel by
    -- $4,099 of cancelled bookings and Health by $1,836 of reimbursements — enough to put Health
    -- at 198% of its budget when it is at 137%.
    SELECT bc.name AS category, bc.annual_budget AS budget,
           COALESCE(SUM(t.amount), 0) AS spent
    FROM budget_categories bc
    LEFT JOIN transactions t ON t.mapped_category = bc.name
      AND EXTRACT(YEAR FROM t.date) = $1
      AND t.hidden = FALSE
    LEFT JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE bc.exclude_from_budget = FALSE
      AND bc.landscape = 'operational'
      AND bc.is_income = FALSE
      AND (t.id IS NULL OR a.id IS NOT NULL)
    GROUP BY bc.name, bc.landscape, bc.annual_budget
    ORDER BY bc.landscape, spent DESC
  `, [asOf.year]);
  return result.rows.map((r) => ({
    category: r.category,
    budget: Number(r.budget),
    spent: Number(r.spent),
  }));
}

/**
 * The whole payload, from one clock read.
 *
 * ONE CLOCK READ, like the page: `asOfFromDate(new Date())` happens here and everything downstream —
 * the domain module's as-of point, every date-bounded query, the year in `stats` — derives from
 * those three integers, so no two sections of one response can straddle midnight or a New Year in
 * different directions. `data.asOf` and `data.monthOutlook.asOf` are the same value for this reason,
 * and the fixtures assert it.
 *
 * The four shared readers are CALLED, not reimplemented. `findBalanceDrift` and `loadFeedHealth` are
 * kicked off first and awaited last, matching the page: neither feeds anything else, so making them
 * serial would add a round trip to every request for no ordering benefit.
 */
export async function loadOverview(now: Date = new Date()): Promise<OverviewData> {
  const asOf = asOfFromDate(now);

  const driftPromise = findBalanceDrift();
  const feedPromise = loadFeedHealth();

  const [stats, monthRead, today, week, monthlySpending, budgetVsActual, recentArrivals,
         uncategorized, yearEnd] =
    await Promise.all([
      readStats(asOf),
      loadMonthOutlook(asOf),
      readToday(),
      readWeek(),
      readMonthlySpending(asOf),
      readBudgetVsActual(asOf),
      readRecentArrivals(),
      readUncategorized(),
      // Operational, matching the dashboard and /budget's default tab. The capital year is lumpy by
      // construction — a remodel draws $40,000 in one month — and averaging it in would give a P/L
      // nobody is steering by.
      loadYearEnd('operational', asOf),
    ]);

  const [driftFindings, feedHealth, watchlist, jobHealth] = await Promise.all([
    driftPromise, feedPromise, loadWatchlist(), loadJobHealth(now),
  ]);

  return composeOverview({
    asOf,
    stats,
    today,
    week,
    monthlySpending,
    recentArrivals: recentArrivals.rows,
    recentArrivalsTotal: recentArrivals.total,
    uncategorized,
    budgetVsActual,
    monthOutlook: monthRead.outlook,
    // Scoped to the as-of month AND to categories with an allocation. `categoryPacing` emits one
    // record per category PER MONTH — that is what lets an earlier month's breach be reported — so
    // taking the array whole would carry a category once for every month it has a budget in. The
    // dashboard hit exactly that: 28 circles over 21 categories.
    monthCategories: monthRead.allPaces
      .filter((p) => p.month === asOf.month && p.budgeted > 0)
      .map((p) => ({
        category: p.category,
        budgeted: p.budgeted,
        actual: p.actual,
        projectedRatio: p.projectedRatio,
        tooEarly: p.status === 'too-early' || p.status === 'future' || p.status === 'no-budget',
      })),
    yearEnd,
    feedHealth,
    driftFindings,
    watchlist,
    jobHealth,
  });
}

// The pure half of `GET /api/v1/overview`: the composition, the money formatting, and the one
// boundary this payload was most likely to get wrong.
//
// EVERY FIGURE BELOW IS FABRICATED. Nothing in this file is read from, derived from, or shaped by
// the owner's real ledger — the amounts are chosen to make a rule visible (`993.7500000000001` is
// the float drift a projection really produces, `1000.004`/`500.006` are picked so that rounding
// before subtracting and rounding after disagree), and the institution and merchant names are
// invented.
//
// DB-FREE, under the unchanged `vitest.config.mts`. `lib/overviewRead.ts` reaches `./db` through
// the four shared readers it calls, and `lib/db.ts` constructs a `pg.Pool` at module scope, so a
// bare import of the module under test would either throw for a missing `DATABASE_URL` or — worse
// on a developer machine where one is exported — build a pool pointed at whatever that variable
// happens to be. The mock below replaces the module with a `query` that throws, which is both the
// isolation and the assertion: nothing these fixtures exercise may issue SQL, and if something
// starts to, it fails loudly rather than connecting.

import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  default: {
    query: () => {
      throw new Error('the pure overview fixtures must not reach the database');
    },
  },
}));

import { composeOverview, wireMoney, wireMoneyOrNull, type OverviewSources } from './overviewRead';
import { assertScratchDatabase } from './testDbGuard';
import { OverviewDataSchema } from '@b8/contracts/overview';
import { dashboardFromWire } from './overviewFromWire';
import type { OutlookCategory } from './domain/monthOutlook';
import type { FeedFinding } from './domain/feedHealth';

/**
 * What actually reaches an HTTP client.
 *
 * `Response.json` is `JSON.stringify` plus a header, and `JSON.parse` of that is the object a
 * consumer holds. Every assertion about the wire in this file goes through here rather than
 * inspecting the composed object directly, because the two differ in exactly the place this
 * endpoint was specified to get right.
 */
const onTheWire = (data: unknown) => JSON.parse(JSON.stringify(data)) as Record<string, never>;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function outlookCategory(patch: Partial<OutlookCategory> = {}): OutlookCategory {
  return {
    categoryId: 41,
    category: 'Fabricated Sport',
    controlMode: 'discretionary',
    status: 'projected',
    month: 8,
    elapsedDays: 8,
    daysInMonth: 30,
    budgeted: 400,
    actual: 265,
    spentRatio: 0.6625,
    projected: 993.75,
    projectedVariance: 593.75,
    projectedRatio: 2.484375,
    recurringExpected: 120,
    recurringPosted: 120,
    reason: 'projected-breach',
    withheldReason: null,
    ...patch,
  };
}

/**
 * A whole, schema-valid set of reads, as the four shared readers and the six ad hoc queries hand
 * them over: unformatted floats, live `Date` objects, signs already normalized upstream.
 *
 * Returned fresh on every call so a test may mutate it without reaching the next one.
 */
function fabricatedSources(): OverviewSources {
  return {
    asOf: { year: 2026, month: 8, day: 12 },
    stats: { budget: 139237, spent: 92110.25, uncategorized: 3, totalTxns: 1284 },
    // One of each verdict the bubbles can draw, so the wire conversion is exercised on a null ratio
    // as well as on numbers.
    monthCategories: [
      { category: 'Grocery', budgeted: 1900, actual: 1420.5, projectedRatio: 1.02, tooEarly: false },
      { category: 'Education', budgeted: 75, actual: 96.4, projectedRatio: 3, tooEarly: false },
      { category: 'Pets', budgeted: 120, actual: 0, projectedRatio: null, tooEarly: true },
    ],
    watchlist: [
      { id: 11406, date: '2026-09-11', label: 'Zara', amount: 120.17, category: null, note: 'returning', daysOpen: 3 },
    ],
    jobHealth: { status: 'fresh', daysSince: 0, message: 'The daily job ran today.' },
    today: {
      spent: 214.37,
      avgSameWeekday: 186.4,
      transactions: [
        { label: 'Fabricated Grocer', amount: 142.19 },
        { label: 'Fabricated Fuel', amount: 72.18 },
      ],
      totalCount: 5,
    },
    week: {
      spent: 918.44,
      spentComparableLastWeek: 1102.6,
      // SUM(annual_budget) / 52 — a division, so Postgres prints it at whatever scale it computes.
      weeklyBudgetReference: 2677.6346153846153,
      isoDow: 6,
    },
    monthlySpending: MONTH_LABELS.map((month, i) => ({
      month,
      operational: i <= 8 ? 4200.5 + i : 0,
      received: i <= 8 ? 9000 : 0,
    })),
    // Deliberately larger than the array: the list is capped at twelve and the count is not, so a
    // fixture where they agree would not exercise the distinction the field exists for.
    recentArrivalsTotal: 17,
    recentArrivals: [
      { id: 9001, date: '2026-09-12', amount: 142.19, label: 'Fabricated Grocer', category: 'Fabricated Groceries', watched: false, note: null },
      // Negative — income, this ledger's convention. And uncategorized, so `category` is null.
      // Watched AND arriving: the two lists overlap, which the phone briefly assumed they could not.
      { id: 9002, date: '2026-09-11', amount: -742.5, label: 'Fabricated Payroll', category: null, watched: true, note: 'double paid?' },
    ],
    budgetVsActual: [
      { category: 'Fabricated Groceries', budget: 12000, spent: 8450.12 },
      { category: 'Fabricated Sport', budget: 4800, spent: 265 },
    ],
    monthOutlook: {
      asOf: { year: 2026, month: 8, day: 12 },
      state: 'projected-breach',
      scoredCategoryCount: 4,
      sayingNo: [outlookCategory()],
      holding: [outlookCategory({ categoryId: 42, category: 'Fabricated Dining', reason: null, status: 'projected' })],
      withheld: [
        outlookCategory({
          categoryId: 43,
          category: 'Fabricated Travel',
          status: 'too-early',
          projected: null,
          projectedVariance: null,
          projectedRatio: null,
          recurringExpected: null,
          recurringPosted: null,
          reason: null,
          withheldReason: 'too-early',
        }),
      ],
      offCycleElsewhere: [
        outlookCategory({ categoryId: 44, category: 'Fabricated Insurance', status: 'off-cycle', month: 3, reason: 'off-cycle' }),
      ],
      headline: {
        scoredCategoryCount: 4,
        breachCount: 2,
        defectCount: 1,
        budgeted: 3200,
        actual: 3611.4,
        variance: 411.4,
        varianceRatio: 0.1285625,
      },
      findings: [
        {
          kind: 'breach',
          categoryId: 41,
          category: 'Fabricated Sport',
          scored: true,
          month: 7,
          budgeted: 400,
          actual: 612.33,
          variance: 212.33,
          ratio: 1.530825,
        },
        {
          kind: 'chronic-underspend',
          categoryId: 45,
          category: 'Fabricated Gifts',
          scored: true,
          months: [
            { month: 6, budgeted: 100, actual: 12.5, variance: -87.5, ratio: 0.125 },
            { month: 7, budgeted: 100, actual: 0, variance: -100, ratio: 0 },
          ],
          budgeted: 200,
          actual: 12.5,
          variance: -187.5,
        },
      ],
      coverage: {
        scoredSpend: 3611.4,
        scoredCount: 61,
        unattributedSpend: 214.75,
        unattributedCount: 3,
        orphanedSpend: 0,
        orphanedCount: 0,
        coverageShare: 0.9438,
        coveragePercent: 94,
        authoritative: true,
      },
      coverageShare: 0.9438,
      coveragePercent: 94,
      authoritative: true,
    },
    yearEnd: {
      income: 186000,
      expense: 139237.004,
      profitLoss: 46762.996,
      netToDate: 21411.5,
      uncategorized: { income: 0, expense: 214.75, net: -214.75 },
      monthly: MONTH_LABELS.map((_, i) => ({
        income: 15500,
        expense: 11603.0837,
        net: 3896.9163,
        cumulative: 3896.9163 * (i + 1),
        projected: i > 8,
      })),
    },
    feedHealth: [
      {
        institution: 'Fabricated Bank A',
        accountCount: 2,
        state: 'stale',
        // A LIVE `Date`, exactly as `lib/feedHealthRead.ts` hands it over. See F4.
        lastSuccessfulUpdate: new Date('2026-09-09T04:15:00.000Z'),
        hoursStale: 76,
      },
      {
        institution: 'Fabricated Bank B',
        accountCount: 1,
        state: 'failing',
        lastSuccessfulUpdate: null,
        hoursStale: null,
      },
    ],
    driftFindings: [
      {
        accountId: 'manual_fabricated_0001',
        name: 'Fabricated Checking',
        ledgerBalance: 4210.19,
        expectedBalance: 4710.19,
        drift: 500,
        // Already an ISO string: `lib/drift.ts` calls `.toISOString()` itself. The contrast with
        // `lastSuccessfulUpdate` above is the whole point of F4.
        observedAt: '2026-09-12T09:00:00.000Z',
        suggestedBeginningBalance: 1500,
        safeToDerive: false,
      },
    ],
  };
}

describe('the composed overview payload, on the wire', () => {
  it('every money field in a composed payload serializes as a two-decimal-place decimal string', () => {
    // THE SCHEMA IS THE ENUMERATION. `moneyString` in `shared/contracts/overview.ts` is
    // `numericString` narrowed to /^-?\d+\.\d{2}$/, and it is applied to all thirty-odd dollar
    // fields in the payload — the six composed sections and the four carried verbatim. Parsing the
    // round-tripped value therefore asserts the rule everywhere at once, including the three places
    // SPEC.md's illustrative list omits (`coverage`'s spends, the headline's three, and
    // `yearEnd.monthly[].net`), rather than at a handful of paths an author remembered to name.
    const wire = onTheWire(composeOverview(fabricatedSources()));
    expect(OverviewDataSchema.parse(wire)).toBeTruthy();

    const parsed = OverviewDataSchema.parse(wire);

    // Money is a string and a ratio is a number, asserted on two fields of the SAME object, which
    // is the split a consumer has to be able to rely on: `coverage` carries three dollar figures
    // and three counts and a share, and reading one with the other's expectations is the defect.
    expect(typeof parsed.monthOutlook.coverage.scoredSpend).toBe('string');
    expect(parsed.monthOutlook.coverage.scoredSpend).toBe('3611.40');
    expect(typeof parsed.monthOutlook.coverage.coverageShare).toBe('number');
    expect(parsed.monthOutlook.coverage.coverageShare).toBe(0.9438);
    expect(typeof parsed.monthOutlook.coverage.scoredCount).toBe('number');

    // The formatter is visibly doing work, not passing already-formatted text through: a whole
    // number gains its cents and a twelve-decimal division loses all but two of them.
    expect(parsed.stats.budget).toBe('139237.00');
    expect(parsed.week.weeklyBudgetReference).toBe('2677.63');
    expect(parsed.yearEnd.monthly[0].net).toBe('3896.92');
    expect(parsed.monthOutlook.headline?.actual).toBe('3611.40');

    // And the counter-proof: a bare JSON number in a money position is REFUSED. Without this the
    // assertions above would still pass against a schema that had quietly been widened to accept
    // both representations, which is the one thing `moneyString` exists to make impossible.
    const numeric = { ...wire, stats: { ...(wire as never as { stats: object }).stats, budget: 139237 } };
    expect(OverviewDataSchema.safeParse(numeric).success).toBe(false);
  });

  it('a projected figure carrying float drift beyond two decimals is rounded to the cent once, at the wire boundary', () => {
    // `Sport` drawing $265 over eight elapsed days of thirty projects to $993.7500000000001 — the
    // literal value the multiplication produces, which the dashboard's own `Intl.NumberFormat` has
    // been hiding since it shipped. The rounding moves to the response boundary; it does not become
    // a new rule and it does not happen twice.
    const sources = fabricatedSources();
    sources.monthOutlook.sayingNo[0].projected = 993.7500000000001;
    sources.monthOutlook.sayingNo[0].projectedVariance = 593.7500000000001;

    const composed = composeOverview(sources);
    const wire = OverviewDataSchema.parse(onTheWire(composed));

    expect(wire.monthOutlook.sayingNo[0].projected).toBe('993.75');
    expect(wire.monthOutlook.sayingNo[0].projectedVariance).toBe('593.75');

    // ROUNDED ONCE, AND NEVER FED BACK. The source object still holds the unrounded float after
    // composition — nothing in the formatting step writes its result back into the value the
    // domain computed, which is what would make a later comparison against a NUMERIC column
    // disagree forever.
    expect(sources.monthOutlook.sayingNo[0].projected).toBe(993.7500000000001);

    // A second pass over the already-formatted figure changes nothing. That is what "once" means
    // operationally: the step is idempotent, so a caller cannot compound it by re-applying it.
    expect(wireMoney(Number(wire.monthOutlook.sayingNo[0].projected))).toBe('993.75');

    // And the rounding is real rather than truncation, and it carries a magnitude away from zero
    // on both sides of it rather than toward it.
    expect(wireMoney(11603.0837)).toBe('11603.08');
    expect(wireMoney(3896.9163)).toBe('3896.92');
    expect(wireMoney(7.006)).toBe('7.01');
    expect(wireMoney(-7.006)).toBe('-7.01');

    // `-0.00` is a minus sign in front of a figure that is not negative, and it is reachable:
    // a variance of -0.004 rounds to -0 and `.toFixed(2)` prints the sign. Normalized after the
    // rounding, because that is where the -0 appears.
    expect(wireMoney(-0.004)).toBe('0.00');
    expect(Object.is(Number(wireMoney(-0.004)), 0)).toBe(true);
  });

  it('a null projection serializes as null, never as the string 0.00', () => {
    // `null` and `"0.00"` are different statements. A category with no projection is one the month
    // is too young to say anything about; a category projecting $0.00 is heading for nothing. An
    // unguarded `.toFixed(2)` turns the first into the second, which is BUILD.md §10.3's
    // "null rendered as 0" by name.
    const sources = fabricatedSources();
    const withheld = sources.monthOutlook.withheld[0];
    expect(withheld.projected).toBeNull();
    expect(withheld.recurringExpected).toBeNull();

    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(sources)));
    const wireWithheld = wire.monthOutlook.withheld[0];

    expect(wireWithheld.projected).toBeNull();
    expect(wireWithheld.projectedVariance).toBeNull();
    expect(wireWithheld.recurringExpected).toBeNull();
    expect(wireWithheld.recurringPosted).toBeNull();
    // The key is PRESENT and its value is null — "this category does not project" stays
    // distinguishable from "a key went missing upstream".
    expect(Object.prototype.hasOwnProperty.call(wireWithheld, 'projected')).toBe(true);

    // The same rule one section over: an uncategorized arrival's category is null, not '' and not
    // the string 'Uncategorized'.
    expect(wire.recentArrivals[1].category).toBeNull();

    // The helper, directly, in both directions — and the contrast that makes the rule legible: a
    // real zero still formats, because zero dollars IS a figure.
    expect(wireMoneyOrNull(null)).toBeNull();
    expect(wireMoneyOrNull(0)).toBe('0.00');
    expect(wireMoney(0)).toBe('0.00');
  });

  it('a feedHealth fixture whose lastSuccessfulUpdate is a live Date instance validates against the schema after a JSON round-trip', () => {
    // P1-10 NITS.md N4, in the one place this payload carries it. `pg` parses TIMESTAMPTZ into a
    // JS `Date`; `lib/domain/feedHealth.ts` declares the field `Date | null` and nothing between
    // there and the wire converts it; the contract models it with `timestamptz`, the existing
    // STRING schema, because that is what a consumer receives after `Date.prototype.toJSON`.
    const sources = fabricatedSources();
    const finding = sources.feedHealth[0];
    expect(finding.lastSuccessfulUpdate).toBeInstanceOf(Date);

    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(sources)));
    expect(wire.feedHealth[0].lastSuccessfulUpdate).toBe('2026-09-09T04:15:00.000Z');
    expect(typeof wire.feedHealth[0].lastSuccessfulUpdate).toBe('string');
    // Never observed is null, not a zero-date and not "fresh".
    expect(wire.feedHealth[1].lastSuccessfulUpdate).toBeNull();
    expect(wire.feedHealth[1].hoursStale).toBeNull();

    // THE CONTROL, and without it the assertions above prove only that the fixture happened to
    // work. A payload that let the `Date` through — which is what a composer does when it trusts
    // `Response.json` to convert and types the field as a string anyway — is REJECTED by the
    // schema. So the conversion in `wireFeedFinding` is load-bearing rather than incidental, and
    // `z.date()` in the contract would have been the wrong schema for this boundary.
    const unconverted: FeedFinding = { ...finding };
    expect(OverviewDataSchema.safeParse({ ...wire, feedHealth: [unconverted] }).success).toBe(false);

    // `driftFindings[].observedAt` is the contrast: same wire type, different provenance, because
    // `lib/drift.ts` already called `.toISOString()`. Nothing converts it here and it is correct.
    expect(wire.driftFindings[0].observedAt).toBe('2026-09-12T09:00:00.000Z');
  });

  it('a negative transaction amount, this ledger\'s income convention, round-trips as a negative decimal string, unflipped', () => {
    // Positive is money out, negative is income — Plaid's convention, which this ledger keeps. A
    // refund in the 36-hour window is a negative arrival and must not be clamped, flipped or
    // hidden; this task composes already-normalized reads and normalizes no sign of its own.
    const sources = fabricatedSources();
    sources.today.transactions[1] = { label: 'Fabricated Refund', amount: -58.4 };

    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(sources)));

    expect(wire.recentArrivals[1].amount).toBe('-742.50');
    expect(wire.today.transactions[1].amount).toBe('-58.40');
    // The positive row alongside it is untouched, so the test would fail on a blanket sign flip as
    // well as on a clamp.
    expect(wire.recentArrivals[0].amount).toBe('142.19');
    expect(wire.today.transactions[0].amount).toBe('142.19');
    // And a negative figure the domain layer produces, one section over: an underspend variance.
    expect(wire.monthOutlook.findings[1].variance).toBe('-187.50');
  });

  it('stats.remaining is computed from the unformatted budget and spent numbers, not from their formatted strings', () => {
    // The one arithmetic operation this endpoint performs. The two operands are chosen so the two
    // orders of operations DISAGREE: 1000.004 formats down to "1000.00" and 500.006 formats up to
    // "500.01", so subtracting the strings gives 499.99, while subtracting the raw numbers gives
    // 499.998, which rounds to 500.00. On real, already-2-decimal data the two are identical — which
    // is exactly why this defect ships and is not noticed until an upstream figure gains precision.
    const sources = fabricatedSources();
    sources.stats.budget = 1000.004;
    sources.stats.spent = 500.006;

    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(sources)));

    expect(wire.stats.budget).toBe('1000.00');
    expect(wire.stats.spent).toBe('500.01');
    expect(wire.stats.remaining).toBe('500.00');
    expect(wire.stats.remaining).not.toBe('499.99');

    // Stated the other way, so the failure message names the rule: the string arithmetic a naive
    // implementation would do produces a different answer from the one the payload carries.
    expect(wireMoney(Number(wire.stats.budget) - Number(wire.stats.spent))).toBe('499.99');
  });

  it('the payload states one as-of point and one coverage verdict, not two that can disagree', () => {
    // Two cross-field invariants a schema cannot express, both worth a fixture because both are
    // deliberate duplications rather than accidents. The endpoint performs ONE clock read, so
    // `data.asOf` and `data.monthOutlook.asOf` are the same value — a second read here would let
    // two sections of one response straddle midnight in different directions. And
    // `coverageShare`/`coveragePercent`/`authoritative` appear on the outlook AND on its
    // `coverage` record because the domain module copies them deliberately, so a renderer cannot
    // reach the hero without the caveat under it; they must agree.
    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(fabricatedSources())));

    expect(wire.asOf).toEqual(wire.monthOutlook.asOf);
    expect(wire.monthOutlook.coverageShare).toBe(wire.monthOutlook.coverage.coverageShare);
    expect(wire.monthOutlook.coveragePercent).toBe(wire.monthOutlook.coverage.coveragePercent);
    expect(wire.monthOutlook.authoritative).toBe(wire.monthOutlook.coverage.authoritative);
  });

  it('carries twelve positional months in both series, because a short array shifts rather than shortens', () => {
    // `monthlySpending` and `yearEnd.monthly` are both read by index — index `i` is month `i` — so
    // eleven entries do not render eleven months, they render twelve months' worth of labels
    // against the wrong data and then read `undefined`. The contract pins the length; this asserts
    // the composer produces it, including for a year where nine months have data and three do not.
    const wire = OverviewDataSchema.parse(onTheWire(composeOverview(fabricatedSources())));

    expect(wire.monthlySpending).toHaveLength(12);
    expect(wire.yearEnd.monthly).toHaveLength(12);
    expect(wire.monthlySpending[0].month).toBe('Jan');
    expect(wire.monthlySpending[11].month).toBe('Dec');
    // A month with nothing in it is "0.00" and still present, not absent.
    expect(wire.monthlySpending[11].operational).toBe('0.00');
    expect(wire.monthlySpending[8].operational).toBe('4208.50');
  });
});

describe('assertScratchDatabase, the control that keeps a seeding suite off the real database', () => {
  it('refuses when DATABASE_URL resolves to b8_finance, the name this repo treats as the real database', () => {
    // The measured hazard, stated as a test rather than as an instruction. `.env.local`'s
    // DATABASE_URL and `docker-compose.yml`'s db service resolve to the same host, the same port
    // and the same database name on this machine, so a connection string cannot be told apart from
    // the owner's real financial records by anything except the name — and the integration suite
    // this guards SEEDS rows.
    expect(() => assertScratchDatabase('postgresql://b8:pw@localhost:5432/b8_finance'))
      .toThrow(/Refusing to run the integration suite against the database named/);
    // Any host, any port, any credentials: the name is what is refused.
    expect(() => assertScratchDatabase('postgresql://nobody@127.0.0.1:1/b8_finance'))
      .toThrow(/Refusing to run the integration suite against the database named/);
    expect(() => assertScratchDatabase('postgres://localhost/b8_finance?sslmode=require'))
      .toThrow(/Refusing to run the integration suite against the database named/);
    // Case-folded, because Postgres folds an unquoted identifier and a shift key is not a defence.
    expect(() => assertScratchDatabase('postgresql://localhost/B8_Finance'))
      .toThrow(/Refusing to run the integration suite against the database named/);

    // THE `socket:` FORM, which `pg` fully supports and which is the hole G3 found. `pg` reads the
    // database out of the `db` QUERY PARAMETER here and leaves the path as the socket directory, so
    // a guard that read the path reported `var/run/postgresql`, approved, and let the suite truncate
    // the real ledger. Refused now on the scheme, before any field is read.
    // Matched on the "cannot prove" branch specifically, NOT on /b8_finance/. All three of this
    // guard's messages interpolate the real database name, so that pattern is satisfied by any
    // refusal and proves only that something threw — and the title gate above cannot tell a
    // discriminating assertion from a vacuous one. These two are refused for being unreadable,
    // which is a different verdict from the four above and is asserted as one.
    expect(() => assertScratchDatabase('socket:/var/run/postgresql?db=b8_finance')).toThrow(/cannot prove/);
    expect(() => assertScratchDatabase('socket:?db=b8_finance')).toThrow(/cannot prove/);

    // The opaque-path form, same verdict and the same reason: `pg` reads 'b8_finance' out of it and
    // this guard declines to read it at all rather than reading it differently.
    expect(() => assertScratchDatabase('postgresql:_b8_finance')).toThrow(/cannot prove/);

    // THE MESSAGE NAMES THE DATABASE. An operator who hits this has to know which name was refused,
    // and the task's own live-fire acceptance command greps the run log for it — a non-zero exit
    // alone cannot distinguish a guard that fired from a suite that failed for some other reason.
    expect(() => assertScratchDatabase('postgresql://localhost/b8_finance'))
      .toThrow(/Refusing to run the integration suite against the database named "b8_finance"/);
    // And the branches are genuinely distinguishable in both directions, which is what makes every
    // matcher in this fixture load-bearing rather than decorative.
    expect(() => assertScratchDatabase('postgresql://localhost/b8_finance')).not.toThrow(/cannot prove/);
    expect(() => assertScratchDatabase('socket:?db=b8_finance')).not.toThrow(/Refusing to run/);

    // Unreadable is refused too, in the same direction: "I cannot tell which database this is" and
    // "this is a safe database" are different answers, and only one of them may let a write through.
    expect(() => assertScratchDatabase('')).toThrow(/DATABASE_URL is not set/);
    expect(() => assertScratchDatabase('host=localhost dbname=b8_finance')).toThrow(/cannot prove/);
    expect(() => assertScratchDatabase('postgresql://localhost')).toThrow(/cannot prove/);
  });

  it('does not refuse a distinctly named scratch database', () => {
    // The other direction, and it is not decoration: a guard that refused everything would pass the
    // test above while making the suite unrunnable, and the first person to hit that deletes it.
    expect(assertScratchDatabase('postgresql://localhost/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(assertScratchDatabase('postgresql://localhost:5432/b8_demo')).toBe('b8_demo');
    expect(assertScratchDatabase('postgres://user:pw@127.0.0.1:5433/b8_p111_throwaway?sslmode=disable'))
      .toBe('b8_p111_throwaway');

    // A DENYLIST OF ONE, and its edge is recorded rather than discovered. `b8_finance_backup` is a
    // different database and is allowed through; the guard closes the name this machine actually
    // collides on and does not pretend to recognise every clone of it. See EVIDENCE.md.
    expect(assertScratchDatabase('postgresql://localhost/b8_finance_backup')).toBe('b8_finance_backup');

    // THE COST OF THE SCHEME CONJUNCT, stated here rather than left to be tripped over: a `socket:`
    // URL is refused even when the name behind it is safe. That is the intended direction — the
    // guard may answer "yes" or "I cannot tell", never "probably" — and it is free in practice,
    // because the suite is run with the URL form README.md documents. See lib/testDbGuard.test.ts.
    expect(() => assertScratchDatabase('socket:/var/run/postgresql?db=b8_p111_throwaway')).toThrow(/cannot prove/);
    // Same for the opaque-path form. `pg` would connect this to the scratch database — the
    // coordinator opened a real connection with it — and the guard still refuses, because it
    // recognises one shape and declines the rest rather than re-deriving `pg`'s parser.
    expect(() => assertScratchDatabase('postgresql:_b8_p111_throwaway')).toThrow(/cannot prove/);
  });
});

describe('the three sections P1-11a added, which the dashboard could not be fed without', () => {
  it('carries every budgeted category this month, as money strings', () => {
    // P1-11's N1: the payload claimed to carry "everything the dashboard fetches" and did not carry
    // the input to its LEAD widget. The repair is these five fields, not the pacing engine's own
    // per-month records.
    const data = composeOverview(fabricatedSources());
    expect(data.monthCategories).toHaveLength(3);
    expect(data.monthCategories[0]).toEqual({
      category: 'Grocery',
      budgeted: '1900.00',
      actual: '1420.50',
      projectedRatio: 1.02,
      tooEarly: false,
    });
  });

  it('does not cent-round the projection, because it is a ratio and not money', () => {
    // Through `wireMoney` a 3.0 ratio would still read 3.00 and look fine; the failure only shows
    // on a value that quantises, which is why this asserts the exact float rather than the shape.
    const sources = fabricatedSources();
    sources.monthCategories[0].projectedRatio = 1.0249;
    expect(composeOverview(sources).monthCategories[0].projectedRatio).toBe(1.0249);
  });

  it('keeps a null projection null, never zero', () => {
    // `bubbleColor` reads null as "too early to call" and 0 as "on plan" — opposite verdicts.
    expect(composeOverview(fabricatedSources()).monthCategories[2].projectedRatio).toBeNull();
  });

  it('carries the watchlist with its age, which is the field that makes it get acted on', () => {
    const [watched] = composeOverview(fabricatedSources()).watchlist;
    expect(watched).toMatchObject({ label: 'Zara', amount: '120.17', daysOpen: 3, note: 'returning' });
  });

  it('carries the job verdict computed on the SERVER, not the ingredients for a client to compute', () => {
    // A mobile client deciding "is this late?" from its own clock would disagree with the dashboard
    // across a timezone, about a fact that has one answer.
    expect(composeOverview(fabricatedSources()).jobHealth).toEqual({
      status: 'fresh',
      daysSince: 0,
      message: 'The daily job ran today.',
    });
  });

  it('still validates against the published schema with all three present', () => {
    expect(() => OverviewDataSchema.parse(composeOverview(fabricatedSources()))).not.toThrow();
  });
});

describe('the dashboard reads the payload back without losing anything it displays', () => {
  // P1-11a. The dashboard now renders from `dashboardFromWire(loadOverview())` instead of from its
  // own ten queries, so every figure makes a round trip: float -> cent-rounded string -> float. This
  // is the fixture that says the round trip is exact to the cent, which is the finest precision any
  // figure on the page is displayed at.
  const cents = (n: number) => Math.round(n * 100);

  it('round-trips every money figure to the cent', () => {
    const src = fabricatedSources();
    const page = dashboardFromWire(composeOverview(src));

    expect(cents(page.stats.budget)).toBe(cents(src.stats.budget));
    expect(cents(page.stats.spent)).toBe(cents(src.stats.spent));
    expect(cents(page.stats.remaining)).toBe(cents(src.stats.budget - src.stats.spent));
    expect(cents(page.today.spent)).toBe(cents(src.today.spent));
    expect(cents(page.week.spent)).toBe(cents(src.week.spent));
    expect(page.monthlySpending.map((m) => cents(m.operational))).toEqual(src.monthlySpending.map((m) => cents(m.operational)));
    expect(page.recentArrivals.map((r) => cents(r.amount))).toEqual(src.recentArrivals.map((r) => cents(r.amount)));
    expect(page.budgetVsActual.map((b) => cents(b.spent))).toEqual(src.budgetVsActual.map((b) => cents(b.spent)));
    expect(cents(page.yearEnd.profitLoss)).toBe(cents(src.yearEnd.profitLoss));
    expect(page.yearEnd.monthly.map((p) => cents(p.cumulative))).toEqual(src.yearEnd.monthly.map((p) => cents(p.cumulative)));
    expect(page.monthCategories.map((c) => cents(c.actual))).toEqual(src.monthCategories.map((c) => cents(c.actual)));
    expect(page.watchlist.map((w) => cents(w.amount))).toEqual(src.watchlist.map((w) => cents(w.amount)));
  });

  it('turns every money value back into a real number, not a string that would concatenate', () => {
    // `'84.20' + 12.5` is `'84.212.5'` — a plausible figure and no type error, which is exactly what
    // a missed conversion looks like on a chart.
    const page = dashboardFromWire(composeOverview(fabricatedSources()));
    expect(typeof page.stats.budget).toBe('number');
    expect(typeof page.yearEnd.monthly[0].cumulative).toBe('number');
    expect(typeof page.budgetVsActual[0].spent).toBe('number');
    expect(typeof page.recentArrivals[0].amount).toBe('number');
  });

  it('keeps a null as null, because 0 and null mean opposite things on this page', () => {
    // `Number(null)` is 0. A projection with no basis must stay "too early to call", not become
    // "on plan".
    const page = dashboardFromWire(composeOverview(fabricatedSources()));
    expect(page.monthCategories[2].projectedRatio).toBeNull();
  });

  it('gives the feed card a Date, which it formats, rather than the string it arrived as', () => {
    const src = fabricatedSources();
    const page = dashboardFromWire(composeOverview(src));
    // Asserted on a finding the fixture is known to carry with a timestamp, so this cannot pass by
    // iterating over nothing or over nulls only.
    const dated = page.feedFindings.filter((f) => f.lastSuccessfulUpdate !== null);
    expect(dated.length).toBeGreaterThan(0);
    for (const f of dated) expect(f.lastSuccessfulUpdate).toBeInstanceOf(Date);
  });
});

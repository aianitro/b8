// `GET /api/v1/overview` — the whole dashboard in one payload, as JSON, stated once.
//
// WHICH BOUNDARY THIS DESCRIBES, restated here rather than assumed, because this file is the first
// contract in the repo whose payload is ASSEMBLED IN TYPESCRIPT rather than read off a table.
// Every schema below validates the value a consumer receives — the JSON on the far side of
// `Response.json(...)` — and never the object the composing code holds a moment earlier. The
// distinction is invisible for a `NUMERIC` (a string before serialization, the same string after)
// and load-bearing exactly once in this payload: `FeedFinding.lastSuccessfulUpdate` is a live JS
// `Date` all the way through `lib/domain/feedHealth.ts` and `lib/feedHealthRead.ts`, and becomes a
// string only when `JSON.stringify` calls `Date.prototype.toJSON` on it. It is modelled here with
// `timestamptz`, the existing string schema — never `z.date()`. That is P1-10 NITS.md N4, and
// shipping it again in a brand-new endpoint is the outcome SPEC.md was written to prevent.
//
// THESE ARE RESPONSE SCHEMAS. Nothing here validates an inbound body (P1-10 NITS.md N6), and this
// endpoint takes no parameters, so there is no inbound shape to be tempted by.
//
// WHAT THIS FILE MAY IMPORT: `zod`, and its sibling modules in this directory. Not `next/server`,
// not `pg`, not `@/lib/db`, and — the one that needs saying, because four of the eleven sections
// below stand 1:1 against a type declared under `lib/` — not `lib/` either, not even as
// `import type`. `shared/` is the base layer: `lib/domain/adherence.ts` imports `shared/types.ts`,
// and a contract reaching back the other way inverts that. `lib/yearEndRead.ts`, where `YearEndRead`
// is declared, also imports `./db`, so a type-only import of it would put a module specifier
// pointing at a database shell into this file's AST — indistinguishable, to the import checks this
// repo greps and parses with, from the layering violation those checks exist to catch.
//
// THE COST OF THAT, STATED RATHER THAN HIDDEN. enums.ts and shapes.ts pin each schema to its
// TypeScript counterpart with `Assert<Equals<…>>`, so `npx tsc --noEmit` fails when the two stop
// being the same set. The schemas below CANNOT do that here without the import this file refuses.
// The equivalent assertion belongs in a module that may legitimately import both — `lib/overviewRead.ts`
// or its test — and CONTRACT.md hands the implementer the exact lines. Until they exist, the
// correspondence between `MonthOutlookSchema` and `MonthOutlook` is checked by review and by the
// integration fixture that validates a real composed payload, not by the compiler.
//
// NAMING. Each schema's docblock names the type it stands against and the file that declares it.
// An `Overview`-prefixed name (`OverviewStatsSchema`, `OverviewTodaySchema`, `OverviewWeekSchema`)
// is a shape that exists only in this payload and has no counterpart anywhere else; every other
// name is the domain type's own, so a reader can find the definition by the name alone.
//
// UNKNOWN KEYS ARE STRIPPED, not refused — `z.object`, as in shapes.ts, not the `z.strictObject` the
// envelope uses. The envelope is authored end to end by this application and nothing legitimately
// adds a key to it. This payload is not: `monthOutlook`, `yearEnd`, `feedHealth` and `driftFindings`
// are passed through verbatim from `lib/domain/**` and `lib/yearEndRead.ts`, which are implementation
// and are free to gain a field without asking this file. Under a strict schema that additive change
// downstream becomes a rejected response here — a 500, or a red suite, for a change that broke
// nothing. Under a stripping one the new field simply does not reach the client until this contract
// is amended deliberately, which is the direction of failure that loses the least. Applied uniformly
// rather than strict-here/stripping-there, so the rule is the same at every use site.

import { z } from 'zod';
import { ControlModeSchema } from './enums';
import { apiResponseSchema } from './envelope';
import { dateString, numericString, serialId, timestamptz } from './representation';

/**
 * A dollar figure as THIS payload puts it on the wire: a decimal string at exactly cent scale.
 *
 * Built by narrowing `numericString` rather than by writing a second money regex beside it. That
 * matters more than the two saved lines: representation.ts's own header names a divergent second
 * money pattern in a sibling file as the miniature of the defect this directory exists to prevent,
 * and chaining inherits its refusals for free — no exponent notation, no `NaN`, no empty string,
 * no bare `.50`.
 *
 * WHY THE SCALE IS PINNED HERE WHEN `numericString` DELIBERATELY DOES NOT PIN IT. They describe
 * different things. `numericString` describes a NUMERIC arriving from `pg` untouched, printed at
 * whatever scale Postgres computed — `SUM(annual_budget) / 52` really does come back with a dozen
 * decimals, and a validator demanding two would reject a figure the database genuinely produced.
 * The values below are not that: every one of them is written by this endpoint's own formatting
 * step, and SPEC.md's money rule makes exactly-two-places the property of that step. Pinning it is
 * what makes the schema a detector for the defect it is supposed to catch — an unrounded
 * `993.7500000000001` reaching the wire, which a scale-free schema would wave through.
 *
 * IT DESCRIBES; IT DOES NOT ROUND. No `.transform()`, no coercion. A schema that quietly rounded
 * its input would accept the exact payload it exists to reject and then hide the evidence, and the
 * repo already holds the reason to care: a `NUMERIC(14,2)` column compared against an unrounded
 * JavaScript number compares unequal forever, which once appended a spurious balance row on every
 * sync run. Rounding happens once, in the composer, where it can be tested.
 *
 * NO SIGN RESTRICTION, for the same reason `numericString` carries none: this ledger's
 * Plaid-derived convention is positive = money out, negative = income, so `recentArrivals[].amount`
 * and `today.transactions[].amount` are legitimately either, and `stats.remaining`,
 * `yearEnd.profitLoss` and `driftFindings[].drift` are the figures a reader most needs to see
 * negative. A `.nonnegative()` here would reject every income row and every overspent budget.
 *
 * ACCEPTED, AND WORTH KNOWING: `"-0.00"`. It is reachable — `(-0.004).toFixed(2)` produces it — and
 * it is the "minus sign that means nothing" `withoutNegativeZero` in lib/domain/adherence.ts exists
 * to keep out of a rendered figure. It is not rejected here because that is a formatting rule, not
 * a representation one, and a regex carrying it would be a second place to maintain it. The
 * composer normalizes `-0` before formatting; see CONTRACT.md.
 */
export const moneyString = numericString.regex(
  /^-?\d+\.\d{2}$/,
  'expected a money figure formatted to exactly two decimal places, e.g. "1200.00" or "-7750.00"',
);

/**
 * The as-of point — one clock read, three integers, local calendar time.
 *
 * Stands against `AsOf` in `lib/domain/pacing.ts`, and is the same schema used for
 * `OverviewData.asOf` and for `monthOutlook.asOf`, because they are the same value: the page this
 * endpoint replaces performs exactly one clock read and derives everything from it. A schema cannot
 * assert that two of its own fields are equal, so that invariant is a fixture's job — CONTRACT.md
 * names it.
 *
 * `month` IS 0-BASED (0 = January), matching every month index in `lib/domain/**` and the
 * `monthly_amounts` array, and it is bounded 0–11 rather than left open. That bound is a
 * description, not an invention: the only producer is `asOfFromDate`, whose `Date.getMonth()`
 * cannot return anything else, and `daysInMonth` throws for anything else. It is worth stating
 * because a 1-based month is this repo's most-documented off-by-one — `lib/drilldown.ts` exists
 * partly to hold the single conversion, and monthOutlook's caller contract rejects it loudly — and
 * a consumer doing `MONTHS[asOf.month]` on a 1-based December reads `undefined`. The bound catches
 * only the December case, which is honest: a 1-based January still validates and still means
 * February. It is the part that is catchable.
 *
 * `day` is 1-based and bounded 1–31, the loosest bound that is true of every month. The real bound
 * is the month's own length, and `assertRealAsOf` already enforces it where the calendar is known;
 * restating the leap rule here would be a second copy of the arithmetic `lib/domain/pacing.ts`
 * exports `daysInMonth` specifically to prevent.
 *
 * `year` carries no range. Any bound would be a number nobody chose.
 */
export const AsOfSchema = z.object({
  year: z.int(),
  month: z.int().min(0).max(11, 'month is 0-based: 0 = January, 11 = December'),
  day: z.int().min(1).max(31),
});

// ---------------------------------------------------------------------------------------------
// The six sections this endpoint composes itself, from the ad hoc queries app/dashboard/page.tsx
// runs privately today. Each one's filter predicates are the page's, unchanged — see SPEC.md's
// landscape/exclusion table. None of that is expressible in a schema, and none of it is restated
// here: a contract that half-encoded a WHERE clause would be a second definition of it.

/**
 * The four headline counters — `getStats`.
 *
 * `budget` is the operational, non-excluded, non-income annual allocation; `spent` is this year's
 * spend against it, net of refunds; `remaining` is `budget − spent`.
 *
 * `remaining` IS THE ONE ARITHMETIC OPERATION THIS ENDPOINT PERFORMS, and the schema cannot see
 * whether it was done right. It must be computed from the two raw numbers and then formatted —
 * never by parsing two already-formatted strings back into numbers, which is invisible on
 * already-2-decimal data and live the moment either operand carries more precision. That is a
 * fixture's job (SPEC.md F6), stated here so the next reader of this shape knows the rule exists.
 *
 * `uncategorized` and `totalTxns` are `COUNT(*)`s and stay plain integers: they are not money, and
 * stringifying a count would make `stats.uncategorized > 0` — the condition the dashboard colours
 * an alert on — a string comparison that is right for the wrong reason. Left as bare `z.int()`
 * rather than `.nonnegative()`, matching `serialId`'s recorded restraint: `z.int()` already refuses
 * `NaN`, a float and a string, and non-negativity is a property of `COUNT(*)` that nothing between
 * here and there could violate.
 */
export const OverviewStatsSchema = z.object({
  budget: moneyString,
  spent: moneyString,
  remaining: moneyString,
  uncategorized: z.int(),
  totalTxns: z.int(),
});

/**
 * Today, against the same weekday's recent average — `getTodayStats`.
 *
 * `avgSameWeekday` is `"0.00"` when there is no trailing-30-day baseline, and that is a
 * PRE-EXISTING SENTINEL rather than a null-rendered-as-zero defect: the page's own query says
 * `COALESCE(AVG(daily_total), 0)`, and this task composes rather than repairs it. The distinction
 * survives for a reader because the dashboard gates on `avgSameWeekday > 0` before printing a
 * delta at all. Recorded here so nobody "fixes" it into a nullable field without deciding to.
 *
 * `transactions` is the largest few of today's charges, and `totalCount` is how many there are in
 * total — so `totalCount > transactions.length` is the normal case, not a defect. No `.max()` on
 * the array: the `LIMIT 3` is the query's decision, and pinning it here would freeze a rendering
 * choice into the contract.
 *
 * `amount` keeps the ledger's sign convention untouched; positive is money out.
 */
export const OverviewTodaySchema = z.object({
  spent: moneyString,
  avgSameWeekday: moneyString,
  transactions: z.array(
    z.object({
      label: z.string(),
      amount: moneyString,
    }),
  ),
  totalCount: z.int(),
});

/**
 * This week, against the same point last week — `getWeekStats`.
 *
 * `isoDow` is Monday = 1 … Sunday = 7, read database-side beside the `CURRENT_DATE` the same query
 * filters on, and bounded 1–7 deliberately. Postgres has TWO day-of-week extracts and this one file
 * uses both: `EXTRACT(DOW …)` is 0–6 with Sunday = 0 (`getTodayStats`'s same-weekday average) and
 * `EXTRACT(ISODOW …)` is 1–7 with Monday = 1 (here, matching `date_trunc('week', …)`). Swapping
 * them is a one-word edit that still returns a plausible integer, and this value is a denominator —
 * the week's pace is `spent / (weeklyBudgetReference × isoDow / 7)`, so a `0` from the wrong
 * extract makes the expected spend `0` and the pace ratio meaningless on precisely one day a week.
 * The bound catches that Sunday.
 *
 * `weeklyBudgetReference` is `SUM(annual_budget) / 52` — a division, so it arrives from Postgres at
 * whatever scale that produces and is formatted to the cent here like everything else.
 */
export const OverviewWeekSchema = z.object({
  spent: moneyString,
  spentComparableLastWeek: moneyString,
  weeklyBudgetReference: moneyString,
  isoDow: z.int().min(1).max(7, 'ISO day of week: Monday = 1 … Sunday = 7'),
});

/**
 * One month of the spend-and-income bars — `getMonthlySpending`.
 *
 * `operational` is money out and `received` is money in, both as non-negative magnitudes: the query
 * sums the positive rows for one and takes `ABS` of the negative rows for the other, so neither
 * carries the ledger's sign. The chart negates `operational` itself to hang it below the axis.
 *
 * `month` is the short label (`"Jan"`), and it stays an open `z.string()` rather than an enum of
 * the twelve. `lib/drilldown.ts` owns that array precisely so a renderer cannot import a label
 * without the URL builder that shares its indexing convention; copying the twelve values into this
 * file would be a second definition of them, which is the hazard this directory exists to prevent,
 * in exchange for catching a misspelling nothing produces.
 */
export const MonthlySpendPointSchema = z.object({
  month: z.string(),
  operational: moneyString,
  received: moneyString,
});

/**
 * One transaction that landed since the previous sync — `getRecentArrivals`.
 *
 * The one section with NO landscape filter and NO `exclude_from_budget` filter: it deliberately
 * shows both books, because the question it answers is "what is new", not "what counts against a
 * budget". Only `hidden = FALSE` applies. Copying the other sections' predicate onto it by
 * resemblance is one of the failure modes SPEC.md names.
 *
 * `category` is `null` for an uncategorized row — NEVER `''` and never the string `'Uncategorized'`.
 * The key is always present and the value is nullable, so "this row has no category" (a real state
 * the /transactions filter surfaces and the reader can act on) stays distinguishable from "a key
 * went missing upstream" (a bug).
 *
 * `amount` carries both signs: a refund in the window is a negative arrival and must not be
 * clamped, flipped or hidden.
 *
 * `date` is the transaction DATE, already `::text`-cast to `'YYYY-MM-DD'` by the query — which is
 * why `dateString` is the right primitive and not `timestamptz`. The row is selected on
 * `created_at` (a 36-hour window) and displayed on `date`, and the two differ by a day or more on
 * every card feed; `created_at` itself is not in this payload.
 */
export const RecentArrivalSchema = z.object({
  id: serialId,
  date: dateString,
  amount: moneyString,
  label: z.string(),
  category: z.string().nullable(),
});

/**
 * One category's year against its allocation — `getBudgetVsActual`.
 *
 * `spent` is net of refunds and may exceed `budget`; a category over its year is exactly what the
 * bars exist to show, so no relation between the two is asserted here.
 *
 * Operational only, non-excluded, non-income — so every row of this array is in the same book as
 * `stats.budget`, and no `landscape` field is carried. The producing query selects one today (it
 * spreads the row into its result), and this schema strips it rather than rejecting it; SPEC.md's
 * payload table enumerates three fields and three is what a consumer may rely on.
 */
export const BudgetVsActualRowSchema = z.object({
  category: z.string(),
  budget: moneyString,
  spent: moneyString,
});

// ---------------------------------------------------------------------------------------------
// The four sections carried verbatim from the shared readers. Their shapes are `lib/domain/**`'s,
// transcribed here field for field with one systematic change: every dollar figure those modules
// compute as a float becomes a two-decimal string at this boundary, and every ratio, count, day and
// flag stays the plain JSON value it already is. Nothing else is reshaped, renamed or flattened —
// re-deriving any of these figures instead of calling the reader that owns them is the defect
// BUILD.md §14's own worked example ends on.

/**
 * One month of one category, resolved into the two magnitudes the detectors compare — `MonthVariance`
 * in `lib/domain/adherence.ts`.
 *
 * `variance` is `actual − budgeted`, always in that order: POSITIVE IS OVERSPEND, negative is under.
 * Reversing it produces an equally plausible dollar figure whose only symptom is that thrift reads
 * as overspending, which is why the direction is written down at every level rather than re-derived.
 *
 * `ratio` is `actual / budgeted`, or `null` when nothing was budgeted that month — null, never `0`,
 * never `Infinity`, never `NaN`. It is a ratio and therefore a plain number, not money, and it is
 * deliberately not rounded: cent-rounding a percentage quantizes it into 1% steps.
 */
export const MonthVarianceSchema = z.object({
  month: z.int().min(0).max(11),
  budgeted: moneyString,
  actual: moneyString,
  variance: moneyString,
  ratio: z.number().nullable(),
});

/**
 * One month that drew more than it was budgeted — `BreachFinding` in `lib/domain/adherence.ts`.
 *
 * `scored` is a FLAG, not a filter: a `fixed` mortgage line over its budget is a true fact that
 * still produces a finding, and only `scored` says whether it moves the headline. A consumer that
 * treats the presence of a finding as membership in the scored set has re-implemented the
 * four-conjunct test that `isScoredCategory` exists to be the only copy of.
 */
export const BreachFindingSchema = MonthVarianceSchema.extend({
  kind: z.literal('breach'),
  categoryId: serialId,
  category: z.string(),
  scored: z.boolean(),
});

/**
 * One category whose every qualifying month came in far under budget — `ChronicUnderspendFinding`
 * in `lib/domain/adherence.ts`.
 *
 * `budgeted`/`actual`/`variance` are WINDOW totals over `months`, which is a different scale from
 * the single month a breach carries. The two finding kinds are deliberately not addable, and the
 * discriminant below is what keeps a consumer from summing them: P0.5-29a removed a field that had
 * made exactly that mistake representable.
 */
export const ChronicUnderspendFindingSchema = z.object({
  kind: z.literal('chronic-underspend'),
  categoryId: serialId,
  category: z.string(),
  scored: z.boolean(),
  months: z.array(MonthVarianceSchema),
  budgeted: moneyString,
  actual: moneyString,
  variance: moneyString,
});

/**
 * `AdherenceFinding` — a breach or a chronic-underspend defect, never both.
 *
 * `z.discriminatedUnion`, unlike the envelope's `z.union`. The envelope takes that shape because its
 * success branch is generic over a `data` schema no one can prove discriminable; here both options
 * are concrete objects each pinning its own `kind` literal, so the discriminant is provable and the
 * error message on a malformed finding points at the branch that was meant rather than reporting
 * both as failures.
 */
export const AdherenceFindingSchema = z.discriminatedUnion('kind', [
  BreachFindingSchema,
  ChronicUnderspendFindingSchema,
]);

/**
 * The scored set's aggregate — `ScoredHeadline` in `lib/domain/adherence.ts`. Null at the use site
 * (below) if and only if no category is in the scored set.
 *
 * The counts are FINDING-scoped and the money is CATEGORY-scoped, and the field names are what keep
 * the two apart: `breachCount` counts months, `defectCount` counts category-windows, and
 * `scoredCategoryCount` says what `budgeted`/`actual`/`variance` range over. There is deliberately
 * no total-findings field — six breach months and one twelve-month defect are not addable.
 *
 * `variance` is `actual − budgeted`: negative is under budget. `varianceRatio` is a plain,
 * unrounded number or `null` when those months budgeted nothing to be a percentage of — `null`
 * rather than `0`, because `0` reads "on budget" for a category that drew $75 against nothing.
 */
export const ScoredHeadlineSchema = z.object({
  scoredCategoryCount: z.int(),
  breachCount: z.int(),
  defectCount: z.int(),
  budgeted: moneyString,
  actual: moneyString,
  variance: moneyString,
  varianceRatio: z.number().nullable(),
});

/**
 * What share of the month's spend the verdict above it could actually see — `CategorizationCoverage`
 * in `lib/domain/monthOutlook.ts`.
 *
 * THE SPENDS ARE MONEY AND THE COUNTS ARE NOT. `scoredSpend`, `unattributedSpend` and
 * `orphanedSpend` are dollar figures and cross as two-decimal strings under this payload's one money
 * rule, even though SPEC.md's illustrative list of monthOutlook money fields does not name them;
 * the rule it states — every dollar amount, in every section — is the governing sentence and the
 * list is an example of it. `scoredCount`/`unattributedCount`/`orphanedCount` are transaction
 * counts and stay integers. That split is the module's own: it computes a share of DOLLARS and
 * never divides the counts, because one uncategorized $4,000 transfer against forty $12 coffees is
 * 97.6% by count and useless by dollars.
 *
 * `coverageShare` is the unrounded fraction, `null` for an empty population — never `0`, never `1`,
 * never `NaN`. `coveragePercent` is that share FLOORED to an integer, so `100` means every dollar
 * is attributed; it is never rounded, because `0.9999` rounded reads "computed over 100% of spend"
 * beside a transaction nobody has categorized.
 *
 * A LIMIT OF THIS BOUNDARY, since it applies to every nullable ratio below as well: JSON has no
 * representation for a non-finite number, so `Infinity` and `NaN` both serialize to `null`. A ratio
 * that went non-finite upstream therefore arrives here indistinguishable from an honest "no
 * baseline", and no schema can tell them apart after the fact. The domain modules refuse to emit
 * either (`null`, never `NaN` and never `Infinity`, is stated at four levels); this note records
 * that the wire cannot be the place that check happens.
 */
export const CategorizationCoverageSchema = z.object({
  scoredSpend: moneyString,
  scoredCount: z.int(),
  unattributedSpend: moneyString,
  unattributedCount: z.int(),
  orphanedSpend: moneyString,
  orphanedCount: z.int(),
  coverageShare: z.number().nullable(),
  coveragePercent: z.int().nullable(),
  authoritative: z.boolean(),
});

/**
 * One scored category's position as of the stated day — `OutlookCategory` in
 * `lib/domain/monthOutlook.ts`.
 *
 * EVERY NULLABLE MONEY FIELD HERE STAYS NULL. `projected`, `projectedVariance`, `recurringExpected`
 * and `recurringPosted` are `null` whenever the record does not project or was not split, and the
 * formatting step must preserve that rather than running `.toFixed(2)` unconditionally and emitting
 * `"0.00"`. A $0.00 projection and no projection at all are different statements: the first says a
 * category is heading for nothing, the second says the month is too young to say. `null` is never
 * rendered as `0` is BUILD.md §10.3's rule by name, and an unguarded formatting helper is the
 * single likeliest way this payload breaks it.
 *
 * `status` and `reason`/`withheldReason` are closed vocabularies declared here rather than in
 * enums.ts, which holds only the five vocabularies backed by a `db/schema.sql` CHECK. These three
 * are `lib/domain/**`'s own, and this task may not touch enums.ts in any case. `controlMode` IS one
 * of the five, so `ControlModeSchema` is imported rather than re-spelled — a fourth conjunct typo'd
 * as `'variable'` silently empties the scored set.
 *
 * `status` travels with every record on purpose: `spentRatio` means three incomparable things
 * across the six statuses, so a consumer binding one column across all of them prints "250% of
 * December" under "71% of April". `elapsedDays`/`daysInMonth` are the qualifier a projection may
 * not be printed without, and they are days, not money.
 *
 * `reason` is non-null if and only if the record is in `sayingNo`; `withheldReason` if and only if
 * it is in `withheld`. Which list a record is in is not recoverable from the record alone, and a
 * schema cannot state a cross-array implication — a fixture can.
 */
export const OutlookCategorySchema = z.object({
  categoryId: serialId,
  category: z.string(),
  controlMode: ControlModeSchema,
  status: z.enum(['off-cycle', 'no-budget', 'future', 'complete', 'too-early', 'projected']),
  month: z.int().min(0).max(11),
  elapsedDays: z.int(),
  daysInMonth: z.int(),
  budgeted: moneyString,
  actual: moneyString,
  spentRatio: z.number().nullable(),
  projected: moneyString.nullable(),
  projectedVariance: moneyString.nullable(),
  projectedRatio: z.number().nullable(),
  recurringExpected: moneyString.nullable(),
  recurringPosted: moneyString.nullable(),
  reason: z.enum(['off-cycle', 'breach', 'projected-breach']).nullable(),
  withheldReason: z.enum(['too-early', 'no-budget', 'negative-budget']).nullable(),
});

/**
 * This month's verdict — `MonthOutlook` in `lib/domain/monthOutlook.ts`, carried whole.
 *
 * `state` is the closed set of seven and there is no eighth. `nothing-to-score` is its own state and
 * is NOT `on-track`: a green verdict over an empty scored set is the worst thing this payload could
 * assert, and the demo dataset is exactly that input.
 *
 * `authoritative` is ORTHOGONAL to `state`, not an eighth rung — a `breach` under low coverage is
 * still a `breach`. `false` does not mean "render nothing"; it means the confidence is withdrawn
 * and the information is not.
 *
 * `coverageShare`/`coveragePercent`/`authoritative` are also present one level down on `coverage`,
 * and they are the same values copied by reference rather than recomputed. The duplication is the
 * domain module's deliberate choice — a renderer must not have to reach through `coverage` to
 * reconstruct a decision it can forget to make — so this schema carries both rather than pruning
 * one, and a consumer may rely on them agreeing.
 *
 * `asOf` is the same `AsOfSchema` as the payload's own top-level field, and must be the same value.
 */
export const MonthOutlookSchema = z.object({
  asOf: AsOfSchema,
  state: z.enum([
    'nothing-to-score',
    'off-cycle',
    'breach',
    'projected-breach',
    'too-early',
    'no-budget-basis',
    'on-track',
  ]),
  scoredCategoryCount: z.int(),
  sayingNo: z.array(OutlookCategorySchema),
  holding: z.array(OutlookCategorySchema),
  withheld: z.array(OutlookCategorySchema),
  offCycleElsewhere: z.array(OutlookCategorySchema),
  headline: ScoredHeadlineSchema.nullable(),
  findings: z.array(AdherenceFindingSchema),
  coverage: CategorizationCoverageSchema,
  coverageShare: z.number().nullable(),
  coveragePercent: z.int().nullable(),
  authoritative: z.boolean(),
});

/**
 * One month of the year-end projection — `MonthPoint` in `lib/domain/yearEnd.ts`.
 *
 * `projected` HERE IS A BOOLEAN, and it is the only field in this payload whose name collides with
 * a money field elsewhere in it: `OutlookCategory.projected` is a nullable dollar figure and this
 * one is a flag saying the month is wholly or partly forecast rather than settled. A consumer that
 * reads one shape's `projected` with the other's expectations gets `true` where it wanted dollars.
 * The collision is inherited from two domain modules that never meet; it is named rather than
 * renamed, because renaming a field on the way through would make this payload disagree with the
 * module that produced it.
 *
 * `income` and `expense` are both POSITIVE MAGNITUDES — `projectSide` flips income's ledger sign
 * once, so the subtraction reads the way the words do. `net` is this month alone and `cumulative`
 * is the running total from January, whose December value is the year's P/L by construction.
 * `net` is money and is stated so here even though SPEC.md's illustrative list omits it; the rule
 * it states covers every dollar amount in every section.
 */
export const MonthPointSchema = z.object({
  income: moneyString,
  expense: moneyString,
  net: moneyString,
  cumulative: moneyString,
  projected: z.boolean(),
});

/**
 * Where the operational year lands if the rest of it goes to plan — `YearEndRead` in
 * `lib/yearEndRead.ts`, for `landscape: 'operational'`.
 *
 * OPERATIONAL, NOT CAPITAL, and the payload carries no marker saying so — the landscape is an
 * argument to the reader, not a field on its result. It matters because the capital year is lumpy
 * by construction (a remodel draws $40,000 in one month) and folding it in produces a P/L nobody is
 * steering by. A consumer must not present this figure as the household's whole year.
 *
 * `uncategorized` is money the app cannot classify, reported and COUNTED IN NOTHING ABOVE IT.
 * Excluding it is the conservative reading — one unfiled half-transfer once moved the year's P/L by
 * $2,175 in the flattering direction — and disclosing the amount is what keeps the exclusion
 * honest. A consumer that adds it back into `profitLoss` has undone the fix.
 *
 * `monthly` is exactly twelve entries, January first, and the length is pinned because the array is
 * POSITIONAL: the chart reads index `i` as month `i`, and a short array does not render eleven
 * months, it shifts every month it does render and then reads `undefined`. Twelve is structural —
 * `projectYearEndByMonth` loops `MONTHS_PER_YEAR` times — not a coincidence of the current data.
 */
export const YearEndReadSchema = z.object({
  income: moneyString,
  expense: moneyString,
  profitLoss: moneyString,
  netToDate: moneyString,
  uncategorized: z.object({
    income: moneyString,
    expense: moneyString,
    net: moneyString,
  }),
  monthly: z.array(MonthPointSchema).length(12, 'monthly is positional, January first — twelve entries or none'),
});

/**
 * One Plaid item whose feed has stopped arriving — `FeedFinding` in `lib/domain/feedHealth.ts`.
 *
 * **`lastSuccessfulUpdate` IS THE N4 CONTROL AND THE REASON THIS FILE STATES ITS BOUNDARY TWICE.**
 * It is typed `Date | null` all the way through `lib/domain/feedHealth.ts` and
 * `lib/feedHealthRead.ts`, and nothing converts it before this endpoint. It is `timestamptz` here —
 * the existing string schema — because that is what a consumer receives: `Response.json` calls
 * `Date.prototype.toJSON` and an ISO-8601 string is what leaves the process. `z.date()` would be
 * the schema for the object a composer holds mid-flight, which is not a boundary any contract is
 * for, and it would reject every real response. The practical consequence for whoever validates
 * this payload: parse the JSON-round-tripped value, not the object you just built. That is P1-10
 * NITS.md N4, measured, and it is the specific defect this endpoint was most likely to ship.
 *
 * `state` is `'failing'` or `'stale'` and cannot be `'ok'` or `'unknown'` — the domain module drops
 * both before returning, deliberately: a manual account has no feed to be stale and an unobserved
 * item has produced no evidence either way, so reporting them would fill the card with rows no
 * action can clear. The two-value enum states that rather than re-admitting the four-value type.
 *
 * `accountCount` is how many accounts hang off this ITEM, because an item is the unit Plaid
 * refreshes and the unit that fails: ten Chase accounts going dark together are one finding, not
 * ten.
 *
 * `hoursStale` is whole hours and `null` when there has never been a successful update — `null`,
 * not `0`, which would read as "fresh". It carries no lower bound: it is a clock difference, and a
 * future `lastSuccessfulUpdate` from a skewed clock makes it negative, which is information rather
 * than a value to reject.
 */
export const FeedFindingSchema = z.object({
  institution: z.string(),
  accountCount: z.int(),
  state: z.enum(['failing', 'stale']),
  lastSuccessfulUpdate: timestamptz.nullable(),
  hoursStale: z.int().nullable(),
});

/**
 * One account whose ledger disagrees with Plaid — `DriftFinding` in `lib/domain/drift.ts`.
 *
 * `accountId` is a string, not a `serialId`: it is Plaid's `account_id` or a locally minted
 * `manual_<uuid>`, exactly as `AccountSchema.id` records.
 *
 * `expectedBalance` is Plaid's figure ALREADY NORMALIZED into this app's sign convention — Plaid
 * reports a credit or loan balance as a positive amount owed while the ledger holds it negative,
 * and comparing them raw reports roughly double the balance as drift on every card. `drift` is
 * `expected − ledger`: positive means the ledger is short of what the bank reports.
 *
 * `observedAt` is `timestamptz` like `lastSuccessfulUpdate` above, but for a different reason worth
 * stating so the two are not assumed to need the same handling: `lib/drift.ts` already calls
 * `.toISOString()` on it, so it is a string before serialization and needs no conversion at this
 * boundary. Same wire type, different provenance — the one that has to be converted is the one that
 * is easy to miss.
 *
 * `safeToDerive` says whether reconciling by moving the beginning balance is legitimate: true only
 * for an account that never had one, where the opening figure is genuinely unknown. False means the
 * gap is evidence of a missing, duplicated or mis-signed transaction, and absorbing it into the
 * opening balance is precisely what the budget spreadsheet's manual `correction` rows were doing.
 * A consumer that offers the same one-click fix for both has re-created the thing this detector
 * exists to end.
 */
export const DriftFindingSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  ledgerBalance: moneyString,
  expectedBalance: moneyString,
  drift: moneyString,
  observedAt: timestamptz.nullable(),
  suggestedBeginningBalance: moneyString,
  safeToDerive: z.boolean(),
});

// ---------------------------------------------------------------------------------------------

/**
 * The whole payload — everything `app/dashboard/page.tsx` fetches today, in one response.
 *
 * Eleven sections, in SPEC.md's enumerated order. Every key is REQUIRED: this object is assembled
 * in one place from reads that all either succeed or throw, so a missing section is a composer that
 * failed silently, not a legitimate "nothing to report". Emptiness is expressed by an empty array
 * (`feedHealth: []` is a healthy feed) or by a null the shape declares (`monthOutlook.headline`),
 * never by an absent key — the same rule shapes.ts states as "nullable, never optional", applied to
 * sections instead of columns.
 *
 * `monthlySpending` is exactly twelve entries, January first, for the same positional reason
 * `yearEnd.monthly` is.
 *
 * NOT HERE, and deliberately: net worth, and anything about a property. Phase 0.5 moved both off
 * this screen to `/net-worth` and `/properties`, so ROADMAP.md §5 step 11 and BUILD.md §14 both
 * describe a net-worth-first payload that no longer matches what the dashboard renders. Adding
 * either here would be a single-round-trip fetch of figures nothing on the page shows.
 */
/**
 * One budget category's month, as the bubbles render it.
 *
 * ─── Why this is not `allPaces` ───────────────────────────────────────────────────────────────
 *
 * P1-11's NITS.md N1 recorded that this payload could not feed the dashboard's lead widget because
 * `loadMonthOutlook` returns `{ outlook, allPaces }` and only `outlook` was carried. The obvious
 * repair is to add `allPaces`. It is the wrong one: `CategoryPace` is the pacing engine's internal
 * record — one row per category PER MONTH, with the fields the engine needs to reach a verdict —
 * and a payload carrying it would export the engine's working notes as a contract a mobile client
 * then depends on.
 *
 * What a bubble actually needs is five fields, and they are the same five `DigestBubble` carries,
 * because the two surfaces draw the same picture from the same rule in `lib/domain/bubbleStatus.ts`.
 * So the contract states those, scoped to the as-of month, and the per-month rows stay inside the
 * engine.
 *
 * `projectedRatio` is `null`, never `0`, when there is no basis to project from — the distinction
 * `bubbleColor` turns into "too early to call" rather than "on plan".
 */
export const MonthCategorySchema = z.object({
  category: z.string(),
  budgeted: moneyString,
  actual: moneyString,
  projectedRatio: z.number().nullable(),
  tooEarly: z.boolean(),
});

/** One transaction the owner flagged to come back to. */
export const WatchedTransactionSchema = z.object({
  id: serialId,
  date: dateString,
  label: z.string(),
  amount: moneyString,
  category: z.string().nullable(),
  note: z.string().min(1).max(200).nullable(),
  /** Whole days since it was flagged. The figure that makes the list get acted on. */
  daysOpen: z.int().min(0),
});

/**
 * Whether the daily job has been running.
 *
 * Carried in the payload rather than left to the client, because the verdict depends on the
 * SERVER's clock and its schedule. A mobile client computing "is this late?" from its own clock
 * would disagree with the dashboard across a timezone, about a fact that has one answer.
 */
export const JobHealthSchema = z.object({
  status: z.enum(['fresh', 'late', 'missed', 'never']),
  daysSince: z.int().min(0).nullable(),
  message: z.string(),
});

export const OverviewDataSchema = z.object({
  asOf: AsOfSchema,
  stats: OverviewStatsSchema,
  today: OverviewTodaySchema,
  week: OverviewWeekSchema,
  monthlySpending: z
    .array(MonthlySpendPointSchema)
    .length(12, 'monthlySpending is positional, January first — twelve entries or none'),
  recentArrivals: z.array(RecentArrivalSchema),
  budgetVsActual: z.array(BudgetVsActualRowSchema),
  monthOutlook: MonthOutlookSchema,
  /**
   * Every category with an allocation this month — the map the bubbles draw.
   *
   * Not only the scored ones. The dashboard learned that the expensive way: drawn off the scored
   * partition, the picture showed a household spending about $1,150 when the real figure was
   * several times that, because groceries, fuel and utilities are most of a month by value and
   * none of them is a monthly decision.
   */
  monthCategories: z.array(MonthCategorySchema),
  yearEnd: YearEndReadSchema,
  feedHealth: z.array(FeedFindingSchema),
  driftFindings: z.array(DriftFindingSchema),
  watchlist: z.array(WatchedTransactionSchema),
  jobHealth: JobHealthSchema,
});

/**
 * The full response: `{ success: true, data: OverviewData }` or the error branch.
 *
 * Composed once, here, rather than left for each consumer to write `apiResponseSchema(...)` around
 * the payload. The envelope is a factory precisely so a call site pins the payload it expects —
 * this is that pinning, done in the one place both the route's own test and a future mobile client
 * can import, so the two cannot pin different things.
 */
export const OverviewResponseSchema = apiResponseSchema(OverviewDataSchema);

/**
 * The payload's TypeScript type, inferred from the schema rather than hand-written beside it.
 *
 * This is the shape P1-10 could not give the legacy types and said so: there, `z.infer` would have
 * typed every money field `string` against 61 importers compiling on `number`, so the schema and
 * `shared/types.ts` were left to disagree on purpose. This payload has no importers yet — it is
 * born at v1 — so the honest type is available for free, and taking it means the type and the
 * validator cannot drift, because there is only one of them.
 *
 * It therefore lives here and NOT in `shared/types.ts`. Adding it there would also break a passing
 * fixture: `shared/contracts/index.test.ts` reads every exported name out of `shared/types.ts`'s AST
 * and requires `CONTRACT_SCHEMAS` to hold exactly one schema per name, and `index.ts` is outside
 * this task's declared surface. See CONTRACT.md.
 */
export type OverviewData = z.infer<typeof OverviewDataSchema>;

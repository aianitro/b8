// One vocabulary for "a thing worth telling the owner" (ROADMAP.md §5 Phase 5 step 34), stated once.
//
// WHY THIS EXISTS. Ten producers under `apps/web/lib/` each detect something worth saying — a budget
// breach, a drifting ledger, a dark feed, an open overdraft — and each grew its own idea of how bad
// it is and its own way of saying "we do not know". Steps 35 and 36 need to put them in one list.
// Without one shared shape, every consumer would rank and null-handle them its own way, and the
// rankings would diverge exactly as the two "pick the newest row" reducers once did. This file is
// the shape; `apps/web/lib/domain/findings*.ts` is the only place that converts a producer's output
// into it and the only place that assigns a severity.
//
// WHICH BOUNDARY THIS DESCRIBES. The value the assembler returns, as JSON would carry it: money as
// two-decimal strings, timestamps as strings, calendar periods as text. Nothing here is a `Date`
// and nothing here is a JS float standing for money.
//
// STRICT OBJECTS, EVERYWHERE, UNLIKE overview.ts. That file strips unknown keys because its sections
// are passed through verbatim from modules free to gain a field. This one is authored end to end by
// one assembler, and the leak it most needs to catch is an extra key — a merchant label from an
// overdraft forecast's charges — which a stripping schema would quietly remove and so hide. A
// rejected parse is the detector working.
//
// NO FIELD IS OPTIONAL. Absence is spelled `null`, and every key is always present. "Never counted",
// "never synced", "Plaid's status unread" are real states with their own meaning; a key that can be
// missing makes them indistinguishable from a converter that forgot the field.
//
// WHAT THIS FILE DOES NOT PIN, and why. Severity and confidence are carried as the full three-value
// vocabularies on every member, not narrowed per kind or per producer state. Which state maps to
// which severity is the mapping table in SPEC.md, and it has exactly one implementation — the
// conversion module — where scenarios V1 to V11 test it. Restating that table here as literals would
// be a second definition of it, the duplication this directory exists to prevent. The subject TYPE
// and period TYPE, by contrast, ARE narrowed per kind: what a finding is about (a category, an
// account) is structural, not a calibration, and a budget finding about an institution is a
// malformed value rather than a judgement call.
//
// WHAT THIS FILE MAY IMPORT: `zod` and sibling modules in this directory. Nothing from `apps/web`,
// not even as `import type` — the producers' types live there, and a contract reaching back into
// implementation inverts the layering (overview.ts states the same rule at length).
//
// NOT RE-EXPORTED from index.ts. Consumers import `@b8/contracts/findings` by subpath, as they do
// `@b8/contracts/overview`.

import { z } from 'zod';
import { dateString, serialId, timestamptz } from './representation';
import { FeedFindingSchema, WalletFindingSchema, moneyString } from './overview';
import { giftDate } from './gifts';
import type { Assert, Equals } from './exact';

// ─── The three closed vocabularies ──────────────────────────────────────────────────────────────

/**
 * How much a finding matters, three levels, chosen by the owner at G0 of P5-34.
 *
 *   `critical` — money is being lost now. Only an open overdraft episode is critical.
 *   `warning`  — a "never observed" or "failing" state, a scored breach, a real ledger disagreement,
 *                a projected overdraft.
 *   `notice`   — an elapsed-threshold or pattern state.
 *
 * Listed worst first; the assembler orders its output in this order. A consumer must still keep a
 * default branch: a fourth level would be a breaking change to this vocabulary, but a client should
 * not crash on one.
 */
export const SeveritySchema = z.enum(['critical', 'warning', 'notice']);

/**
 * How the finding was arrived at — a fixed label per kind, never a number.
 *
 *   `observed`  — read directly off a recorded fact (a balance, a timestamp, a status).
 *   `inferred`  — a judgement over recorded facts against a budget (breach, chronic underspend).
 *   `projected` — about a future that has not happened (an overdraft forecast).
 *
 * Not numeric because no producer computes a probability, and any score here would be invented.
 */
export const ConfidenceSchema = z.enum(['observed', 'inferred', 'projected']);

/**
 * The ten kinds, exactly. Adding one is an additive contract change and must arrive with its
 * conversion in the same change; the wiring test W2 and the compile-time check below both fail
 * otherwise.
 */
export const FindingKindSchema = z.enum([
  'budget-breach',
  'budget-underspend',
  'balance-drift',
  'feed-degraded',
  'sync-stale',
  'job-overdue',
  'cash-uncounted',
  'valuation-stale',
  'overdraft-open',
  'overdraft-forecast',
]);

// ─── Calendar text ──────────────────────────────────────────────────────────────────────────────

/**
 * A calendar month as `'YYYY-MM'`, 1-based: January is `01`, December is `12`.
 *
 * TEXT, NOT INTEGERS, deliberately. The domain modules index months from 0 (`monthly_amounts`,
 * `AsOf.month`) and the digest speaks 1-based, and this repo has been bitten by mixing them. A
 * calendar string has one reading. `2026-00`, `2026-13` and the unpadded `2026-1` are all refused,
 * so a converter that forgot the `+ 1`, or rolled December into a thirteenth month, fails here.
 *
 * New in this file because no existing primitive describes a month; the date primitive below is
 * reused rather than restated.
 */
export const calendarMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "expected a calendar month as 'YYYY-MM', 01 to 12");

// A calendar DATE is `giftDate` from gifts.ts: `'YYYY-MM-DD'`, a real date, checked by integer
// arithmetic and never by the JS date parser (which reads a bare date as UTC midnight and shifts it
// a day west of Greenwich). It is the one strict calendar-date primitive in this directory, and a
// second copy of its leap-year arithmetic here would be the divergent-twin defect in miniature.

// ─── Subject: what the finding is about ─────────────────────────────────────────────────────────

/** A budget category. `id` is `budget_categories.id`. */
export const CategorySubjectSchema = z.strictObject({
  type: z.literal('category'),
  id: serialId,
  name: z.string(),
});

/**
 * One account. `id` is a string — Plaid's `account_id` or a locally minted `manual_<uuid>` — as
 * every producer and `AccountSchema.id` carry it.
 */
export const AccountSubjectSchema = z.strictObject({
  type: z.literal('account'),
  id: z.string(),
  name: z.string(),
});

/**
 * One institution connection, named as its producer names it. No id: the two producers that report
 * on institutions (feed health, sync health) key them differently, and this vocabulary does not
 * decide that a feed finding and a sync finding with the same name are the same problem.
 */
export const InstitutionSubjectSchema = z.strictObject({
  type: z.literal('institution'),
  name: z.string(),
});

/** A part of this app itself. Today only the daily job, named `'daily-job'` by the conversion. */
export const SystemSubjectSchema = z.strictObject({
  type: z.literal('system'),
  name: z.string(),
});

/**
 * The four subject types. There is no property subject: no producer reports on a property today
 * (SPEC.md open question Q2). One becomes an additive variant when a producer exists.
 */
export const SubjectSchema = z.discriminatedUnion('type', [
  CategorySubjectSchema,
  AccountSubjectSchema,
  InstitutionSubjectSchema,
  SystemSubjectSchema,
]);

// ─── Period: when the finding is about ──────────────────────────────────────────────────────────

/** One calendar month — a budget breach is about exactly one month. */
export const MonthPeriodSchema = z.strictObject({
  type: z.literal('month'),
  month: calendarMonth,
});

/**
 * A set of calendar months, non-empty and STRICTLY ascending.
 *
 * Not a range. A chronic-underspend window's qualifying months need not be contiguous — months with
 * nothing budgeted are absent by construction — so `{from, to}` would claim months the finding is
 * not about. Strictly ascending (no repeats) because the producer lists them in calendar order and
 * each once; the zero-padded text compares in calendar order as plain strings, so no date parsing
 * is needed to check it.
 */
export const MonthsPeriodSchema = z.strictObject({
  type: z.literal('months'),
  months: z
    .array(calendarMonth)
    .min(1, 'a months period names at least one month')
    .refine(
      (ms) => ms.every((m, i) => i === 0 || (ms[i - 1] ?? '') < m),
      'months must be in strictly ascending calendar order, each once',
    ),
});

/**
 * As of one calendar day — the assembler's as-of date, rendered from the overview's 0-based triple
 * with the month plus one. Every state-of-the-world finding (a balance, a feed, a job) carries it.
 */
export const AsOfPeriodSchema = z.strictObject({
  type: z.literal('asOf'),
  date: giftDate,
});

export const PeriodSchema = z.discriminatedUnion('type', [
  MonthPeriodSchema,
  MonthsPeriodSchema,
  AsOfPeriodSchema,
]);

// ─── The ten members ────────────────────────────────────────────────────────────────────────────
//
// Each member is: `kind`, `severity`, `confidence`, `subject` (narrowed to the one type its kind is
// about), `period` (likewise), then the producer's own distinguishing fields, carried with the
// producer's name and the producer's null-ness. Money crosses as `moneyString` (exactly two
// decimals) with the producer's sign; the conversion never negates, takes an absolute value, or
// re-applies the credit/loan flip. Ratios, counts, days and hours stay plain JSON numbers.
//
// Where a producer's "never" state is exactly the state with no count, the member says so with a
// refinement: the count is null if and only if the state is "never". That makes "never counted
// read as counted today" — a null coerced to zero — a rejected value rather than a plausible one.

const severityAndConfidence = {
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
};

/**
 * One month in which a category drew strictly more than it was budgeted — `BreachFinding` from
 * `detectAdherence`.
 *
 * `scored` is the producer's FLAG, copied, never re-derived: an unscored breach (a fixed line over
 * its budget) is still a finding, with `scored: false`. `budgeted` and `actual` are non-negative
 * magnitudes as the budget grid aggregates them, not ledger signs. `variance` is `actual − budgeted`,
 * so positive is over budget. `ratio` is `actual / budgeted`, unrounded, and null when nothing was
 * budgeted that month — null, never zero and never infinite.
 */
export const BudgetBreachFindingSchema = z.strictObject({
  kind: z.literal('budget-breach'),
  ...severityAndConfidence,
  subject: CategorySubjectSchema,
  period: MonthPeriodSchema,
  scored: z.boolean(),
  budgeted: moneyString,
  actual: moneyString,
  variance: moneyString,
  ratio: z.number().nullable(),
});

/**
 * One qualifying month inside a chronic-underspend window, as the producer reports it.
 *
 * `month` is calendar text and must equal the corresponding entry of the finding's period (enforced
 * on the member below), so the breakdown and the period cannot disagree about which months the
 * finding is about.
 */
export const UnderspendMonthSchema = z.strictObject({
  month: calendarMonth,
  budgeted: moneyString,
  actual: moneyString,
  variance: moneyString,
  ratio: z.number().nullable(),
});

/**
 * A category whose every qualifying month in the window ran far under its budget —
 * `ChronicUnderspendFinding` from `detectAdherence`.
 *
 * `budgeted`, `actual` and `variance` are WINDOW totals over the period's months, a different scale
 * from a breach's single month: the two kinds are deliberately not addable, and the separate kind is
 * what stops a consumer summing them. `variance` is `actual − budgeted`, so negative here.
 *
 * `monthly` is the producer's per-month evidence (`ChronicUnderspendFinding.months`), carried rather
 * than dropped because SPEC.md's lossless-carriage rule (V13) permits exactly one dropped producer
 * field — the overdraft forecast's charges — and these are figures, not row text. It must list
 * exactly the period's months, in the same order.
 */
export const BudgetUnderspendFindingSchema = z
  .strictObject({
    kind: z.literal('budget-underspend'),
    ...severityAndConfidence,
    subject: CategorySubjectSchema,
    period: MonthsPeriodSchema,
    scored: z.boolean(),
    budgeted: moneyString,
    actual: moneyString,
    variance: moneyString,
    monthly: z.array(UnderspendMonthSchema),
  })
  .refine(
    (f) =>
      f.monthly.length === f.period.months.length &&
      f.monthly.every((m, i) => m.month === f.period.months[i]),
    { message: "monthly must list exactly the period's months, in the same order", path: ['monthly'] },
  );

/**
 * An account whose ledger disagrees with what Plaid reports — `DriftFinding` from `detectDrift`.
 *
 * All four figures are in the ledger's signed convention: money owed on a credit or loan account is
 * NEGATIVE, because the producer has already normalised Plaid's positive amount owed. `drift` is
 * `expected − ledger`; positive means the ledger is short of the bank, and a negative drift stays
 * negative. `observedAt` is null when the producer has no observation time — null, not a made-up
 * time. `safeToDerive` is whether moving the beginning balance is a legitimate fix; it does not
 * change the severity.
 */
export const BalanceDriftFindingSchema = z.strictObject({
  kind: z.literal('balance-drift'),
  ...severityAndConfidence,
  subject: AccountSubjectSchema,
  period: AsOfPeriodSchema,
  ledgerBalance: moneyString,
  expectedBalance: moneyString,
  drift: moneyString,
  suggestedBeginningBalance: moneyString,
  observedAt: timestamptz.nullable(),
  safeToDerive: z.boolean(),
});

/**
 * One Plaid item whose feed is failing or stale — `FeedFinding` from `feedFindings`.
 *
 * `state` and `institutionStatus` reuse overview.ts's statements of the same producer's vocabularies
 * rather than respelling them. `state` cannot be `unknown`: the producer deliberately does not
 * report an unobserved feed, and this vocabulary does not change what a producer reports (an
 * unobserved feed is invisible, not "ok" — recorded for step 35).
 *
 * `institutionStatus: null` means UNREAD, never healthy. A `HEALTHY` status beside a stale feed is
 * carried as-is: it says the problem is this connection rather than the bank.
 *
 * `hoursStale` is null exactly when `lastSuccessfulUpdate` is — there is no count of hours since a
 * success that never happened.
 */
export const FeedDegradedFindingSchema = z
  .strictObject({
    kind: z.literal('feed-degraded'),
    ...severityAndConfidence,
    subject: InstitutionSubjectSchema,
    period: AsOfPeriodSchema,
    accountCount: z.int(),
    state: FeedFindingSchema.shape.state,
    lastSuccessfulUpdate: timestamptz.nullable(),
    hoursStale: z.int().nullable(),
    institutionStatus: FeedFindingSchema.shape.institutionStatus,
    institutionStatusAt: timestamptz.nullable(),
  })
  .refine((f) => (f.lastSuccessfulUpdate === null) === (f.hoursStale === null), {
    message: 'hoursStale is null exactly when there has never been a successful update',
    path: ['hoursStale'],
  });

/**
 * One connection this app has not synced successfully for too long, or ever — a `SyncItemHealth`
 * from `classifySyncHealth` whose status is not `ok`.
 *
 * `ok` is not a member value: a healthy item is not a finding. `key` is the producer's stable,
 * non-secret identifier (an account id, never an access token). The subject's name is the
 * producer's `bank`, which the producer itself already turns into the text `Unknown` when the bank
 * is null; that substitution is inherited, not introduced here.
 *
 * `daysStale` is null exactly when the status is `never`.
 */
export const SyncStaleFindingSchema = z
  .strictObject({
    kind: z.literal('sync-stale'),
    ...severityAndConfidence,
    subject: InstitutionSubjectSchema,
    period: AsOfPeriodSchema,
    key: z.string(),
    accountCount: z.int(),
    daysStale: z.int().nullable(),
    status: z.enum(['stale', 'never']),
  })
  .refine((f) => (f.status === 'never') === (f.daysStale === null), {
    message: "daysStale is null exactly when status is 'never'",
    path: ['daysStale'],
  });

/**
 * The daily job has not run when it should have — a `JobHealth` from `jobHealth` whose status is not
 * `fresh`.
 *
 * `fresh` is not a member value. `message` is the producer's sentence, verbatim; nothing here
 * composes wording. `daysSince` is null exactly when the job has never run.
 */
export const JobOverdueFindingSchema = z
  .strictObject({
    kind: z.literal('job-overdue'),
    ...severityAndConfidence,
    subject: SystemSubjectSchema,
    period: AsOfPeriodSchema,
    status: z.enum(['late', 'missed', 'never']),
    daysSince: z.int().min(0).nullable(),
    message: z.string(),
  })
  .refine((f) => (f.status === 'never') === (f.daysSince === null), {
    message: "daysSince is null exactly when status is 'never'",
    path: ['daysSince'],
  });

/**
 * A cash wallet whose balance nobody has confirmed recently, or ever — `WalletFinding` from
 * `staleWallets`.
 *
 * `balance` is the wallet's ledger balance and may be negative. `daysSinceCount` is null exactly
 * when the reason is `never`: a never-counted wallet has no day count, and zero would read as
 * "counted today". `daysSinceCount` and `reason` reuse overview.ts's statements of this producer.
 */
export const CashUncountedFindingSchema = z
  .strictObject({
    kind: z.literal('cash-uncounted'),
    ...severityAndConfidence,
    subject: AccountSubjectSchema,
    period: AsOfPeriodSchema,
    balance: moneyString,
    daysSinceCount: WalletFindingSchema.shape.daysSinceCount,
    reason: WalletFindingSchema.shape.reason,
  })
  .refine((f) => (f.reason === 'never') === (f.daysSinceCount === null), {
    message: "daysSinceCount is null exactly when reason is 'never'",
    path: ['daysSinceCount'],
  });

/**
 * A hand-valued account never valued, or valued too long ago — `ValuationFinding` from
 * `staleValuations`.
 *
 * The producer's `never` variant has no `daysSince` at all; here the key is always present and is
 * null for `never`, so absence and "no count" cannot be confused.
 */
export const ValuationStaleFindingSchema = z
  .strictObject({
    kind: z.literal('valuation-stale'),
    ...severityAndConfidence,
    subject: AccountSubjectSchema,
    period: AsOfPeriodSchema,
    reason: z.enum(['stale', 'never']),
    daysSince: z.int().nullable(),
  })
  .refine((f) => (f.reason === 'never') === (f.daysSince === null), {
    message: "daysSince is null exactly when reason is 'never'",
    path: ['daysSince'],
  });

/**
 * An open overdraft episode: a watched account below its cushion now — `OverdraftFinding` from
 * `loadOverdrafts`.
 *
 * `balance` is the lower of Plaid's current and available balance as the episode recorded it, and
 * may be negative. `bank` is null when the account has no bank recorded — not an empty string.
 * `since` and `seenAt` are timestamps as the producer reads them.
 */
export const OverdraftOpenFindingSchema = z.strictObject({
  kind: z.literal('overdraft-open'),
  ...severityAndConfidence,
  subject: AccountSubjectSchema,
  period: AsOfPeriodSchema,
  bank: z.string().nullable(),
  balance: moneyString,
  cushion: moneyString,
  since: timestamptz,
  seenAt: timestamptz,
});

/**
 * An open overdraft forecast: a projected low below the cushion within the forecast horizon —
 * `ForecastFinding` from `loadForecasts`.
 *
 * THE PRODUCER'S `charges` ARE NOT CARRIED, AND THE STRICT SCHEMA REFUSES THEM. They hold
 * transaction-derived merchant labels, and this vocabulary is household-wide; a list of findings
 * must never carry row-level transaction text. `low` is the projected low point and may be
 * negative. `lowOn` is the calendar date of that low, as the producer reads it.
 */
export const OverdraftForecastFindingSchema = z.strictObject({
  kind: z.literal('overdraft-forecast'),
  ...severityAndConfidence,
  subject: AccountSubjectSchema,
  period: AsOfPeriodSchema,
  bank: z.string().nullable(),
  cushion: moneyString,
  low: moneyString,
  lowOn: dateString,
  projectedAt: timestamptz,
});

/**
 * A finding: exactly one of the ten members, discriminated on `kind`.
 *
 * An unknown key on any member is refused, an omitted key is refused, and a kind outside the ten is
 * refused. See the file header for why each of those is a detector rather than a nuisance.
 */
export const FindingSchema = z.discriminatedUnion('kind', [
  BudgetBreachFindingSchema,
  BudgetUnderspendFindingSchema,
  BalanceDriftFindingSchema,
  FeedDegradedFindingSchema,
  SyncStaleFindingSchema,
  JobOverdueFindingSchema,
  CashUncountedFindingSchema,
  ValuationStaleFindingSchema,
  OverdraftOpenFindingSchema,
  OverdraftForecastFindingSchema,
]);

export type Finding = z.infer<typeof FindingSchema>;
export type FindingKind = z.infer<typeof FindingKindSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Period = z.infer<typeof PeriodSchema>;

/**
 * The kind list and the union's discriminants are the same set. Fails `npx tsc --noEmit` if a member
 * is added without its kind being listed above, or the reverse.
 */
export type FindingKindIsExact = Assert<Equals<Finding['kind'], FindingKind>>;

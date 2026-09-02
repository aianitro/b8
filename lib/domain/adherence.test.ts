import { describe, it, expect } from 'vitest';
import {
  isScoredCategory,
  detectAdherence,
  scoredHeadline,
  type ScorableCategory,
  type AdherenceInput,
  type AdherenceFinding,
  type ScoredHeadline,
  type BreachFinding,
  type ChronicUnderspendFinding,
  type MonthSpend,
} from './adherence';
// Read-only, and only here: acceptance #18 needs the incumbent's verdict on the same twelve months
// to show what it cannot express. The module under test does not import it (acceptance #25).
import { expenseCellStyle } from '../budgetColors';
import type { BudgetCategory } from '../../shared/types';

// The qualifying row: operational, not excluded, not income, discretionary. Every case below
// starts here and breaks exactly one conjunct, so a passing case can only be passing for the
// reason its name claims.
const category = (over: Partial<ScorableCategory> = {}): ScorableCategory => ({
  landscape: 'operational',
  exclude_from_budget: false,
  is_income: false,
  control_mode: 'discretionary',
  ...over,
});

describe('isScoredCategory', () => {
  it('includes an operational, non-excluded, non-income category classified discretionary in the scored set', () => {
    expect(isScoredCategory(category())).toBe(true);
  });

  it('excludes a fixed category from the scored set even though it is operational, not excluded, and not income', () => {
    // An insurance premium or a property tax assessment: a real budget line, and not a decision
    // anyone makes month to month. Scoring it moves the headline when nothing behavioural changed.
    expect(isScoredCategory(category({ control_mode: 'fixed' }))).toBe(false);
  });

  it('excludes a variable-necessary category from the scored set — tracked and reported, never scored, same as fixed', () => {
    // Groceries, fuel, utilities. Excluded for the same reason as `fixed`, not as a softer version
    // of it: the amount moves with circumstance rather than with a decision to spend.
    expect(isScoredCategory(category({ control_mode: 'variable-necessary' }))).toBe(false);
  });

  it('excludes a capital-landscape category from the scored set even when its control_mode is discretionary', () => {
    // The value is inert on a capital row — never reviewed, never seeded — so acting on it
    // without the landscape gate leaks an unreviewed default into an operational-only figure.
    expect(isScoredCategory(category({ landscape: 'capital' }))).toBe(false);
  });

  it('excludes an exclude_from_budget category from the scored set even when its control_mode is discretionary', () => {
    expect(isScoredCategory(category({ exclude_from_budget: true }))).toBe(false);
  });

  it('excludes an is_income category from the scored set even when its control_mode is discretionary', () => {
    expect(isScoredCategory(category({ is_income: true }))).toBe(false);
  });

  it('treats the two non-discretionary modes identically rather than ranking them', () => {
    // Guards against a future "partially scored" reading of variable-necessary: there are two
    // outcomes, in and out, and both non-discretionary modes are out.
    expect(isScoredCategory(category({ control_mode: 'fixed' })))
      .toBe(isScoredCategory(category({ control_mode: 'variable-necessary' })));
  });

  it('stays out when more than one conjunct fails at once', () => {
    // A capital income row left at the default: no single-conjunct shortcut could report this
    // as scored, but a predicate built with || instead of && would.
    expect(
      isScoredCategory({
        landscape: 'capital',
        exclude_from_budget: true,
        is_income: true,
        control_mode: 'fixed',
      })
    ).toBe(false);
  });

  it('accepts a whole BudgetCategory row, so no caller needs a local shape for it', () => {
    // Fabricated figures throughout — this repo keeps real amounts out of committed diffs, and a
    // membership test has no use for one anyway.
    const row: BudgetCategory = {
      id: 1,
      name: 'Fabricated elective spend',
      annual_budget: 1200,
      landscape: 'operational',
      exclude_from_budget: false,
      is_income: false,
      control_mode: 'discretionary',
      dedicated_account_id: null,
      monthly_amounts: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(isScoredCategory(row)).toBe(true);
  });

  // Out-of-contract rows: what the predicate must do with a value the type system says cannot
  // exist. `isScoredCategory` already handles these correctly, and only as a consequence of `===`
  // — nothing below it is asserted anywhere else in this file, because every fixture above supplies
  // one of the three valid literals. The cases here turn that consequence into a contract.
  //
  // This is not a hypothetical. `app/categories/page.tsx:9` runs its own explicit-column SELECT
  // that omits `control_mode` and reads the result as `BudgetCategory` (NITS.md N1), so rows
  // shaped exactly like the first case exist at runtime today while typed as fully formed. The
  // refactor these cases exist to catch is a plausible one: rewriting the fourth conjunct as
  // `control_mode !== 'fixed'` — tempting once `variable-necessary` grows handling of its own —
  // would admit every one of those rows into the scored set, and without these tests the suite
  // would stay green while the headline silently averaged over them.
  //
  // The cast is deliberately confined to this one helper. TypeScript resisting a missing or
  // unknown `control_mode` is the type system working, not an obstacle: the escape hatch models
  // the row an out-of-contract query actually produces, which is precisely what the compiler
  // cannot see. Nothing in `shared/types.ts` is widened to make these compile — `ControlMode` and
  // `ScorableCategory` stay exactly as narrow as they are.
  const outOfContract = (over: Record<string, unknown>): ScorableCategory =>
    ({ ...category(), ...over }) as unknown as ScorableCategory;

  it('excludes a row whose control_mode is absent, the shape an out-of-contract SELECT produces at runtime', () => {
    expect(isScoredCategory(outOfContract({ control_mode: undefined }))).toBe(false);
  });

  it('excludes a row whose control_mode is an unrecognized string, rather than reading anything not-fixed as scored', () => {
    // The same string acceptance #15 proves the database CHECK rejects. A value that cannot reach
    // the column through the schema can still reach this function through a hand-written SELECT,
    // a fixture, or a future third mode added to the column before it is added to the union.
    expect(isScoredCategory(outOfContract({ control_mode: 'whatever' }))).toBe(false);
  });

  it('excludes a row whose exclude_from_budget arrives null, rather than reading a missing flag as not-excluded', () => {
    // `=== false` and `!== true` differ exactly here, and the difference points the wrong way: a
    // row whose exclusion flag never made it into the SELECT would read as "not excluded" and be
    // scored. Fail closed — an unknown flag is not a cleared flag.
    expect(isScoredCategory(outOfContract({ exclude_from_budget: null }))).toBe(false);
  });

  it('excludes a row whose is_income arrives undefined, rather than reading a missing flag as not-income', () => {
    expect(isScoredCategory(outOfContract({ is_income: undefined }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Two-sided variance (P0.5-29). Every dollar figure below is fabricated: this repo keeps real
// amounts out of committed diffs, and a variance detector has no use for a real one.
//
// The base fixture budgets $1,200/yr with no schedule, so every month is budgeted exactly $100 and
// each case can move one number at a time. Where a case needs the schedule to disagree with the
// even spread, it says so.

const months = (...actuals: number[]): MonthSpend[] =>
  actuals.map((actual, month) => ({ month, actual }));

const input = (over: Partial<AdherenceInput> = {}): AdherenceInput => ({
  ...category(),
  id: 1,
  name: 'Fabricated elective spend',
  annual_budget: 1200,
  monthly_amounts: null,
  months: [],
  ...over,
});

const breaches = (findings: AdherenceFinding[]): BreachFinding[] =>
  findings.filter((f): f is BreachFinding => f.kind === 'breach');

const defects = (findings: AdherenceFinding[]): ChronicUnderspendFinding[] =>
  findings.filter((f): f is ChronicUnderspendFinding => f.kind === 'chronic-underspend');

// One fixture of each shape, for the exclusion cases. A single category cannot be over budget and
// chronically under it at once, so proving an exclusion gates BOTH detectors takes two inputs.
const OVERSPEND_MONTHS = months(400, 400, 400);
const UNDERSPEND_MONTHS = months(20, 20, 20, 20);

describe('detectAdherence', () => {
  it('a month where actual spend exceeds its budgeted amount produces a breach finding for that month', () => {
    const findings = detectAdherence([input({ months: [{ month: 3, actual: 137.5 }] })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      kind: 'breach',
      categoryId: 1,
      category: 'Fabricated elective spend',
      scored: true,
      month: 3,
      budgeted: 100,
      actual: 137.5,
      // actual − budgeted, in that order. The subtraction reversed would read −37.5 here and the
      // whole module would quietly report thrift as overspending.
      variance: 37.5,
      ratio: 1.375,
    });
  });

  it('a month at or under its budgeted amount never produces a breach finding', () => {
    // Exactly on budget, a cent under, and nothing spent at all. `>=` instead of `>` would report
    // the first of these, and every perfectly-hit month after it.
    const findings = detectAdherence([input({ months: months(100, 99.99, 0) })]);

    expect(findings).toEqual([]);
  });

  it('a month with zero budgeted amount and nonzero spend produces a breach finding without computing a spend-to-budget ratio', () => {
    // A December-only schedule: January budgets nothing, and $75 landed there anyway.
    const schedule = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200];
    const findings = detectAdherence([
      input({ monthly_amounts: schedule, months: [{ month: 0, actual: 75 }] }),
    ]);

    expect(findings).toHaveLength(1);
    const [breach] = breaches(findings);
    expect(breach.budgeted).toBe(0);
    expect(breach.variance).toBe(75);
    // Spend against a $0 budget is unambiguous overspend and needs no division to say so.
    // `monthPct` answers Infinity here; this module answers null.
    expect(breach.ratio).toBeNull();
    expect(Number.isFinite(breach.variance)).toBe(true);
  });

  it('spend under 50% of budget in every qualifying month of a window of at least three such months produces a single chronic-underspend defect finding for that category', () => {
    const findings = detectAdherence([input({ months: months(20, 20, 20) })]);

    expect(findings).toHaveLength(1);
    const [defect] = defects(findings);
    expect(defect.months.map((m) => m.month)).toEqual([0, 1, 2]);
    expect(defect.budgeted).toBe(300);
    expect(defect.actual).toBe(60);
    expect(defect.variance).toBe(-240);
    expect(defect.scored).toBe(true);
    // One finding for the window, not one per lean month: the defect is a statement about the
    // budget line, and twelve copies of it would be twelve copies of the same complaint.
    expect(breaches(findings)).toEqual([]);
  });

  it('a single lean month never produces a defect finding on its own — chronic underspend requires at least three qualifying months of data', () => {
    expect(detectAdherence([input({ months: months(1) })])).toEqual([]);
    expect(detectAdherence([input({ months: months(1, 1) })])).toEqual([]);
    // The floor is three, and the third month is what crosses it.
    expect(detectAdherence([input({ months: months(1, 1, 1) })])).toHaveLength(1);
  });

  it('one on-budget or over-budget month among otherwise-lean months breaks the chronic streak and no defect finding is produced', () => {
    // Eleven months at 20% of budget and one landing exactly on it. An average would still read
    // "chronic" and report a category that plainly used its budget in June.
    const onBudget = months(20, 20, 20, 20, 20, 100, 20, 20, 20, 20, 20, 20);
    expect(defects(detectAdherence([input({ months: onBudget })]))).toEqual([]);

    const overBudget = months(20, 20, 20, 20, 20, 130, 20, 20, 20, 20, 20, 20);
    const findings = detectAdherence([input({ months: overBudget })]);
    expect(defects(findings)).toEqual([]);
    expect(breaches(findings).map((b) => b.month)).toEqual([5]);
  });

  it('a month with zero budgeted amount is excluded from the chronic-underspend window entirely, whether or not it has spend, rather than being read as either perfectly adhered or fully underspent', () => {
    // February budgets nothing; the other three months budget $100 each.
    const schedule = [100, 0, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0];

    // (a) $0 budget, $0 spent. Not "100% adhered", not "0% spent" — no baseline, so it is neither
    //     evidence for the defect nor evidence against it.
    const dormant = detectAdherence([
      input({ monthly_amounts: schedule, annual_budget: 300, months: months(20, 0, 20, 20) }),
    ]);
    expect(defects(dormant)).toHaveLength(1);
    expect(defects(dormant)[0].months.map((m) => m.month)).toEqual([0, 2, 3]);
    expect(defects(dormant)[0].budgeted).toBe(300);

    // (b) $0 budget with spend. Still outside the window — it is reported as an ordinary breach
    //     instead, so the same month is never both the evidence for a defect and a breach.
    const offCycle = detectAdherence([
      input({ monthly_amounts: schedule, annual_budget: 300, months: months(20, 45, 20, 20) }),
    ]);
    expect(breaches(offCycle).map((b) => b.month)).toEqual([1]);
    expect(defects(offCycle)[0].months.map((m) => m.month)).toEqual([0, 2, 3]);

    // (c) The false positive this exclusion exists to prevent: two lean months plus a dormant
    //     $0/$0 month is two qualifying months, not three, and reports nothing.
    const short = detectAdherence([
      input({
        monthly_amounts: [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        annual_budget: 200,
        months: months(20, 20, 0),
      }),
    ]);
    expect(short).toEqual([]);
  });

  it('a fixed category with sustained overspend produces a breach finding marked not scored', () => {
    // A fabricated $24,000/yr fixed line drawing $2,400 a month. Never scored — and still wrong.
    const findings = detectAdherence([
      input({
        control_mode: 'fixed',
        name: 'Fabricated fixed obligation',
        annual_budget: 24000,
        months: months(2400, 2400, 2400),
      }),
    ]);

    expect(breaches(findings).map((b) => b.month)).toEqual([0, 1, 2]);
    expect(breaches(findings).every((b) => b.scored === false)).toBe(true);
    expect(breaches(findings).every((b) => b.variance === 400)).toBe(true);
  });

  it('a fixed category with chronic underspend produces a defect finding marked not scored — a wrong fixed budget line is still a wrong budget', () => {
    const findings = detectAdherence([fixedChronic()]);

    expect(defects(findings)).toHaveLength(1);
    expect(defects(findings)[0].scored).toBe(false);
    expect(defects(findings)[0].variance).toBe(-15600);
  });

  it('a variable-necessary category with chronic underspend produces a defect finding marked not scored, tracked the same as fixed rather than as a softer case of it', () => {
    const asFixed = detectAdherence([fixedChronic()]);
    const asVariable = detectAdherence([fixedChronic({ control_mode: 'variable-necessary' })]);

    // Identical findings, down to the `scored` flag. There are two outcomes, in and out, and
    // `variable-necessary` is out for the same reason `fixed` is — not a third, softer one.
    expect(asVariable).toEqual(asFixed);
  });

  it('a discretionary category with chronic underspend produces a defect finding marked scored', () => {
    const findings = detectAdherence([fixedChronic({ control_mode: 'discretionary' })]);

    expect(defects(findings)).toHaveLength(1);
    expect(defects(findings)[0].scored).toBe(true);
  });

  it('a capital-landscape category never produces a finding of either kind, regardless of variance, even when its control_mode is discretionary', () => {
    // `control_mode` on a capital row is inert — never reviewed, never seeded. Reading it without
    // the landscape gate leaks an unreviewed default into an operational-only figure.
    const capital = { landscape: 'capital' as const, control_mode: 'discretionary' as const };
    expect(detectAdherence([input({ ...capital, months: OVERSPEND_MONTHS })])).toEqual([]);
    expect(detectAdherence([input({ ...capital, months: UNDERSPEND_MONTHS })])).toEqual([]);
  });

  it('an exclude_from_budget category never produces a finding of either kind, regardless of variance', () => {
    // `Transfer` is the live example. Admitting it is the same failure class as the internal
    // transfer that was once counted as rental income.
    const excluded = { exclude_from_budget: true };
    expect(detectAdherence([input({ ...excluded, months: OVERSPEND_MONTHS })])).toEqual([]);
    expect(detectAdherence([input({ ...excluded, months: UNDERSPEND_MONTHS })])).toEqual([]);
  });

  it('an is_income category never produces a finding of either kind, regardless of variance', () => {
    // Income has a budget line but is not a spending decision. Earning less than expected is not
    // a breach of anything, and "chronic underspend" on a salary is a category error.
    const income = { is_income: true };
    expect(detectAdherence([input({ ...income, months: OVERSPEND_MONTHS })])).toEqual([]);
    expect(detectAdherence([input({ ...income, months: UNDERSPEND_MONTHS })])).toEqual([]);
  });

  it("one category with sustained overspend and one category with chronic underspend at the roadmap's own 24%-of-budget shape produce a breach finding and a defect finding respectively in the same input, and lib/budgetColors.ts's expenseCellStyle renders every one of the chronically-under category's months as an on-budget green shade", () => {
    // The exit criterion, §5 verbatim: "two categories, one over and one chronically under,
    // produce distinguishable findings that a colour-threshold snapshot cannot express today."
    const over = input({
      id: 10,
      name: 'Fabricated dining out',
      annual_budget: 3600,
      months: months(420, 420, 420, 420, 420, 420),
    });
    const under = input({
      id: 11,
      name: 'Fabricated home improvement',
      annual_budget: 6000,
      months: months(120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120),
    });

    const findings = detectAdherence([over, under]);

    expect(breaches(findings).map((b) => b.category)).toEqual(Array(6).fill('Fabricated dining out'));
    expect(breaches(findings).every((b) => b.variance === 120)).toBe(true);

    expect(defects(findings)).toHaveLength(1);
    const [defect] = defects(findings);
    expect(defect.category).toBe('Fabricated home improvement');
    expect(defect.months).toHaveLength(12);
    expect(defect.budgeted).toBe(6000);
    expect(defect.actual).toBe(1440);
    expect(defect.variance).toBe(-4560);
    // The chronically-under category never breaches. That is precisely why the grid is silent.
    expect(breaches(findings).some((b) => b.category === 'Fabricated home improvement')).toBe(false);

    // The incumbent, read-only, on the same twelve months: $120 against a $500 month is 24%, well
    // under the 100% threshold, so every cell renders the on-budget green. The grid is telling the
    // truth about each cell and saying nothing at all about the year — which is the thing a
    // per-cell colour threshold structurally cannot express, and this module's whole reason to be.
    for (const month of defect.months) {
      expect(expenseCellStyle(month.actual, month.budgeted, false, false)).toBe('bg-green-50');
    }
  });

  it("an explicit monthly_amounts schedule is used verbatim for each month's budgeted amount, even when it disagrees with annual_budget divided by twelve", () => {
    // A twice-a-year assessment: $600 in March and $600 in September, nothing in between. The even
    // spread would claim $100 every month, which is wrong in both directions at once.
    const findings = detectAdherence([
      input({
        annual_budget: 1200,
        monthly_amounts: [0, 0, 600, 0, 0, 0, 0, 0, 600, 0, 0, 0],
        months: [
          { month: 2, actual: 700 },
          { month: 8, actual: 150 },
        ],
      }),
    ]);

    // March breaches its real $600, by $100 — not by $600 against a fictional $100.
    expect(findings).toHaveLength(1);
    const [breach] = breaches(findings);
    expect(breach.month).toBe(2);
    expect(breach.budgeted).toBe(600);
    expect(breach.variance).toBe(100);
    // September's $150 is comfortably inside its $600. Against the even spread it would have been
    // a breach, so this assertion fails in the other direction too.
    expect(breaches(findings).some((b) => b.month === 8)).toBe(false);
  });

  it("a null monthly_amounts schedule falls back to annual_budget divided by twelve, rounded to cents, as every month's budgeted amount", () => {
    const findings = detectAdherence([evenSpreadDust()]);

    const [defect] = defects(findings);
    expect(defect.months).toHaveLength(12);
    // $1,000 / 12 = $83.333…, and the month's budget is the rounded figure, not the raw quotient.
    expect(defect.months.every((m) => m.budgeted === 83.33)).toBe(true);
    expect(defect.months[0].budgeted).not.toBe(1000 / 12);
  });

  it('variance is rounded to cents at each month rather than left to accumulate as float dust across a window', () => {
    const [defect] = defects(detectAdherence([evenSpreadDust()]));

    // Engineered to expose the shortcut: twelve months of ($20 − $83.33) is −$759.96, while twelve
    // months of raw ($20 − $1000/12) summed and rounded once is −$760.00 exactly. Four cents apart,
    // and the four cents are the whole point — a running figure that must reconcile against a
    // statement rounds at every step, not once at the end.
    expect(defect.variance).toBe(-759.96);
    expect(defect.variance).not.toBe(-760);
    expect(defect.variance).not.toBe(
      Math.round(Array(12).fill(20 - 1000 / 12).reduce((s, n) => s + n, 0) * 100) / 100
    );
    expect(defect.budgeted).toBe(999.96);
    expect(defect.actual).toBe(240);
  });

  it('orders a category findings by calendar month whatever order the caller supplied them in', () => {
    // The caller's array order is not load-bearing; two callers holding the same year in different
    // orders must get identical output, or a snapshot of this module is a coin flip.
    const shuffled = [
      { month: 7, actual: 400 },
      { month: 1, actual: 400 },
      { month: 4, actual: 400 },
    ];
    expect(breaches(detectAdherence([input({ months: shuffled })])).map((b) => b.month))
      .toEqual([1, 4, 7]);
  });
});

// A fabricated $24,000/yr line drawing $700 a month — 35% of its budget, every month, all year.
// Shared by the three control-mode cases so the only thing that differs between them is the mode.
function fixedChronic(over: Partial<AdherenceInput> = {}): AdherenceInput {
  return input({
    control_mode: 'fixed',
    name: 'Fabricated committed obligation',
    annual_budget: 24000,
    months: months(700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700),
    ...over,
  });
}

// $1,000 a year with no schedule: the quotient does not divide into cents, so per-month rounding
// and round-once-at-the-end give different answers.
function evenSpreadDust(): AdherenceInput {
  return input({
    annual_budget: 1000,
    monthly_amounts: null,
    months: months(20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20),
  });
}

// ---------------------------------------------------------------------------------------------
// The scored-set headline (P0.5-29a). Every case below asserts a POSITION — what the scored
// categories did across the months the caller supplied — and not a summary of the findings they
// happened to produce. The two answer differently, and P0.5-29 shipped the proof: ranging over
// findings made eleven compliant months invisible and reported a category 8.3% under budget as
// 10% over (NITS N11). The fixtures are therefore built so that the finding-scoped answer and the
// category-scoped one are numerically far apart, and every case pins both.

// Fixture A/B: one scored category, over budget in January and comfortably lean in each of the
// other eleven months. Only January produces a finding, so this is the exact shape on which a
// finding-scoped headline points the wrong way.
const overThenLean = (over: Partial<AdherenceInput> = {}): AdherenceInput =>
  input({ months: months(110, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90), ...over });

// Fixture C: two scored categories in one input, one over budget and one chronically under it, so
// a single run yields two measured categories, three breach findings and one defect finding —
// three distinct values, which a struct that collapsed its two domains could not produce at once.
function twoDomainRows(): AdherenceInput[] {
  return [
    input({
      id: 10,
      name: 'Fabricated dining out',
      annual_budget: 1200,
      months: months(140, 140, 140, 90, 90, 90, 90, 90, 90, 90, 90, 90),
    }),
    input({
      id: 11,
      name: 'Fabricated home improvement',
      annual_budget: 2400,
      months: months(50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50),
    }),
  ];
}

// Fixture I: one row of every shape the four conjuncts exclude, each with extreme variance, so a
// gate built from three conjuncts instead of four — the plausible slip, since `detectAdherence`
// twenty lines up correctly uses the three-conjunct one — moves the headline visibly rather than
// subtly. The first two are tracked and DO produce findings (twelve breaches and one defect),
// which is what makes a forgotten narrowing visible instead of harmless.
function unscoredContamination(): AdherenceInput[] {
  return [
    input({
      id: 20,
      control_mode: 'fixed',
      name: 'Fabricated fixed obligation',
      annual_budget: 24000,
      months: months(2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400, 2400),
    }),
    input({
      id: 21,
      control_mode: 'variable-necessary',
      name: 'Fabricated groceries',
      annual_budget: 24000,
      months: months(700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700),
    }),
    input({ id: 22, landscape: 'capital', months: months(5000, 5000, 5000) }),
    input({ id: 23, exclude_from_budget: true, months: months(5000, 5000, 5000) }),
    input({ id: 24, is_income: true, months: months(5000, 5000, 5000) }),
  ];
}

// `scoredHeadline` returns `ScoredHeadline | null` and every case states which it expects. This
// asserts the non-null half once, so the bodies below read as arithmetic rather than as a run of
// optional chaining — and so a case that silently started returning null fails here by name
// instead of quietly satisfying every `?.` assertion after it.
function realHeadline(rows: AdherenceInput[]): ScoredHeadline {
  const headline = scoredHeadline(rows);
  expect(headline).not.toBeNull();
  if (headline === null) throw new Error('expected a real headline, got null');
  return headline;
}

describe('scoredHeadline', () => {
  it('the scored-set headline is null, not zero or NaN, when no category in the input belongs to the scored set', () => {
    // The shape scripts/seed-demo.mjs produces today: it never sets control_mode, so every seeded
    // row is `fixed` and the scored set is empty (P0.5-28 NITS N7). Findings exist — they are just
    // all unscored — and a ratio over them divides by zero.
    const rows = [fixedChronic(), input({ id: 2, control_mode: 'fixed', months: months(400, 400, 400) })];
    const findings = detectAdherence(rows);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.scored === false)).toBe(true);

    const headline = scoredHeadline(rows);
    // "The budget was followed perfectly" and "there is nothing to score" are different
    // statements. A zero says the first and means the second. Since P0.5-29a this null carries
    // only the second: perfect adherence is a real struct at variance 0 (below), so the two are
    // finally distinguishable rather than sharing one answer.
    expect(headline).toBeNull();
    expect(headline).not.toBe(0);
    expect(Number.isNaN(headline as unknown as number)).toBe(false);

    // And null is not the constant answer: add one discretionary category and it reports.
    const withScored = realHeadline([
      fixedChronic(),
      fixedChronic({ id: 3, control_mode: 'discretionary' }),
    ]);
    // One category measured, one defect finding — two counts on two scales, both real.
    expect(withScored.scoredCategoryCount).toBe(1);
    expect(withScored.defectCount).toBe(1);
    // Unchanged by the correction, and deliberately kept: `fixedChronic`'s chronic window is all
    // twelve months, so its category-scoped and finding-scoped totals coincide. A changed value
    // here would signal a different bug, not this fix.
    expect(withScored.variance).toBe(-15600);
    expect(Number.isFinite(withScored.varianceRatio ?? NaN)).toBe(true);
  });

  it('perfect adherence across the scored categories produces a real headline at variance zero rather than null, and the ratio is positive zero so no surface can print minus zero percent', () => {
    // Twelve months landing exactly on a $100 budget. No breach (strictly greater), no defect —
    // so the old finding-scoped headline had nothing to range over and answered null, which a
    // dashboard renders as "—" for a flawless year (NITS N12).
    const rows = [input({ months: months(100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100) })];
    expect(detectAdherence(rows)).toEqual([]);

    const headline = realHeadline(rows);
    expect(headline.scoredCategoryCount).toBe(1);
    expect(headline.breachCount).toBe(0);
    expect(headline.defectCount).toBe(0);
    expect(headline.budgeted).toBe(1200);
    expect(headline.actual).toBe(1200);
    expect(headline.variance).toBe(0);
    expect(headline.varianceRatio).toBe(0);
    // `Math.round(-0.1)` is `-0` and `-0 / 1200` is `-0` again, and `toBe(0)` cannot see the
    // difference. Only `Object.is` can, and a surface printing "-0.0% under" for a perfect year
    // is the whole reason it is worth seeing.
    expect(Object.is(headline.variance, -0)).toBe(false);
    expect(Object.is(headline.varianceRatio, -0)).toBe(false);
  });

  it('per-month variances that cancel to negative float dust report a positive-zero headline variance, so a run that nets out to nothing cannot print minus zero either', () => {
    // The case above cannot actually reach the normalisation it asserts. Every month there lands
    // exactly on budget, so each per-month variance is `+0`, and `+0 + +0` is `+0` deterministically
    // — the assertion holds for a reason that has nothing to do with the guard, which is the same
    // as not testing the guard at all. This fixture reaches it.
    //
    // $100 budgeted every month; three supplied months at $100.01, $99.93 and $100.06. The
    // per-month variances round to exactly `[0.01, -0.07, 0.06]`, three cent figures that cancel
    // on paper. They do not cancel in binary: `0.01 + -0.07` is `-0.060000000000000005`, and
    // adding `0.06` leaves a residue of `-6.938893903907228e-18`. `sumCents` re-rounds that
    // residue, and `Math.round(-6.938893903907228e-16)` is `-0`, not `0` — so a headline variance
    // of negative zero falls straight out of three months of ordinary arithmetic, with no
    // contrived magnitudes anywhere in the input.
    //
    // Two months are over budget here, so this is a near-miss run rather than a flawless one. That
    // is unavoidable: a sum of same-signed cent figures cannot land on float dust, so reaching the
    // residue at all requires variances of both signs. What the assertion is about is the sign of
    // the total, and the total is nothing.
    const rows = [input({ months: months(100.01, 99.93, 100.06) })];

    const headline = realHeadline(rows);
    expect(headline.scoredCategoryCount).toBe(1);
    expect(headline.breachCount).toBe(2);
    expect(headline.defectCount).toBe(0);
    expect(headline.budgeted).toBe(300);
    expect(headline.actual).toBe(300);

    // `toBe` compares with `Object.is`, so this line alone already separates `0` from `-0` — the
    // explicit `Object.is` assertion below states the intent rather than leaving it to be inferred
    // from a matcher's equality semantics, exactly as the perfect-adherence case does.
    expect(headline.variance).toBe(0);
    expect(Object.is(headline.variance, -0)).toBe(false);

    // And the ratio inherits the normalised variance: `0 / 300` is `+0`. Left unnormalised one
    // line up, `-0 / 300` is `-0`, and a surface reading the sign off this field prints
    // "-0.0% under" for a category that came out level.
    expect(headline.varianceRatio).toBe(0);
    expect(Object.is(headline.varianceRatio, -0)).toBe(false);
  });

  it('reports null for the variance ratio, inside a real headline, when the scored categories supplied months budgeted nothing in total', () => {
    // The other divide-by-zero: a December-only schedule, and $75 landed in January. Infinity is
    // no more acceptable in the headline than it is in a month's ratio, and 0 is worse than
    // either — it reads "on budget" for a category that spent $75 against nothing budgeted.
    const headline = realHeadline([
      input({
        monthly_amounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200],
        months: [{ month: 0, actual: 75 }],
      }),
    ]);

    expect(headline.scoredCategoryCount).toBe(1);
    expect(headline.breachCount).toBe(1);
    expect(headline.budgeted).toBe(0);
    expect(headline.actual).toBe(75);
    expect(headline.variance).toBe(75);
    expect(headline.varianceRatio).toBeNull();
    // Two nulls, two levels, two statements: the headline itself is NOT null here — scored
    // categories exist and $75 really was spent — only the percentage is, because there is no
    // baseline to be a percentage of.
    expect(Number.isNaN(headline.varianceRatio as unknown as number)).toBe(false);
    expect(headline.varianceRatio).not.toBe(Infinity);
    expect(headline.varianceRatio).not.toBe(0);
  });

  it('the headline ranges over every supplied month of every scored category, so a category that drew 1,100 against 1,199.88 budgeted reads 8.3 percent under and not 10 percent over', () => {
    // The binding case, verbatim from NITS N11: $99.99 a month, $110 in January and $90 in each
    // of the other eleven. Measured output before this task, at P0.5-29's G4:
    // {"findingCount":1,"breachCount":1,"defectCount":0,"budgeted":100,"actual":110,
    //  "variance":10,"varianceRatio":0.1} — a confident +10% over for a category 8.3% under.
    const headline = realHeadline([overThenLean({ annual_budget: 1199.88 })]);

    expect(headline.scoredCategoryCount).toBe(1);
    expect(headline.breachCount).toBe(1);
    // 90 / 99.99 = 0.9001, well above the 0.5 chronic threshold: lean months, not a fiction.
    expect(headline.defectCount).toBe(0);

    expect(headline.budgeted).toBe(1199.88);
    // January's budget alone — the old denominator, and the whole of the first cause of N11.
    expect(headline.budgeted).not.toBe(99.99);
    expect(headline.actual).toBe(1100);
    expect(headline.actual).not.toBe(110);
    expect(headline.variance).toBe(-99.88);
    expect(headline.variance).not.toBe(10.01);

    expect(headline.varianceRatio).toBeCloseTo(-0.08324165749908323, 10);
    // Negative means UNDER. The sign is the direction, not decoration.
    expect(headline.varianceRatio ?? 0).toBeLessThan(0);
    expect(headline.varianceRatio).not.toBeCloseTo(0.1001, 3);
    // And what a surface would print from it: 8.3% under, one decimal place.
    expect(Math.round(Math.abs(headline.varianceRatio ?? NaN) * 1000) / 10).toBe(8.3);
  });

  it('an evenly divisible annual budget gives the same position at exactly minus one twelfth, so the corrected headline does not depend on the per-month rounding residue', () => {
    // Fixture A with $1,200 instead of $1,199.88, so every month budgets exactly $100 and no
    // rounding residue exists anywhere in the arithmetic. The position is the same either way,
    // which is what makes "≈ 8.3% under" a property of the spend rather than of the division.
    const headline = realHeadline([overThenLean()]);

    expect(headline.budgeted).toBe(1200);
    expect(headline.actual).toBe(1100);
    expect(headline.variance).toBe(-100);
    expect(headline.varianceRatio).toBeCloseTo(-1 / 12, 12);
    // 0.1 exactly is what the defective implementation measured on this fixture at G4.
    expect(headline.varianceRatio).not.toBe(0.1);
    expect(headline.varianceRatio ?? 0).toBeLessThan(0);
  });

  it('breachCount and defectCount stay finding-scoped while budgeted, actual and variance range over the scored categories supplied months, and the headline reports how many categories it measured', () => {
    const headline = realHeadline(twoDomainRows());

    // Three counts, three different numbers, three different domains. A struct that collapsed
    // any two of them — or kept one "how many findings" field standing in for all three — cannot
    // produce this row.
    expect(headline.scoredCategoryCount).toBe(2);
    expect(headline.breachCount).toBe(3);
    expect(headline.defectCount).toBe(1);

    // Money, category-scoped: 12 × $100 + 12 × $200 budgeted, $1,230 + $600 drawn.
    expect(headline.budgeted).toBe(3600);
    expect(headline.actual).toBe(1830);
    expect(headline.variance).toBe(-1770);
    expect(headline.varianceRatio).toBeCloseTo(-0.49166666666666664, 12);
  });

  it('no aggregate adds a month-scale breach magnitude to a window-scale defect magnitude, so the denominator is the scored categories own months and never the sum of their findings budgets', () => {
    // The second cause of N11, isolated. A BreachFinding.budgeted is ONE MONTH; a
    // ChronicUnderspendFinding.budgeted is a WHOLE WINDOW. Summing them is a scale error that
    // still produces a plausible dollar figure, which is exactly why it shipped.
    const headline = realHeadline(twoDomainRows());

    // 3 × $100 (three breach months) + $2,400 (one twelve-month window) — the unchanged
    // implementation's answer.
    expect(headline.budgeted).not.toBe(2700);
    // Categories plus findings, double-counted — the likely partial fix, since the two causes of
    // N11 are independent and correcting the ranging alone leaves the finding sum in place.
    expect(headline.budgeted).not.toBe(6300);
    expect(headline.budgeted).toBe(3600);

    expect(headline.varianceRatio).not.toBeCloseTo(-0.6222222222222222, 6);
    // A ratio is not money. Cent-rounding it would quantize a percentage into 1% steps.
    expect(headline.varianceRatio).not.toBe(-0.49);
  });

  it('a category over budget and a category under budget produce headline variance ratios of opposite sign, so over and under are read from the sign rather than re-derived by a renderer', () => {
    const [overRow, underRow] = twoDomainRows();
    const over = realHeadline([overRow]);
    const under = realHeadline([underRow]);

    // $1,230 against $1,200 — over budget, so positive, both in dollars and as a ratio.
    expect(over.variance).toBe(30);
    expect(over.varianceRatio).toBeCloseTo(0.025, 12);
    expect(over.varianceRatio ?? 0).toBeGreaterThan(0);

    // $600 against $2,400 — under budget, so negative. `Math.abs` here, or `budgeted − actual`,
    // or `1 − actual / budgeted`, each still yields a plausible small percentage and the only
    // symptom is that thrift starts reading as overspending. This is the failure that shipped.
    expect(under.variance).toBe(-1800);
    expect(under.varianceRatio).toBeCloseTo(-0.75, 12);
    expect(under.varianceRatio ?? 0).toBeLessThan(0);

    expect(Math.sign(over.varianceRatio ?? 0)).not.toBe(Math.sign(under.varianceRatio ?? 0));
  });

  it('categories outside the scored set never move the headline, however extreme their variance', () => {
    // `fixed` and `variable-necessary` are tracked and reported, never scored; capital,
    // excluded and income rows are not even tracked. Each contaminant here is wildly out of
    // line, so a headline gated on three conjuncts instead of four lands nowhere near the clean
    // answer rather than a cent away from it.
    const contaminants = unscoredContamination();
    const contaminantFindings = detectAdherence(contaminants);
    expect(contaminantFindings.length).toBeGreaterThan(0);
    expect(contaminantFindings.every((f) => f.scored === false)).toBe(true);

    const clean = realHeadline(twoDomainRows());
    const contaminated = realHeadline([...twoDomainRows(), ...contaminants]);

    // Every field, including the counts — not just the money.
    expect(contaminated).toEqual(clean);
  });

  it('the headline never invents a month the caller did not supply, so a scored category with three supplied months of a twelve-month budget is measured over exactly those three', () => {
    // $1,200 a year, but only January to March have been observed. The position so far is
    // $150 against $300, not $150 against $1,200 — and nothing here asks what "today" is, so the
    // answer is the same in December as in March.
    const headline = realHeadline([
      input({ months: [{ month: 0, actual: 50 }, { month: 1, actual: 50 }, { month: 2, actual: 50 }] }),
    ]);

    expect(headline.budgeted).toBe(300);
    // The whole annual budget, i.e. twelve months assumed or read off a clock.
    expect(headline.budgeted).not.toBe(1200);
    expect(headline.actual).toBe(150);
    expect(headline.variance).toBe(-150);
    expect(headline.varianceRatio).toBe(-0.5);
  });

  it('a scored category with no supplied months yields a real headline at zero budgeted with a null variance ratio, not a null headline and not a zero percentage', () => {
    // Observations not loaded yet. "No months" is not "nothing to score": the category is in the
    // scored set, and collapsing this to a null headline would re-merge the two states the
    // struct's own null exists to keep apart.
    const headline = realHeadline([input({ months: [] })]);

    expect(headline.scoredCategoryCount).toBe(1);
    expect(headline.breachCount).toBe(0);
    expect(headline.defectCount).toBe(0);
    expect(headline.budgeted).toBe(0);
    expect(headline.actual).toBe(0);
    expect(headline.variance).toBe(0);
    expect(headline.varianceRatio).toBeNull();
    expect(Object.is(headline.variance, -0)).toBe(false);
  });

  it('the headline denominator is the rounded per-month schedule, so a 1,000 annual budget with no schedule totals 999.96 and the ratio is computed from the rounded totals', () => {
    // $1,000 / 12 = $83.333…, and the month's budget is the rounded $83.33 — so twelve of them
    // total $999.96, not $1,000.00. That four-cent divergence from the grid's own even spread
    // (NITS N19) is INHERITED here deliberately and pinned rather than assumed: closing it would
    // mean changing `budgetedForMonth`, which the per-month rounding test above pins.
    const headline = realHeadline([evenSpreadDust()]);

    expect(headline.budgeted).toBe(999.96);
    expect(headline.budgeted).not.toBe(1000);
    expect(headline.actual).toBe(240);
    // Sums of already-rounded per-month figures, re-rounded. Rounding once at the end instead
    // gives −760.00 exactly, four cents away.
    expect(headline.variance).toBe(-759.96);
    expect(headline.variance).not.toBe(-760);

    // And the ratio comes from those two rounded totals: −759.96 / 999.96, not −760 / 1000.
    expect(headline.varianceRatio).toBeCloseTo(-0.7599903996159847, 12);
    expect(headline.varianceRatio).not.toBe(-0.76);
  });

  it('the headline counts agree with the scored findings detectAdherence returns over the same rows', () => {
    // One array, two independent reads, and the counts must be the same counts — a headline that
    // disagreed with the findings listed beside it would be the same divergence N11 was made of.
    const rows = [...twoDomainRows(), ...unscoredContamination()];
    const findings = detectAdherence(rows);
    const headline = realHeadline(rows);

    expect(headline.breachCount).toBe(
      findings.filter((f) => f.scored && f.kind === 'breach').length
    );
    expect(headline.defectCount).toBe(
      findings.filter((f) => f.scored && f.kind === 'chronic-underspend').length
    );
    expect(headline.breachCount).toBe(3);
    expect(headline.defectCount).toBe(1);

    // Strictly below the unfiltered counts, so an implementation that forgot to narrow to the
    // scored set fails here rather than passing by coincidence.
    const allBreaches = findings.filter((f) => f.kind === 'breach').length;
    const allDefects = findings.filter((f) => f.kind === 'chronic-underspend').length;
    expect(allBreaches).toBe(15);
    expect(allDefects).toBe(2);
    expect(headline.breachCount).toBeLessThan(allBreaches);
    expect(headline.defectCount).toBeLessThan(allDefects);
  });

  it('scoredHeadline takes the same AdherenceInput array detectAdherence takes, and a finding array no longer typechecks', () => {
    // One input, two reads: `detectAdherence(rows)` and `scoredHeadline(rows)`. Nothing lets a
    // caller hand one a filtered or reordered version of what it handed the other, which is
    // precisely the divergence a `(rows, findings)` signature would have left open.
    const rows = [overThenLean()];
    const findings = detectAdherence(rows);

    expect(findings.length).toBeGreaterThan(0);
    expect(scoredHeadline(rows)).not.toBeNull();

    // The old signature took this array. It must no longer compile — and because an unused
    // `@ts-expect-error` is itself a hard error (TS2578) under this tsconfig, `npx tsc --noEmit`
    // fails if the finding-taking signature ever comes back.
    // @ts-expect-error scoredHeadline takes AdherenceInput[], not AdherenceFinding[]
    scoredHeadline(findings);
  });
});

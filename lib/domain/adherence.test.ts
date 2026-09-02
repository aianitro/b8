import { describe, it, expect } from 'vitest';
import { isScoredCategory, type ScorableCategory } from './adherence';
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

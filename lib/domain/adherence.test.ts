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
});

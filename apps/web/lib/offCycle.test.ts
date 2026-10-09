import { describe, expect, it } from 'vitest';
import { offCycleFrom } from './overviewRead';
import type { CategoryPace } from './domain/pacing';

// Fabricated pace records; only the fields offCycleFrom reads are meaningful.
const pace = (categoryId: number, month: number, status: CategoryPace['status'], scored: boolean) =>
  ({ categoryId, category: `Fabricated ${categoryId}`, month, status, scored }) as unknown as CategoryPace;

describe('offCycleFrom', () => {
  const asOf = { year: 2026, month: 9, day: 9 };

  it('includes a category the outlook does not score — the variable-necessary case', () => {
    const r = offCycleFrom([pace(1, 9, 'off-cycle', false)], asOf);
    expect(r.thisMonth.map((p) => p.categoryId)).toEqual([1]);
  });

  it('splits this month from earlier ones, newest first, and ignores later months and other statuses', () => {
    const r = offCycleFrom([
      pace(1, 9, 'off-cycle', true), pace(2, 6, 'off-cycle', false), pace(3, 8, 'off-cycle', false),
      pace(4, 10, 'off-cycle', false), pace(5, 9, 'projected', true),
    ], asOf);
    expect(r.thisMonth.map((p) => p.categoryId)).toEqual([1]);
    expect(r.earlier.map((p) => p.categoryId)).toEqual([3, 2]);
  });
});

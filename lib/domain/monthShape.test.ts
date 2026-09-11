import { describe, it, expect } from 'vitest';
import { monthShape, shapeLabel, MIN_DAYS_FOR_SHAPE } from './monthShape';

const flat = (n: number, v: number) => new Array(n).fill(v);

describe('monthShape', () => {
  it('accumulates spend day by day', () => {
    expect(monthShape([10, 5, 0, 20], 300, 30).cumulative).toEqual([10, 15, 15, 35]);
  });

  it('draws the plan across the whole month, not the elapsed part', () => {
    // $300 over 30 days is $10/day; on day 4 the plan is $40, not $300.
    const { plan } = monthShape([0, 0, 0, 0], 300, 30);
    expect(plan).toEqual([10, 20, 30, 40]);
  });

  it('reads an even run rate as steady', () => {
    expect(monthShape(flat(10, 5), 300, 30).kind).toBe('steady');
  });

  it('reads a month spent up front as front-loaded', () => {
    // Everything on day 1, nothing since — the category a projection flatters.
    expect(monthShape([200, 0, 0, 0, 0, 0, 0, 0], 300, 30).kind).toBe('front-loaded');
  });

  it('reads a quiet start turning busy as accelerating', () => {
    expect(monthShape([0, 0, 0, 0, 40, 60, 50, 70], 300, 30).kind).toBe('accelerating');
  });

  it('calls a mid-month burst quiet, not accelerating', () => {
    // The real case: Entertainment spent on days 6 and 7 of 11 and nothing since. A halfway split
    // put both days in the back half and reported "picking up" on a category quiet for four days.
    expect(monthShape([0, 0, 0, 0, 0, 80, 30, 0, 0, 0, 0], 150, 30).kind).toBe('front-loaded');
  });

  it('reports a month of net refunds rather than calling it unreadable', () => {
    const s = monthShape([-2.79, 0, 0, 0, 0, 0, 0, -401.52, 0, 0, 0], 50, 30);
    expect(s.kind).toBe('refunded');
    expect(s.recentShare).toBeNull();
  });

  it('claims no shape before there is enough month to read', () => {
    const s = monthShape(flat(MIN_DAYS_FOR_SHAPE - 1, 5), 300, 30);
    expect(s.kind).toBe('too-early');
    expect(s.recentShare).toBeNull();
  });

  it('claims no shape when nothing has been spent', () => {
    expect(monthShape(flat(20, 0), 300, 30).kind).toBe('too-early');
  });

  it('handles a category with no budget without dividing by it', () => {
    const s = monthShape(flat(10, 5), 0, 30);
    expect(s.plan.every((p) => p === 0)).toBe(true);
    expect(s.kind).toBe('steady');
  });

  it('measures on elapsed days rather than the calendar month', () => {
    // 11 elapsed days, spend concentrated in the last few — accelerating. Thirding the MONTH would
    // put every one of these days in the first third and report the opposite.
    expect(monthShape([0,0,0,0,0,0,20,20,20,20,20], 300, 30).kind).toBe('accelerating');
  });

  it('rejects a month length that is not a real month', () => {
    expect(() => monthShape([1], 10, 27)).toThrow(RangeError);
    expect(() => monthShape([1], 10, 32)).toThrow(RangeError);
  });
});

describe('shapeLabel', () => {
  it('has wording for every shape', () => {
    for (const k of ['front-loaded', 'accelerating', 'steady', 'refunded', 'too-early'] as const) {
      expect(shapeLabel(k).length).toBeGreaterThan(0);
    }
  });
});

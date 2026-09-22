import { describe, expect, it } from 'vitest';
import { lastSettledIndex, monotonePath, monotoneTangents } from './monotone';

/** Sample the cubic Bézier the path builder emits, so the curve itself can be asserted on. */
function sampleSegment(values: number[], slope: number[], i: number, steps = 40): number[] {
  const p0 = values[i];
  const p1 = values[i] + slope[i] / 3;
  const p2 = values[i + 1] - slope[i + 1] / 3;
  const p3 = values[i + 1];
  const out: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    out.push(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3);
  }
  return out;
}

describe('monotoneTangents', () => {
  // THE CLAIM THE WHOLE CHOICE RESTS ON. Catmull-Rom would bow past the trough here and draw a
  // loss the series never had; monotone interpolation cannot invent an extremum between two points.
  it('never overshoots between two points, on the shape that breaks Catmull-Rom', () => {
    const values = [-10, -32, -25, -25, -18];
    const slope = monotoneTangents(values);
    for (let i = 0; i < values.length - 1; i++) {
      const lo = Math.min(values[i], values[i + 1]);
      const hi = Math.max(values[i], values[i + 1]);
      for (const v of sampleSegment(values, slope, i)) {
        expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(v).toBeLessThanOrEqual(hi + 1e-6);
      }
    }
  });

  it('stays inside the endpoints for a monotonic rise too', () => {
    const values = [0, 5, 40, 42, 90, 110];
    const slope = monotoneTangents(values);
    for (let i = 0; i < values.length - 1; i++) {
      for (const v of sampleSegment(values, slope, i)) {
        expect(v).toBeGreaterThanOrEqual(values[i] - 1e-6);
        expect(v).toBeLessThanOrEqual(values[i + 1] + 1e-6);
      }
    }
  });

  // A flat tangent at a turning point is what stops the curve continuing past it.
  it('flattens the tangent at a peak and at a trough', () => {
    expect(monotoneTangents([0, 10, 0])[1]).toBe(0);
    expect(monotoneTangents([0, -10, 0])[1]).toBe(0);
  });

  it('is flat across a flat series and returns one tangent per point', () => {
    const slope = monotoneTangents([7, 7, 7, 7]);
    expect(slope).toHaveLength(4);
    for (const s of slope) expect(s).toBe(0);
  });

  it('survives a series too short to have an interior', () => {
    expect(monotoneTangents([5])).toEqual([0]);
    expect(monotoneTangents([0, 10])).toHaveLength(2);
  });
});

describe('monotonePath', () => {
  const values = [0, 100, 250, 220];
  const slope = monotoneTangents(values);
  const cx = (i: number) => i * 30;
  const y = (v: number) => 200 - v / 2;

  it('starts with a move and emits one cubic per interval', () => {
    const d = monotonePath(values, slope, 0, 3, cx, y);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.match(/ C /g)).toHaveLength(3);
  });

  // The settled and forecast halves are cut from ONE fit and must meet exactly, or the line shows
  // a step at the boundary between what happened and what is expected.
  it('joins two cut segments at the same point', () => {
    const left = monotonePath(values, slope, 0, 2, cx, y);
    const right = monotonePath(values, slope, 2, 3, cx, y);
    const leftEnd = left.trim().split(',').pop()!.trim();
    expect(right.startsWith(`M ${leftEnd}`)).toBe(true);
  });

  it('emits only a move for an empty range', () => {
    expect(monotonePath(values, slope, 1, 1, cx, y)).toBe('M 30.0 150.0');
  });
});

describe('lastSettledIndex', () => {
  it('finds the last closed month', () => {
    expect(lastSettledIndex([false, false, false, true, true])).toBe(2);
  });

  it('is the final index when nothing is projected', () => {
    expect(lastSettledIndex([false, false, false])).toBe(2);
  });

  // A year that has not started: every point is a forecast, and the whole line must be dashed
  // rather than the first month being drawn as though it had closed.
  it('is 0 when every point is projected', () => {
    expect(lastSettledIndex([true, true, true])).toBe(0);
  });

  it('ignores a settled month that follows a projected one', () => {
    expect(lastSettledIndex([false, true, false, true])).toBe(2);
  });
});

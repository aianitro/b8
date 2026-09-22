// Monotone cubic interpolation — the curve the P/L line is drawn with, in the one place both
// renderers can reach it.
//
// ─── Why this is in the contracts package when it is not a contract ───────────────────────────
//
// It is presentation, not a rule about money, and that makes it an awkward neighbour for
// `budgetCellState` and `bubbleStatus`. It is here anyway because `@b8/contracts` is the only
// package both the web and the phone can import, and the alternative was a second copy of a curve.
// Two copies of a smoothing function do not fail loudly when they drift — they draw two subtly
// different pictures of the same year, in an email and on a phone, and nobody can say which is
// right. A new `packages/charts` would be the tidier home and costs a workspace, a tsconfig, a
// Metro entry and a vitest alias to hold two functions; that trade is worth revisiting the day a
// third thing wants to live in it.
//
// ─── Why monotone and not Catmull-Rom ─────────────────────────────────────────────────────────
//
// This is d3's `curveMonotoneX`, which is what Recharts draws for `type="monotone"` and therefore
// what the web dashboard's line already is. Catmull-Rom is the usual reach for "make it smooth" and
// it OVERSHOOTS: where a deep trough is followed by two months at the same shallower level, it bows
// the curve past the lowest point in the series and draws a loss the year never had. Monotone
// interpolation cannot invent an extremum between two points, which on a chart of money is the
// difference between smoothing a line and fabricating one. `monotone.test.ts` asserts it on exactly
// that shape by sampling the emitted curve, rather than trusting the claim.

function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

/**
 * One tangent per point, for values evenly spaced along x.
 *
 * x-spacing is assumed to be 1, so a slope IS a delta — which is exactly true for a series of
 * months and is what lets the path builder below express its control points as thirds.
 */
export function monotoneTangents(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return [0];

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) slopes.push(values[i + 1] - values[i]);

  const out = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) {
    const before = slopes[i - 1];
    const after = slopes[i];
    // A sign change is a local peak or trough. Its tangent is flat, which is exactly what stops the
    // curve continuing past the turning point.
    if (before * after <= 0) {
      out[i] = 0;
    } else {
      const mean = (before + after) / 2;
      out[i] = (sign(before) + sign(after)) * Math.min(Math.abs(before), Math.abs(after), Math.abs(mean) / 2);
    }
  }
  // Ends: a one-sided estimate, damped by the neighbour's tangent so the curve leaves and arrives
  // without a flick.
  out[0] = (3 * slopes[0] - out[1]) / 2;
  out[n - 1] = (3 * slopes[n - 2] - out[n - 2]) / 2;
  return out;
}

/**
 * An SVG path for `values[from..to]`, as cubic Béziers carrying `slope`.
 *
 * TANGENTS ARE COMPUTED OVER THE WHOLE SERIES AND PASSED IN, so a caller can cut one curve into
 * several paths — settled and forecast, say — without refitting each piece. Fitting them separately
 * would give the joining point two different tangents and kink the line at exactly the boundary
 * between what happened and what is expected, which is the one place a reader is looking.
 *
 * `cx` and `y` map an index and a value into the caller's own coordinate space, so the web's
 * rasterised PNG and the phone's `react-native-svg` share the geometry and differ only in size.
 * The horizontal third is derived per segment from `cx` rather than taken as a constant, which is
 * identical for evenly spaced columns and correct if they ever are not.
 */
export function monotonePath(
  values: number[],
  slope: number[],
  from: number,
  to: number,
  cx: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = `M ${cx(from).toFixed(1)} ${y(values[from]).toFixed(1)}`;
  for (let i = from; i < to; i++) {
    // The standard Hermite-to-Bézier conversion: control points a third of a column either side,
    // each carrying its end's tangent.
    const third = (cx(i + 1) - cx(i)) / 3;
    const c1x = cx(i) + third;
    const c1y = y(values[i] + slope[i] / 3);
    const c2x = cx(i + 1) - third;
    const c2y = y(values[i + 1] - slope[i + 1] / 3);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${cx(i + 1).toFixed(1)} ${y(values[i + 1]).toFixed(1)}`;
  }
  return d;
}

/**
 * The index of the last point that is not a forecast, or 0 when every point is one.
 *
 * Shared because the settled/forecast boundary is the thing both renderers cut their line at, and
 * an off-by-one here shows up as a dashed segment starting a month early — which reads as a claim
 * that the month already closed is still a guess.
 */
export function lastSettledIndex(projected: boolean[]): number {
  if (projected.every(Boolean)) return 0;
  return Math.max(0, projected.length - 1 - [...projected].reverse().findIndex((p) => !p));
}

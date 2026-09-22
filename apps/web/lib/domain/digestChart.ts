/**
 * The dashboard's profit-and-loss widget, as an SVG the email can carry.
 *
 * Pure: twelve points in, one SVG string out. No I/O, no clock, no rasteriser — `lib/digestImage.ts`
 * turns this into the PNG that actually travels, and keeping the two apart is what lets the geometry
 * be fixture-pinned without a native dependency in the test path.
 *
 * ─── Why this is an image at all, when the rest of the email refuses to be ────────────────────
 *
 * The first version of this chart was built from table cells, because the renderer's standing rule
 * is that it emits no URL and pulls nothing from the network. That rule stands and is unchanged.
 * What table cells cannot do is a CURVE: a div has one rectangle in it, so twelve of them are a
 * staircase, and the owner's word for the result was "square, as in Minecraft". Nor can they layer
 * a line over bars, which needs two things at one depth and absolute positioning that Gmail strips.
 *
 * So the chart becomes a picture — and specifically a picture ATTACHED TO THE MESSAGE, referenced
 * as `cid:`, never fetched. That distinction is the whole of it. A remote `<img src="https://…">`
 * is a second outbound surface: it reaches a host the owner did not choose, and the request itself
 * reports that the message was opened, at what time, from what address. A `cid:` part is bytes
 * already inside the envelope. Nothing is fetched, nothing is reported, and the message renders the
 * same with the network unplugged. `digest.test.ts` still forbids `http`, `https` and `data:` and
 * now admits exactly one scheme.
 *
 * ─── One axis for bars and line, which is the dashboard's rule and it is load-bearing ─────────
 *
 * `components/charts/ProfitLossChart.tsx` states it: a second scale "would let the two be slid
 * against each other until they told whatever story the axis ranges happened to imply — the
 * standard way a combo chart lies — and both series are dollars, so there is no reason to". The
 * same holds here and the same single scale is used.
 */

import { lastSettledIndex, monotonePath, monotoneTangents } from '@b8/contracts/monotone';

/** What one month contributes to the picture. The same fields `YearEndPoint` carries. */
export interface ChartPoint {
  income: number;
  expense: number;
  cumulative: number;
  projected: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Rendered at twice the display width and shown at half, so the PNG is sharp on a phone. Every
// other number in this file is in these rendered units.
const W = 1120;
const H = 470;
const PAD = { top: 14, right: 10, bottom: 34, left: 92 };

const GREEN = '#10b981';
const BLUE = '#3b82f6';
const INK = '#111827';
const FAINT = '#9ca3af';
const GRID = '#eef2f7';
const ZERO = '#94a3b8';
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;
const COL = plotW / 12;
const BAR = COL * 0.34;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A tick step that lands on a readable number, and about five of them across the range. */
function tickStep(span: number): number {
  const rough = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (magnitude * multiple >= rough) return magnitude * multiple;
  }
  return magnitude * 10;
}

export function renderChartSvg(points: ChartPoint[]): string {
  if (points.length !== 12) {
    throw new RangeError(`digestChart: needs 12 points, got ${points.length}`);
  }

  // ONE scale over everything drawn: both bar series and the running total. Zero is always in it,
  // because on a P/L the zero line is the only level that means anything on its own.
  const highest = Math.max(0, ...points.map((p) => Math.max(p.income, p.cumulative)));
  const lowest = Math.min(0, ...points.map((p) => Math.min(-p.expense, p.cumulative)));
  const step = tickStep(highest - lowest || 1);
  const top = Math.ceil(highest / step) * step;
  const bottom = Math.floor(lowest / step) * step;
  const span = top - bottom || 1;

  const y = (value: number) => PAD.top + ((top - value) / span) * plotH;
  const cx = (index: number) => PAD.left + COL * index + COL / 2;
  const zeroY = y(0);

  const parts: string[] = [];

  // ── Grid and the axis labels ────────────────────────────────────────────────────────────────
  for (let tick = bottom; tick <= top + 1e-9; tick += step) {
    const ty = y(tick);
    const isZero = Math.abs(tick) < 1e-9;
    parts.push(
      `<line x1="${PAD.left}" y1="${ty.toFixed(1)}" x2="${W - PAD.right}" y2="${ty.toFixed(1)}" ` +
      `stroke="${isZero ? ZERO : GRID}" stroke-width="${isZero ? 2 : 1.5}"/>`
    );
    parts.push(
      `<text x="${PAD.left - 14}" y="${(ty + 7).toFixed(1)}" text-anchor="end" font-family="${FONT}" ` +
      `font-size="19" fill="${FAINT}">${esc(`${tick < 0 ? '−' : ''}$${Math.abs(tick / 1000).toFixed(0)}k`)}</text>`
    );
  }

  // ── Bars: money in above the line, money out below it, in ONE column ────────────────────────
  //
  // Sharing a column rather than standing side by side, so money in sits exactly above the money
  // out it has to cover. That vertical pairing is the comparison the chart is for; two neighbouring
  // bars leave the eye to do it. The two series have opposite signs so they can never collide.
  points.forEach((p, i) => {
    const x = (cx(i) - BAR / 2).toFixed(1);
    const faded = p.projected;
    const bar = (value: number, colour: string, above: boolean) => {
      if (value <= 0) return;
      const yTop = above ? y(value) : zeroY;
      const height = Math.abs(y(value === 0 ? 0 : above ? value : -value) - zeroY);
      if (height < 0.5) return;
      parts.push(
        `<rect x="${x}" y="${yTop.toFixed(1)}" width="${BAR.toFixed(1)}" height="${height.toFixed(1)}" ` +
        `fill="${colour}" fill-opacity="${faded ? 0.14 : 0.3}" rx="3"` +
        (faded ? ` stroke="${colour}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="5 3"` : '') +
        `/>`
      );
    };
    bar(p.income, GREEN, true);
    bar(p.expense, BLUE, false);
  });

  // ── The running total, smooth ───────────────────────────────────────────────────────────────
  //
  // Tangents are computed over the WHOLE series and then the path is cut in two, rather than
  // fitting each piece separately. A per-piece fit would give the last settled month two different
  // tangents and kink the curve at exactly the join between what happened and what is expected.
  // The curve maths moved to `@b8/contracts/monotone` when the phone's chart needed the same line.
  // Shared rather than copied: two smoothing functions do not fail loudly when they drift, they
  // draw two subtly different pictures of one year and nobody can say which is right.
  const values = points.map((p) => p.cumulative);
  const slope = monotoneTangents(values);
  const settledEnd = lastSettledIndex(points.map((p) => p.projected));

  const segment = (from: number, to: number): string => monotonePath(values, slope, from, to, cx, y);

  const line = (d: string, dashed: boolean) =>
    `<path d="${d}" fill="none" stroke="${GREEN}" stroke-width="${dashed ? 4 : 5}" ` +
    `stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="11 8"' : ''}/>`;

  if (settledEnd > 0) parts.push(line(segment(0, settledEnd), false));
  // The forecast path STARTS at the last settled point, so the two share it and the line is
  // continuous rather than gapped at the boundary.
  if (settledEnd < 11) parts.push(line(segment(settledEnd, 11), true));

  points.forEach((p, i) => {
    parts.push(
      `<circle cx="${cx(i).toFixed(1)}" cy="${y(values[i]).toFixed(1)}" r="${p.projected ? 4.5 : 5.5}" ` +
      `fill="#ffffff" stroke="${GREEN}" stroke-width="3"/>`
    );
  });

  // ── Month labels, with the as-of month in ink ───────────────────────────────────────────────
  points.forEach((p, i) => {
    const isCurrent = p.projected && (i === 0 || !points[i - 1].projected);
    parts.push(
      `<text x="${cx(i).toFixed(1)}" y="${(H - 10).toFixed(1)}" text-anchor="middle" font-family="${FONT}" ` +
      `font-size="20" font-weight="${isCurrent ? 600 : 400}" fill="${isCurrent ? INK : FAINT}">${MONTHS[i]}</text>`
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    parts.join('') +
    `</svg>`
  );
}

/** The display width of the rendered image, in CSS pixels. Half the raster, so it is retina-sharp. */
export const CHART_DISPLAY_WIDTH = W / 2;
export const CHART_DISPLAY_HEIGHT = H / 2;

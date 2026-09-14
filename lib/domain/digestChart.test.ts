import { describe, expect, it } from 'vitest';
import { renderChartSvg, type ChartPoint } from './digestChart';

/** The owner's real operational year: it crosses zero, spikes in April and troughs in June. */
function year(): ChartPoint[] {
  const rows: Array<[number, number, number]> = [
    [7618, 3300, 4319], [7704, 6081, 5942], [13879, 9278, 10543], [7315, 22739, -4880],
    [7090, 24424, -22215], [15206, 25735, -32744], [13160, 5156, -24740], [11103, 11808, -25445],
    [20000, 6078, -10091], [12000, 6793, -4884], [12000, 13593, -6477], [11500, 5022, 1],
  ];
  return rows.map(([income, expense, cumulative], i) => ({
    income, expense, cumulative, projected: i >= 8,
  }));
}

/** Every y coordinate the line path visits, control points included. */
function pathYs(svg: string): number[] {
  const out: number[] = [];
  for (const path of svg.match(/<path d="[^"]+"/g) ?? []) {
    const numbers = path.match(/-?\d+(?:\.\d+)?/g) ?? [];
    for (let i = 1; i < numbers.length; i += 2) out.push(Number(numbers[i]));
  }
  return out;
}

describe('the P/L chart', () => {
  it('draws both series: bars for the month and a line for the running total', () => {
    const svg = renderChartSvg(year());
    // Twelve months of money in and money out, minus nothing that rounds away.
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(24);
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
  });

  it('cuts the line into a solid past and a dashed forecast that share a point', () => {
    const svg = renderChartSvg(year());
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    expect(paths.filter((p) => p.includes('stroke-dasharray'))).toHaveLength(1);
    expect(paths.filter((p) => !p.includes('stroke-dasharray'))).toHaveLength(1);

    // The dashed path must BEGIN where the solid one ends, or the year has a visible gap at exactly
    // the boundary between what happened and what is expected.
    const solidEnd = /C[^"]*?([\d.]+) ([\d.]+)"/.exec(paths.find((p) => !p.includes('stroke-dasharray'))!);
    const dashedStart = /M ([\d.]+) ([\d.]+)/.exec(paths.find((p) => p.includes('stroke-dasharray'))!);
    expect(dashedStart).not.toBeNull();
    expect(solidEnd).not.toBeNull();
    expect(Number(dashedStart![1])).toBeCloseTo(Number(solidEnd![1]), 1);
    expect(Number(dashedStart![2])).toBeCloseTo(Number(solidEnd![2]), 1);
  });

  it('never bends the curve past the lowest or highest figure in the series', () => {
    // THE REASON THE INTERPOLATION IS MONOTONE RATHER THAN CATMULL-ROM. Catmull-Rom overshoots: on
    // this data — a −$32,744 trough followed by two months near −$25,000 — it bows the curve below
    // the trough and draws a loss the year never had. A chart of money may smooth a line; it may
    // not invent one.
    const svg = renderChartSvg(year());
    const values = year().map((p) => p.cumulative);

    // y grows downward, so the deepest loss is the LARGEST y on the canvas.
    const ys = pathYs(svg);
    const highest = Math.min(...ys);
    const lowest = Math.max(...ys);

    // Recover the scale from the two extreme data points and check the path stays inside them.
    const svgYFor = (value: number) => {
      const top = Math.max(0, ...values.map((v) => v), ...year().map((p) => p.income));
      const bottom = Math.min(0, ...values, ...year().map((p) => -p.expense));
      void top; void bottom;
      return value;
    };
    void svgYFor;

    // Stated without reconstructing the scale: the path's extremes must be the extremes of the
    // DATA points, which are themselves on the path. A control point outside them is an overshoot.
    const dataYs = ys.filter((_, i) => i % 3 === 0);
    expect(lowest).toBeLessThanOrEqual(Math.max(...dataYs) + 0.05);
    expect(highest).toBeGreaterThanOrEqual(Math.min(...dataYs) - 0.05);
  });

  it('puts money in above the zero line and money out below it, in one column', () => {
    // Sharing a column is the comparison the chart is for: money in sits directly above the money
    // out it has to cover, rather than leaving the eye to pair two neighbours.
    const svg = renderChartSvg(year());
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="(#[0-9a-f]{6})"/g)];
    const green = rects.filter((r) => r[5] === '#10b981');
    const blue = rects.filter((r) => r[5] === '#3b82f6');
    expect(green).toHaveLength(12);
    expect(blue).toHaveLength(12);

    // Capture groups, in order: x, y, width, height, fill.
    const [X, Y, W, HGT] = [1, 2, 3, 4];
    for (let i = 0; i < 12; i++) {
      // Money in starts higher up the canvas and ends at the zero line; money out starts there and
      // goes down. y grows downward, so "above" is a smaller y.
      expect(Number(green[i][Y])).toBeLessThan(Number(blue[i][Y]));
      // To within half a pixel, not to the tenth: y and height are each rounded to one decimal
      // independently, so their sum can sit 0.1 from the rounded zero line. That is a seam narrower
      // than the 2px zero rule drawn over it, not a gap between the bars.
      expect(Number(green[i][Y]) + Number(green[i][HGT])).toBeCloseTo(Number(blue[i][Y]), 0);
      // One column: same x, same width.
      expect(Number(green[i][X])).toBeCloseTo(Number(blue[i][X]), 1);
      expect(Number(green[i][W])).toBeCloseTo(Number(blue[i][W]), 1);
    }
  });

  it('scales both series on ONE axis, so a dollar is one height wherever it appears', () => {
    // The dashboard states the rule and the reason: a second scale "would let the two be slid
    // against each other until they told whatever story the axis ranges happened to imply".
    // Doubling every figure must scale every drawn height by the same factor, not reframe one side.
    // Checked as an INVARIANT rather than through the tick labels, which round to readable numbers
    // and so do not scale linearly with the data: doubling this year moves the axis from 20k steps
    // to 25k ones, which says nothing about whether the two series share a scale.
    const svg = renderChartSvg(year());
    const rects = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"[^>]*fill="(#[0-9a-f]{6})"/g)];
    const rows = year();

    const pixelsPerDollar = rects.map((r, i) => {
      const month = rows[Math.floor(i / 2)];
      const value = r[2] === '#10b981' ? month.income : month.expense;
      return Number(r[1]) / value;
    });

    // Every drawn height, money in and money out alike, converts dollars to pixels at one rate.
    const first = pixelsPerDollar[0];
    for (const rate of pixelsPerDollar) expect(rate).toBeCloseTo(first, 4);
  });

  it('always keeps break-even on the canvas, even in a year entirely under water', () => {
    const drowned = year().map((p) => ({ ...p, income: 0, cumulative: -Math.abs(p.cumulative) - 40000 }));
    const svg = renderChartSvg(drowned);
    // The zero rule is the one line drawn in the darker grey.
    expect(svg).toContain('stroke="#94a3b8"');
    expect(svg).toContain('$0k');
  });

  it('survives a year with no money in it at all', () => {
    const empty: ChartPoint[] = Array.from({ length: 12 }, () => ({
      income: 0, expense: 0, cumulative: 0, projected: true,
    }));
    expect(() => renderChartSvg(empty)).not.toThrow();
    expect(renderChartSvg(empty)).toContain('<svg');
  });

  it('refuses a series that is not twelve months', () => {
    expect(() => renderChartSvg(year().slice(0, 11))).toThrow(RangeError);
  });

  it('escapes nothing it did not write, because it renders no caller-supplied text', () => {
    // Every string in this SVG is a month name or a formatted number. No merchant name and no
    // category reaches it, so there is no injection surface to escape — asserted rather than
    // assumed, since adding a label later would quietly create one.
    const svg = renderChartSvg(year());
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    for (const t of texts) expect(t).toMatch(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|−?\$\d+k)$/);
  });
});

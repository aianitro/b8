import { describe, it, expect } from 'vitest';
import { AREA_EXPONENT, pictureArea } from './pictureScale';

/**
 * EVERY NUMBER BELOW IS A RATIO, NOT AN AMOUNT — 1 and 100 rather than a budget-shaped figure.
 *
 * Partly because AGENTS.md asks for it, and partly because it is what the function is about: all
 * `pictureArea` decides is how far apart two marks look, so the only input that means anything
 * here is how many times bigger one is than the other.
 */

/** The share of a box these weights take when they are drawn beside each other. */
const shares = (weights: number[]) => {
  const areas = weights.map(pictureArea);
  const total = areas.reduce((s, a) => s + a, 0);
  return areas.map((a) => a / total);
};

describe('pictureArea', () => {
  it('compresses the ladder the pictures are sized on', () => {
    // The rule as it is described to a reader: five times as much is about twice the mark.
    expect(pictureArea(5) / pictureArea(1)).toBeCloseTo(2.24, 2);
    expect(pictureArea(2) / pictureArea(1)).toBeCloseTo(1.41, 2);
    expect(pictureArea(100) / pictureArea(1)).toBeCloseTo(10, 6);
  });

  it('never reorders two categories', () => {
    // The property the compression must not cost: it changes how far apart two marks look, never
    // which of them is bigger. Across four orders of magnitude, adjacent pairs included.
    const spread = [1, 2, 3, 10, 11, 50, 100, 101, 1000, 10000];
    const areas = spread.map(pictureArea);
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeGreaterThan(areas[i - 1]);
    }
  });

  it('leaves equals equal', () => {
    expect(pictureArea(64)).toBe(pictureArea(64));
    const [a, b] = shares([64, 64]);
    expect(a).toBeCloseTo(b, 12);
  });

  it('rescues the small end of a lopsided month', () => {
    // One category two orders of magnitude above the rest — the shape that started this. Drawn
    // proportionally the smallest holds well under 1% of the box, which is below a glyph, a figure
    // and a fingertip. It has to clear 2% here, while the largest still holds the most.
    const month = [100, 10, 8, 5, 4, 4, 3, 3, 2, 1];
    const s = shares(month);
    const proportional = month[month.length - 1] / month.reduce((x, y) => x + y, 0);

    expect(proportional).toBeLessThan(0.01);
    expect(s[s.length - 1]).toBeGreaterThan(0.02);
    expect(Math.max(...s)).toBe(s[0]);
  });

  it('drops what cannot be drawn', () => {
    // Both layouts discard a non-positive weight, and these are the shapes that reach it: a
    // category with no budget and no spend, a refund-only month, and a figure that failed to parse.
    expect(pictureArea(0)).toBe(0);
    expect(pictureArea(-25)).toBe(0);
    expect(pictureArea(Number.NaN)).toBe(0);
    expect(pictureArea(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('is the square root, in one place, for all three pictures', () => {
    // The constant is the knob the module documents; if it moves, this says so out loud rather
    // than letting the bubbles, the tiles and the email drift apart quietly.
    expect(AREA_EXPONENT).toBe(0.5);
    expect(pictureArea(81)).toBeCloseTo(9, 12);
  });
});

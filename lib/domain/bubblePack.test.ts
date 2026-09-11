import { describe, it, expect } from 'vitest';
import { packCircles, type PackInput } from './bubblePack';

const W = 640, H = 260;
const budgets: PackInput[] = [
  { key: 'Grocery', weight: 1900 }, { key: 'Travel', weight: 1200 },
  { key: 'Clothes', weight: 550 }, { key: 'Gas', weight: 520 },
  { key: 'Sport', weight: 440 }, { key: 'Restaurants', weight: 400 },
  { key: 'Entertainment', weight: 350 }, { key: 'Pets', weight: 130 },
  { key: 'Education', weight: 75 },
];

const overlaps = (cs: ReturnType<typeof packCircles>, pad = 0) => {
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
      if (d < cs[i].r + cs[j].r + pad - 1e-6) return [cs[i].key, cs[j].key];
    }
  }
  return null;
};

describe('packCircles', () => {
  it('places every category exactly once', () => {
    const out = packCircles(budgets, W, H);
    expect(out).toHaveLength(budgets.length);
    expect(new Set(out.map((c) => c.key)).size).toBe(budgets.length);
  });

  it('never overlaps two circles', () => {
    expect(overlaps(packCircles(budgets, W, H))).toBeNull();
  });

  it('keeps every circle inside the box', () => {
    for (const c of packCircles(budgets, W, H)) {
      expect(c.x - c.r).toBeGreaterThanOrEqual(0);
      expect(c.y - c.r).toBeGreaterThanOrEqual(0);
      expect(c.x + c.r).toBeLessThanOrEqual(W);
      expect(c.y + c.r).toBeLessThanOrEqual(H);
    }
  });

  it('scales area with weight, not radius', () => {
    // Grocery's budget is 4x Education-and-friends; its AREA must be 4x, so radius only 2x.
    const out = packCircles([{ key: 'a', weight: 400 }, { key: 'b', weight: 100 }], W, H, { minRadius: 1 });
    const a = out.find((c) => c.key === 'a')!;
    const b = out.find((c) => c.key === 'b')!;
    expect(a.r / b.r).toBeCloseTo(2, 1);
    expect((a.r ** 2) / (b.r ** 2)).toBeCloseTo(4, 1);
  });

  it('is deterministic — the same input draws the same picture', () => {
    expect(packCircles(budgets, W, H)).toEqual(packCircles(budgets, W, H));
  });

  it('does not depend on the order the caller supplies', () => {
    const reversed = [...budgets].reverse();
    expect(packCircles(reversed, W, H)).toEqual(packCircles(budgets, W, H));
  });

  it('drops non-positive and non-finite weights rather than drawing them', () => {
    const out = packCircles(
      [{ key: 'ok', weight: 100 }, { key: 'zero', weight: 0 },
       { key: 'neg', weight: -50 }, { key: 'nan', weight: NaN }], W, H);
    expect(out.map((c) => c.key)).toEqual(['ok']);
  });

  it('returns nothing for an empty set or a box with no room', () => {
    expect(packCircles([], W, H)).toEqual([]);
    expect(packCircles(budgets, 0, H)).toEqual([]);
    expect(packCircles(budgets, W, -1)).toEqual([]);
  });

  it('still fits when one category dwarfs the rest', () => {
    const lopsided = [{ key: 'huge', weight: 100000 }, ...budgets];
    const out = packCircles(lopsided, W, H);
    expect(out).toHaveLength(lopsided.length);
    expect(overlaps(out)).toBeNull();
  });

  it('honours the requested padding between neighbours', () => {
    expect(overlaps(packCircles(budgets, W, H, { padding: 8 }), 8)).toBeNull();
  });
});

describe('recentring', () => {
  it('centres the cluster in the panel rather than leaving the slack on one side', () => {
    const out = packCircles(budgets, W, H);
    const minX = Math.min(...out.map((c) => c.x - c.r));
    const maxX = Math.max(...out.map((c) => c.x + c.r));
    const minY = Math.min(...out.map((c) => c.y - c.r));
    const maxY = Math.max(...out.map((c) => c.y + c.r));
    // Equal slack either side, to within a pixel.
    expect(minX).toBeCloseTo(W - maxX, 0);
    expect(minY).toBeCloseTo(H - maxY, 0);
  });

  it('still leaves no overlaps after the shift', () => {
    expect(overlaps(packCircles(budgets, W, H))).toBeNull();
  });
});

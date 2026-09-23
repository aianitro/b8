import { describe, expect, it } from 'vitest';
import { layoutTreemap, type TreemapItem } from './treemap';

// Geometry tests, because the layout is the part of this widget that can be wrong while looking
// plausible: a treemap whose areas are subtly out of proportion still renders as a tidy grid of
// coloured boxes, and nothing on screen says the sizes are lying.

const W = 360;
const H = 280;

/**
 * The SHAPE of a real month — a few large categories and a long tail of small ones — as unit-less
 * weights, not amounts. Deliberately not currency-scaled: what the layout consumes is ratios, and a
 * plausible-looking dollar figure beside a category name in a tracked file reads as the owner's
 * ledger whether or not it is (AGENTS.md). These are invented, and shaped so they cannot be mistaken
 * for anything else.
 */
const REAL: TreemapItem[] = [
  { key: 'Mortgage', weight: 24 },
  { key: 'Grocery', weight: 18 },
  { key: 'Utilities', weight: 6.2 },
  { key: 'Dining Out', weight: 5.4 },
  { key: 'Fuel', weight: 3 },
  { key: 'Insurance', weight: 2.8 },
  { key: 'Subscriptions', weight: 1.4 },
  { key: 'Health', weight: 1.2 },
  { key: 'Pets', weight: 0.9 },
  { key: 'Education', weight: 0.75 },
  { key: 'Gifts', weight: 0.6 },
  { key: 'Online', weight: 0.4 },
];

const area = (t: { w: number; h: number }) => t.w * t.h;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  const eps = 1e-6;
  return a.x + a.w - eps > b.x && b.x + b.w - eps > a.x
      && a.y + a.h - eps > b.y && b.y + b.h - eps > a.y;
}

describe('layoutTreemap', () => {
  it('gives every item a tile', () => {
    const tiles = layoutTreemap(REAL, W, H);
    expect(tiles).toHaveLength(REAL.length);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(REAL.length);
  });

  // The claim the widget's legend makes. If this drifts, the picture is decorative.
  it('makes area proportional to weight', () => {
    const tiles = layoutTreemap(REAL, W, H);
    const total = REAL.reduce((a, i) => a + i.weight, 0);
    for (const t of tiles) {
      const want = (REAL.find((i) => i.key === t.key)!.weight / total) * W * H;
      expect(area(t)).toBeCloseTo(want, 4);
    }
  });

  it('fills the box exactly, with no overlap and nothing outside it', () => {
    const tiles = layoutTreemap(REAL, W, H);
    expect(tiles.reduce((a, t) => a + area(t), 0)).toBeCloseTo(W * H, 4);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-6);
      expect(t.y).toBeGreaterThanOrEqual(-1e-6);
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-6);
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-6);
    }
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(overlaps(tiles[i], tiles[j])).toBe(false);
      }
    }
  });

  it('puts the largest tile at the top-left', () => {
    const tiles = layoutTreemap(REAL, W, H);
    const biggest = tiles.reduce((a, t) => (area(t) > area(a) ? t : a));
    expect(biggest.key).toBe('Mortgage');
    expect(biggest.x).toBeCloseTo(0, 6);
    expect(biggest.y).toBeCloseTo(0, 6);
  });

  // The entire reason for squarifying rather than slicing. A naive slice-and-dice puts the
  // smallest of these at roughly 40:1; anything under about 6:1 is readable and tappable.
  it('keeps even the smallest tile near square', () => {
    const tiles = layoutTreemap(REAL, W, H);
    const worst = Math.max(...tiles.map((t) => Math.max(t.w / t.h, t.h / t.w)));
    expect(worst).toBeLessThan(6);
  });

  it('gives a single item the whole box', () => {
    const [only] = layoutTreemap([{ key: 'Grocery', weight: 18 }], W, H);
    expect(only).toMatchObject({ key: 'Grocery', x: 0, y: 0, w: W, h: H });
  });

  it('splits two equal weights into two equal halves', () => {
    const tiles = layoutTreemap([{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }], 100, 100);
    expect(tiles).toHaveLength(2);
    for (const t of tiles) expect(area(t)).toBeCloseTo(5000, 6);
  });

  // Dropped rather than floored: a category with no allocation has no area to be proportional to,
  // and drawing it at a minimum size would make every other tile's size mean something else.
  it('drops non-positive weights instead of giving them a floor', () => {
    const tiles = layoutTreemap(
      [{ key: 'a', weight: 100 }, { key: 'zero', weight: 0 }, { key: 'neg', weight: -50 }], W, H
    );
    expect(tiles.map((t) => t.key)).toEqual(['a']);
    expect(area(tiles[0])).toBeCloseTo(W * H, 4);
  });

  it('returns nothing for empty input, all-zero weights, or a zero-sized box', () => {
    expect(layoutTreemap([], W, H)).toEqual([]);
    expect(layoutTreemap([{ key: 'a', weight: 0 }], W, H)).toEqual([]);
    expect(layoutTreemap(REAL, 0, H)).toEqual([]);
    expect(layoutTreemap(REAL, W, 0)).toEqual([]);
  });

  // A pathological spread — the largest 2000x the smallest — must still terminate and tile
  // exactly. It is the shape that breaks a row-accumulator written with a strict `<`.
  it('survives an extreme range of weights', () => {
    const items = [
      { key: 'huge', weight: 2000 }, { key: 'mid', weight: 5 },
      { key: 'tiny', weight: 1 }, { key: 'tinier', weight: 0.01 },
    ];
    const tiles = layoutTreemap(items, W, H);
    expect(tiles).toHaveLength(4);
    expect(tiles.reduce((a, t) => a + area(t), 0)).toBeCloseTo(W * H, 4);
  });

  it('is stable: the same input lays out the same way twice', () => {
    expect(layoutTreemap(REAL, W, H)).toEqual(layoutTreemap(REAL, W, H));
  });
});

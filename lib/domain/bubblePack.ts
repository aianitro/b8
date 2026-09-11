// Deterministic circle packing, for the dashboard's category bubbles.
//
// Pure geometry, no dependency. d3-hierarchy would do this too, but it is a large addition for one
// widget and its pack is not deterministic across versions — a layout that reshuffles on an
// unrelated upgrade is a layout nobody trusts to compare week to week.
//
// AREA carries the value, not radius. Area is what the eye reads off a circle, so a category with
// twice the budget must occupy twice the ink: radius therefore scales with the square root of the
// weight. Scaling radius linearly — the obvious mistake — makes a $1,900 grocery budget look
// twenty-five times a $75 one rather than five.

export interface PackInput {
  key: string;
  /** The quantity area should be proportional to. Non-positive entries are dropped. */
  weight: number;
}

export interface PackedCircle {
  key: string;
  x: number;
  y: number;
  r: number;
}

export interface PackOptions {
  /** Gap held between neighbouring circles, and from the edge. */
  padding?: number;
  /** Share of the box the circles should cover before shrinking to fit. */
  fill?: number;
  /** Smallest radius worth drawing; anything below is still placed, just not shrunk further. */
  minRadius?: number;
}

const TAU = Math.PI * 2;

/**
 * Circles placed largest first, each at the first free point on a spiral out from the centre.
 *
 * Greedy and deterministic rather than force-directed: the same input always produces the same
 * picture, so a category that has not moved does not appear to. A force simulation looks marginally
 * tidier and jitters on every render, which reads as data changing when nothing has.
 */
export function packCircles(
  items: PackInput[],
  width: number,
  height: number,
  opts: PackOptions = {}
): PackedCircle[] {
  const padding = opts.padding ?? 3;
  const fill = opts.fill ?? 0.62;
  const minRadius = opts.minRadius ?? 6;

  const usable = items.filter((i) => i.weight > 0 && Number.isFinite(i.weight));
  if (usable.length === 0 || width <= 0 || height <= 0) return [];

  const totalWeight = usable.reduce((s, i) => s + i.weight, 0);
  // k such that the circles cover `fill` of the box: Σ π(k√w)² = fill·W·H.
  let k = Math.sqrt((fill * width * height) / (Math.PI * totalWeight));

  // Shrink and retry rather than overflow. Bounded, because an unbounded loop here is a hung
  // render on a single pathological input — after the last attempt the best effort is returned
  // and the caller gets a slightly loose layout rather than nothing.
  for (let attempt = 0; attempt < 12; attempt++) {
    const placed = tryPack(usable, width, height, k, padding, minRadius);
    if (placed) return placed;
    k *= 0.88;
  }
  return tryPack(usable, width, height, k, padding, minRadius, true) ?? [];
}

function tryPack(
  items: PackInput[],
  width: number,
  height: number,
  k: number,
  padding: number,
  minRadius: number,
  force = false
): PackedCircle[] | null {
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) / 2 - padding;

  // The whole layout is scaled down so the largest circle fits, rather than that one circle being
  // clamped. Clamping is the tempting fix and it quietly destroys the encoding: cap the biggest
  // and it no longer has the area its weight earned, so every comparison a reader makes against it
  // is wrong, in the one direction that matters most.
  //
  // `minRadius` is the deliberate exception, and it does break proportionality at the bottom. A
  // circle below a few pixels is not a small datum, it is an invisible one — and a category the
  // reader cannot see or hover is worse than one drawn slightly too large. The distortion is
  // confined to the smallest budgets, where the reader is not comparing areas anyway.
  const maxWeight = Math.max(...items.map((i) => i.weight));
  const kFit = Math.min(k, maxR / Math.sqrt(maxWeight));

  const sized = items
    .map((i) => ({ key: i.key, r: Math.max(minRadius, kFit * Math.sqrt(i.weight)) }))
    .sort((a, b) => b.r - a.r || a.key.localeCompare(b.key));

  const out: PackedCircle[] = [];
  for (const { key, r } of sized) {
    const spot = findSpot(out, r, cx, cy, width, height, padding);
    if (!spot) {
      if (!force) return null;
      continue;
    }
    out.push({ key, x: spot.x, y: spot.y, r });
  }
  return recenter(out, width, height);
}

/**
 * Shifts the finished cluster so its bounding box sits centred in the panel.
 *
 * Spiral placement grows outward from the centre but not evenly — whichever direction happened to
 * have room first gets used — so the result is reliably lopsided, with the dead space all on one
 * side. Centring is cosmetic and it matters: an off-centre cluster reads as though the empty half
 * means something.
 */
// Two decimals is finer than a pixel at any size this renders at, and it is the reason the output
// is rounded AT ALL: an unrounded coordinate serialises to 17 significant digits on the server and
// 16 in the browser — `193.8309000499607` against `193.83090004996063` — and React reports that as
// a hydration mismatch on every circle. Same number, two spellings, one warning per bubble.
const px = (n: number) => Math.round(n * 100) / 100;

function recenter(circles: PackedCircle[], width: number, height: number): PackedCircle[] {
  if (circles.length === 0) return circles;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
  }
  const dx = (width - (minX + maxX)) / 2;
  const dy = (height - (minY + maxY)) / 2;
  return circles.map((c) => ({ ...c, x: px(c.x + dx), y: px(c.y + dy), r: px(c.r) }));
}

/** First point on an outward spiral where this circle touches nothing and stays inside the box. */
function findSpot(
  placed: PackedCircle[],
  r: number,
  cx: number,
  cy: number,
  width: number,
  height: number,
  padding: number
): { x: number; y: number } | null {
  const fits = (x: number, y: number) =>
    x - r >= padding && x + r <= width - padding &&
    y - r >= padding && y + r <= height - padding &&
    placed.every((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.hypot(dx, dy) >= p.r + r + padding;
    });

  if (fits(cx, cy)) return { x: cx, y: cy };

  const step = Math.max(1.5, r / 4);
  const maxRadius = Math.hypot(width, height);
  for (let dist = step; dist <= maxRadius; dist += step) {
    // Angular resolution rises with distance so the arc step stays roughly constant — a fixed
    // count leaves coarse gaps far out, where most circles after the first few end up.
    const steps = Math.max(12, Math.ceil((TAU * dist) / step));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * TAU;
      const x = cx + Math.cos(a) * dist;
      const y = cy + Math.sin(a) * dist;
      if (fits(x, y)) return { x, y };
    }
  }
  return null;
}

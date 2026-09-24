// Squarified treemap layout. Pure geometry: weights in, rectangles out, no React and no colour.
//
// ─── Why a treemap here and circles on the web ────────────────────────────────────────────────
//
// The web dashboard packs the same data as circles (`lib/domain/bubblePack.ts`). Circle packing
// wastes the gaps between circles, which is affordable at 1000px wide and is not at 360: the same
// fifteen categories lose roughly a third of the box to whitespace, and the smallest ones fall
// under the radius at which anything can be drawn in them. A treemap spends every pixel, which is
// why market heatmaps have this shape and why the owner asked for it by that name.
//
// ─── The algorithm, and why not a simpler one ─────────────────────────────────────────────────
//
// Bruls, Huizing & van Wijk's squarified treemap. The naive alternative — slice the box, alternate
// direction per level — is ten lines shorter and produces slivers: a category at 1/40th of the
// budget comes out about 350x9, which is unreadable and untappable. Squarifying keeps tiles near
// square by choosing, greedily, how many of the next items to lay in the current row.
//
// Worth stating because it looks like premature cleverness in a phone widget and is not: the
// sliver case is the SMALL categories, which are exactly the ones a reader is scanning for when
// one of them turns red.

export interface TreemapItem {
  key: string;
  /** Drives AREA. Non-positive weights are dropped — see `layoutTreemap`. */
  weight: number;
}

export interface TreemapTile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Rect { x: number; y: number; w: number; h: number }

/**
 * The aspect ratio of the worst tile in a row laid along `side`.
 *
 * Both directions are tested — `side² · max / sum²` and `sum² / (side² · min)` — because a row can
 * be wrong by being too flat OR too tall, and taking only one of them lets the other run away.
 */
function worstRatio(areas: number[], side: number): number {
  if (areas.length === 0 || side <= 0) return Infinity;
  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (const a of areas) {
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (sum <= 0 || min <= 0) return Infinity;
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Place one finished row and return what is left of the free rectangle.
 *
 * The row is laid along the SHORTER side, which is the whole trick: laying along the longer one
 * gives every tile in the row the same flatness the row was chosen to avoid.
 */
function placeRow(areas: number[], keys: string[], rect: Rect, out: TreemapTile[]): Rect {
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum <= 0) return rect;

  if (rect.w < rect.h) {
    // Shorter side is the width: a band across the top, consuming height.
    const bandH = sum / rect.w;
    let x = rect.x;
    for (let i = 0; i < areas.length; i++) {
      const tileW = areas[i] / bandH;
      out.push({ key: keys[i], x, y: rect.y, w: tileW, h: bandH });
      x += tileW;
    }
    return { x: rect.x, y: rect.y + bandH, w: rect.w, h: rect.h - bandH };
  }

  // Shorter side is the height: a column down the left, consuming width.
  const bandW = sum / rect.h;
  let y = rect.y;
  for (let i = 0; i < areas.length; i++) {
    const tileH = areas[i] / bandW;
    out.push({ key: keys[i], x: rect.x, y, w: bandW, h: tileH });
    y += tileH;
  }
  return { x: rect.x + bandW, y: rect.y, w: rect.w - bandW, h: rect.h };
}

/**
 * Tiles filling `width` x `height`, area proportional to weight, largest first from the top-left.
 *
 * ─── Two deliberate omissions ─────────────────────────────────────────────────────────────────
 *
 * NO MINIMUM TILE SIZE. The web's circle packer takes a `minRadius`, because a circle below about
 * 13px cannot be drawn at all and vanishing is worse than being slightly too big. A treemap has no
 * such floor — every tile is visible at any area — and enforcing one here would mean a tile whose
 * size no longer means what the legend says it means. A sliver is honest; a padded sliver is not.
 *
 * NO "OTHER" BUCKET. Aggregating the tail is the usual treemap answer to many small items, and it
 * is the wrong one for this data: the tail is where an overspend hides, and folding six categories
 * into one grey tile hides exactly the finding the colour exists to surface. If the category count
 * ever grows past what a phone can carry, the fix is to split by landscape, not to bucket.
 *
 * Non-positive weights are DROPPED rather than given a floor, because a category with no budget
 * this month has no area to be proportional to. `monthCategories` only carries categories with an
 * allocation, so in practice this filters nothing; it exists so a future caller cannot make the
 * layout silently meaningless by passing zeroes.
 */
export function layoutTreemap(items: TreemapItem[], width: number, height: number): TreemapTile[] {
  if (width <= 0 || height <= 0) return [];

  const usable = items.filter((i) => i.weight > 0);
  const total = usable.reduce((a, i) => a + i.weight, 0);
  if (usable.length === 0 || total <= 0) return [];

  // Largest first. The reader's eye starts top-left, and that is where the money is.
  const sorted = [...usable].sort((a, b) => b.weight - a.weight);
  const scale = (width * height) / total;
  const queue = sorted.map((i) => ({ key: i.key, area: i.weight * scale }));

  const out: TreemapTile[] = [];
  let rect: Rect = { x: 0, y: 0, w: width, h: height };
  let rowAreas: number[] = [];
  let rowKeys: string[] = [];

  while (queue.length > 0) {
    const side = Math.min(rect.w, rect.h);
    const next = queue[0];

    // Add to the current row while doing so does not make its worst tile worse. The `<=` matters
    // for an empty row, where `worstRatio([])` is Infinity and the first item must always be taken.
    if (rowAreas.length === 0 || worstRatio([...rowAreas, next.area], side) <= worstRatio(rowAreas, side)) {
      rowAreas.push(next.area);
      rowKeys.push(next.key);
      queue.shift();
    } else {
      rect = placeRow(rowAreas, rowKeys, rect, out);
      rowAreas = [];
      rowKeys = [];
    }
  }
  if (rowAreas.length > 0) placeRow(rowAreas, rowKeys, rect, out);

  return out;
}

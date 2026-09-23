'use client';

// Where the month sits, as a market heatmap — the phone's widget, brought to the web.
//
// ─── What this replaced, and why the owner was right ──────────────────────────────────────────
//
// It replaced `CategoryBubbles`, which packed the same categories as circles. Bubbles are a fine
// picture at 1000px and a poor one in the PWA, which is where this dashboard is mostly read now:
// circle packing spends about a third of the box on the gaps BETWEEN circles, and the smallest
// categories fall under the radius at which a label — or anything — can be drawn inside them. A
// treemap spends every pixel. The phone got this shape first, the owner liked it there, and asking
// for it here is the same judgement applied to the surface that shares its width.
//
// Bubbles are not gone: the daily digest email still draws them (`lib/domain/digestBubbles.ts`) and
// should. An email has no hover and no tap, so a name only a pointer can uncover is not a name
// there — and the circle packer leaves room beneath each circle to print one, which a treemap by
// definition does not.
//
// ─── Shared with the phone down to the paint ──────────────────────────────────────────────────
//
// Geometry (`@b8/contracts/treemap`), glyphs (`categoryIcon`), grading (`bubbleState`) and the four
// fills (`heatmapPalette`) are all imported rather than restated. What is local to this file is the
// DOM: absolutely-positioned divs where the phone has `View`s, a hover channel it has no pointer
// for, and a link into `/transactions` where it opens a sheet.
//
// ─── Percentage geometry, so a resize needs no measurement ────────────────────────────────────
//
// `layoutTreemap` is called on a 100x100 box and the tiles are positioned in `%`. The map is then
// correct at every width from the first server-rendered byte, with no ResizeObserver in the
// critical path and no hydration guess about a viewport the server cannot see.
//
// The measurement below exists only to decide WHICH TILES CARRY A LABEL, which is a question about
// real pixels: a glyph needs about 13 of them. Until it lands, tiles render bare for one frame —
// and the geometry never moves, because it was never waiting on it.
//
// This is also why the box's HEIGHT is set in CSS rather than from the measured width. Computing
// it in JS would mean rendering at a guessed height and snapping to the right one on mount, which
// is a visible jump on exactly the narrow screens the rule exists for.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { bubbleState } from '@b8/contracts/bubbleStatus';
import { layoutTreemap } from '@b8/contracts/treemap';
import { categoryIcon } from '@b8/contracts/categoryIcon';
import {
  HEATMAP_FILL as FILL,
  HEATMAP_INK as INK,
  HEATMAP_LABEL as LABEL,
  HEATMAP_LEGEND as LEGEND,
} from '@b8/contracts/heatmapPalette';
import { drillHref } from '@/lib/drilldown';

export interface HeatmapCategory {
  category: string;
  /** This month's allocation. Drives the AREA of the tile. */
  budgeted: number;
  /** Spent so far this month. */
  actual: number;
  /** Where the month is heading, as a fraction of budget. Null when there is no basis yet. */
  projectedRatio: number | null;
  /** True while the month is too young to project from — drawn, but never coloured as a verdict. */
  tooEarly: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Half of this either side of every seam, per the dataviz skill's 2px surface gap between fills. */
const GAP = 1;

/** Pixel floors, lifted from the phone unchanged — what an 11px glyph occupies, plus a little air. */
const MIN_W_ICON = 15;
const MIN_H_ICON = 13;
/** Below these the spent figure is dropped and the tile carries its glyph alone. */
const MIN_W_AMOUNT = 60;
const MIN_H_AMOUNT = 42;
const AMOUNT_LINE = 14;

/**
 * The map's rendered size in CSS pixels, or `null` until it has been measured.
 *
 * ─── MEASURED SYNCHRONOUSLY FIRST, OBSERVED AFTER. Both, and the first one is load-bearing. ────
 *
 * This began as a ResizeObserver alone, on the reasoning that `observe()` delivers an initial
 * observation and there was therefore no need to measure by hand. Deployed, every tile came out
 * bare: sixteen correctly-sized, correctly-coloured squares with no glyph and no figure on any of
 * them. Dragging the window fixed all sixteen at once, which is the shape of the bug in one
 * gesture — the observer was alive and delivering CHANGES, and the initial delivery never arrived.
 *
 * It is not worth guessing why. An observer's first callback is a race against whatever else the
 * page is doing on load, and the failure mode when it is lost is silent and total: nothing errors,
 * nothing retries, and the widget simply has no labels for the rest of its life.
 *
 * So the first value comes from `getBoundingClientRect()` in the effect, where it cannot be lost,
 * and the observer's job is narrowed to what it is actually good at — reporting subsequent changes.
 * A zero reading is still ignored, and is now survivable: a box that is 0 when the effect runs and
 * non-zero once the stylesheet applies has CHANGED, which is exactly the case the observer catches.
 */
function useBoxSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Sub-pixel changes are dropped rather than re-rendering sixteen tiles mid-drag; `prev` is
    // returned unchanged so React bails out of the update entirely.
    const apply = (width: number, height: number) => {
      if (width < 1 || height < 1) return;
      setSize((prev) =>
        prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
          ? prev
          : { w: width, h: height }
      );
    };
    const rect = el.getBoundingClientRect();
    apply(rect.width, rect.height);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Every budgeted category this month as one tile: AREA is what it was given, COLOUR is where it is
 * heading.
 *
 * The two channels answer different halves of one question, and the pairing is the point. A list
 * sorted by overspend puts a small education line closing at 300% above a large grocery line
 * closing at 101%, and the reader has to hold both budgets in their head to know which actually
 * matters. Here the small red tile and the large amber one are visibly different amounts of money
 * in trouble, without a number being read.
 *
 * @param month 0-based, as every month index in this app is. Passed in rather than read from a
 *              clock here: the figures come from the page's as-of, and a second clock read could
 *              link to a different month than the one the tiles were computed for. The bubbles this
 *              replaced did read their own clock, which was a latent bug for one second a month.
 */
export default function CategoryHeatmap({ categories, month }: {
  categories: HeatmapCategory[];
  month: number;
}) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const size = useBoxSize(mapRef);

  /**
   * TWO CHANNELS INTO ONE LINE, because this surface has two kinds of input and the phone has one.
   *
   * `hover` is the pointer's, transient. `picked` is a click or a tap, sticky. A mouse sets the
   * first by moving, so the line follows the cursor across the map and the reader compares six
   * categories in one gesture — which is what a treemap is FOR, and what the phone had to spend a
   * whole tap on because it has no pointer.
   *
   * The click rule is then the phone's rule verbatim: a tile that is already the active one opens
   * its charges, any other tile becomes active. On a mouse the hover has already made the tile
   * under the cursor active, so a single click opens it — the bubbles' behaviour, unchanged. On
   * touch, nothing is active until something is tapped, so the first tap names it and the second
   * opens it. One rule, correct on both, with no `pointer: coarse` branch to get wrong.
   *
   * `pointerType` is checked rather than trusting `mouseenter`: iOS synthesises pointer events on
   * tap, and treating those as hover would make the first tap both name AND open a category.
   */
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const activeKey = hover ?? picked;

  // A 100x100 box: the output is percentages, so nothing here depends on the rendered width.
  const tiles = useMemo(
    () => layoutTreemap(categories.map((c) => ({ key: c.category, weight: c.budgeted })), 100, 100),
    [categories]
  );
  const byKey = useMemo(() => new Map(categories.map((c) => [c.category, c])), [categories]);

  if (tiles.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Where the month sits</p>
        <p className="text-sm text-slate-300 mt-4">No budgeted categories to plot this month.</p>
      </div>
    );
  }

  const active = activeKey ? byKey.get(activeKey) ?? null : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 mb-6">
      {/* Wraps rather than sitting on one line at every width. The caption is long, the title is
          not compressible, and a row that cannot wrap is what put a horizontal scrollbar on this
          page once already. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Where the month sits</p>
        <p className="text-[10px] text-slate-400">
          size = budget · icon = category · figure = spent · colour = spent or heading over
        </p>
      </div>

      {/* Reserved whether or not anything is active, so the map never shifts under the pointer that
          moved onto it. `min-h` rather than a fixed height: the line wraps on a narrow screen, and
          clipping the wrap would hide the overage — the half of it worth reading. */}
      <div className="min-h-[2.75rem] sm:min-h-[1.75rem] flex items-center mb-1">
        {active ? (
          /* THE LINE IS THE SECOND TARGET, and this is what makes the touch flow discoverable. A
             second tap on an unlabelled square is a hidden action that nothing announces. Putting
             the same navigation on a line that visibly invites it gives the gesture somewhere to be
             found — and gives a screen reader a real link rather than a control whose meaning
             silently changes between clicks. */
          <Link
            href={drillHref([active.category], month)}
            className="group text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span className="mr-1.5">{categoryIcon(active.category)}</span>
            <span className="font-medium text-slate-700">{active.category}</span>
            {' · '}{fmt(active.actual)} of {fmt(active.budgeted)}
            {active.actual > active.budgeted && (
              <span className="text-red-600 font-medium">
                {` · ${fmt(active.actual - active.budgeted)} over already`}
              </span>
            )}
            {active.projectedRatio !== null && !active.tooEarly && (
              <> · projects to close at {Math.round(active.projectedRatio * 100)}%</>
            )}
            {active.tooEarly && <> · too early to project</>}
            <span className="ml-1.5 text-slate-300 group-hover:text-slate-500">→</span>
          </Link>
        ) : (
          <span className="text-xs text-slate-300">
            Pick a category for its figures, again for its charges.
          </span>
        )}
      </div>

      {/* Height in CSS, per the note at the top: `width x 0.78` clamped to 220–320 on a phone — the
          phone's own rule — and a wide strip from `sm:` up, where 0.78 of 1000px would be a map
          taller than the screen it is read on. */}
      <div
        ref={mapRef}
        className="relative w-full aspect-[1/0.78] min-h-[220px] max-h-80 sm:aspect-auto sm:h-[380px] sm:max-h-none"
        role="group"
        aria-label="Categories sized by monthly budget, coloured by projected close"
      >
        {tiles.map((t) => {
          const cat = byKey.get(t.key)!;
          const state = bubbleState(cat);

          // Percent to pixels, only to answer what fits. `size` is null for the first frame.
          const w = size ? (t.w / 100) * size.w - GAP * 2 : 0;
          const h = size ? (t.h / 100) * size.h - GAP * 2 : 0;
          const showIcon = w >= MIN_W_ICON && h >= MIN_H_ICON;
          const showAmount = w >= MIN_W_AMOUNT && h >= MIN_H_AMOUNT;
          // Sized against the space LEFT AFTER the amount, not the whole tile: on a tile just over
          // the amount threshold the two would otherwise be laid out for more room than they have.
          const iconBox = Math.min(w, showAmount ? h - AMOUNT_LINE - 2 : h);
          const iconSize = Math.round(Math.min(34, Math.max(10, iconBox * 0.55)));

          const isActive = activeKey === t.key;

          // Over means spent PAST the line, not projected to pass it, so the overage is only ever
          // printed on a tile that has actually breached. The colour carries the forecast.
          const over = cat.actual - cat.budgeted;
          const second = over > 0 ? `+${fmt(over)}` : fmt(cat.actual);

          return (
            <button
              key={t.key}
              type="button"
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(t.key); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
              onFocus={() => setHover(t.key)}
              onBlur={() => setHover(null)}
              onClick={() => (isActive ? router.push(drillHref([t.key], month)) : setPicked(t.key))}
              aria-label={`${cat.category}, ${fmt(cat.actual)} of ${fmt(cat.budgeted)}, ${LABEL[state]}`}
              className="absolute rounded-[3px] overflow-hidden cursor-pointer focus:outline-none"
              style={{
                left: `calc(${t.x}% + ${GAP}px)`,
                top: `calc(${t.y}% + ${GAP}px)`,
                width: `calc(${t.w}% - ${GAP * 2}px)`,
                height: `calc(${t.h}% - ${GAP * 2}px)`,
                background: FILL[state],
              }}
            >
              {/* THE RING IS THE ONLY SELECTION CUE, and the dimming that used to accompany it is
                  gone. The bubbles faded every unhovered circle to 35%, which worked because
                  circles are sparse marks on a white ground. A treemap covers its whole box, so the
                  same rule washed out fifteen of sixteen tiles the instant the pointer arrived —
                  destroying the comparison the map exists to make, and taking white-on-green down
                  to an unreadable contrast on the way. Seen in a screenshot, not reasoned about.

                  The ring is drawn INSIDE the tile with an inset shadow rather than as a border,
                  because a border would resize it — and a tile whose size changes on hover is a
                  tile whose size stopped meaning the budget. It is what ties the line above the map
                  to a square on it, and it is enough on its own: it is painted in that tile's own
                  ink, so it is visible against all four fills. Same cue the phone uses. */}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-[3px] pointer-events-none"
                  style={{ boxShadow: `inset 0 0 0 2px ${INK[state]}` }}
                />
              )}
              {/* Glyph and figure are centred as one stack filling the tile, rather than flowing
                  from the top-left corner. A word had to start at a known edge to be read; a glyph
                  does not, and centring is what stops a 20px square looking like a mistake. */}
              <span className="absolute inset-0 flex flex-col items-center justify-center px-0.5 leading-none pointer-events-none">
                {showIcon && (
                  <span style={{ fontSize: iconSize, lineHeight: 1, color: INK[state] }}>
                    {categoryIcon(cat.category)}
                  </span>
                )}
                {showAmount && (
                  <span
                    className="font-mono whitespace-nowrap"
                    style={{ fontSize: 10, lineHeight: `${AMOUNT_LINE}px`, color: INK[state], opacity: 0.9 }}
                  >
                    {second}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Wraps. Four labels and four swatches fit one line on a desktop and do not at 358px, and a
          legend that overflows takes the whole page sideways with it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[10px] text-slate-400">
        {LEGEND.map(([state, label]) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: FILL[state] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

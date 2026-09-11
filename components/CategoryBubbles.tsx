'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { packCircles } from '@/lib/domain/bubblePack';
import { STATUS_HEX } from '@/lib/chartColors';

export interface BubbleCategory {
  category: string;
  /** This month's allocation. Drives the AREA of the circle. */
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

const NEUTRAL = '#cbd5e1'; // slate-300

// The same three tiers the budget grid and the KPI cards already use, so a category that reads
// amber here is amber there. Green is not "good", it is "projects to close inside its line" —
// a category at 12% of budget on day 11 is not virtuous, it is early, and the bubble says so by
// being the same green as one closing at 99%.
function bubbleColor(c: BubbleCategory): string {
  if (c.tooEarly || c.projectedRatio === null) return NEUTRAL;
  if (c.projectedRatio > 1.1) return STATUS_HEX.over;
  if (c.projectedRatio > 1.0) return STATUS_HEX.watch;
  return STATUS_HEX.good;
}

// Sized close to the width this actually renders at, so an SVG unit is roughly a CSS pixel and
// the font sizes below mean what they say. At 680 the box was scaled up by about 1.7 and every
// label came out two sizes larger than intended, overflowing circles that had looked fine in the
// maths.
const WIDTH = 1000;
const HEIGHT = 340;

/** Rough width of a character at a given font size, for fitting a label inside a circle. */
const charWidth = (fontSize: number) => fontSize * 0.55;

/** The longest prefix of `name` that fits across a circle of radius `r`, ellipsised if cut. */
function fitLabel(name: string, r: number, fontSize: number): string | null {
  // 1.7r, not 2r: a chord near the edge of a circle is shorter than its diameter, and text set to
  // the full width visibly breaches the curve at both ends.
  const maxChars = Math.floor((r * 1.7) / charWidth(fontSize));
  if (maxChars < 3) return null;
  return name.length <= maxChars ? name : `${name.slice(0, maxChars - 1)}…`;
}

/**
 * Every scored category this month as one circle: area is what it was given, colour is where it
 * is heading.
 *
 * The two channels answer different halves of one question, and the pairing is the point. A list
 * sorted by overspend puts a $75 education line that will close at 300% above a $1,900 grocery
 * line closing at 101%, and the reader has to hold both budgets in their head to know which
 * actually matters. Here the small red dot and the large amber one are visibly different amounts
 * of money in trouble, without a number being read.
 */
export default function CategoryBubbles({ categories }: { categories: BubbleCategory[] }) {
  const [hover, setHover] = useState<string | null>(null);

  const circles = useMemo(
    () => packCircles(
      categories.map((c) => ({ key: c.category, weight: c.budgeted })),
      WIDTH, HEIGHT,
      // Looser than the default: at 0.62 the circles crowded the box edge to edge and the picture
      // read as a solid mass rather than as distinct amounts.
      { fill: 0.5, padding: 6, minRadius: 12 }
    ),
    [categories]
  );
  const byKey = useMemo(
    () => new Map(categories.map((c) => [c.category, c])), [categories]
  );

  if (circles.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Where the month sits</p>
        <p className="text-sm text-slate-300 mt-4">No budgeted categories to plot this month.</p>
      </div>
    );
  }

  const active = hover ? byKey.get(hover) ?? null : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Where the month sits</p>
        <p className="text-[10px] text-slate-400">size = this month&apos;s budget · colour = projected close</p>
      </div>

      {/* One line, reserved whether or not anything is hovered, so the chart never jumps. */}
      <p className="text-xs text-slate-500 h-5 mb-1">
        {active ? (
          <>
            <span className="font-medium text-slate-700">{active.category}</span>
            {' · '}{fmt(active.actual)} of {fmt(active.budgeted)}
            {active.projectedRatio !== null && !active.tooEarly && (
              <> · projects to close at {Math.round(active.projectedRatio * 100)}%</>
            )}
            {active.tooEarly && <> · too early to project</>}
          </>
        ) : (
          <span className="text-slate-300">Hover a category. Click to open its transactions.</span>
        )}
      </p>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img"
           aria-label="Categories sized by monthly budget, coloured by projected close">
        {circles.map((c) => {
          const cat = byKey.get(c.key)!;
          const color = bubbleColor(cat);
          const dim = hover !== null && hover !== c.key;
          // A label only where it fits. Cramming 10px text into a 14px circle produces a smear
          // that is neither readable nor decorative; those categories are reached by hover.
          // Big circles carry their own label; small ones get it underneath rather than going
          // unnamed. An unlabelled RED bubble is the worst case the old rule produced — a finding
          // the reader can see is bad and cannot name without hovering.
          const nameSize = Math.min(15, Math.max(10, c.r / 3.2));
          const inside = fitLabel(cat.category, c.r, nameSize);
          const showAmount = c.r >= 46 && inside !== null;
          return (
            <Link key={c.key} href={`/transactions?category=${encodeURIComponent(c.key)}&month=${new Date().getMonth() + 1}&from=dashboard`}>
              <g
                onMouseEnter={() => setHover(c.key)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1, transition: 'opacity 120ms' }}
              >
                <circle cx={c.x} cy={c.y} r={c.r} fill={color} fillOpacity={0.85}
                        stroke={color} strokeWidth={hover === c.key ? 2 : 0} />
                {inside !== null ? (
                  <text x={c.x} y={showAmount ? c.y - 1 : c.y + nameSize / 3} textAnchor="middle"
                        fontSize={nameSize} fill="#fff" fontWeight={600}
                        style={{ pointerEvents: 'none' }}>
                    {inside}
                  </text>
                ) : (
                  <text x={c.x} y={c.y + c.r + 12} textAnchor="middle" fontSize={11}
                        fill="#64748b" fontWeight={500} style={{ pointerEvents: 'none' }}>
                    {cat.category.length > 16 ? `${cat.category.slice(0, 15)}…` : cat.category}
                  </text>
                )}
                {showAmount && (
                  <text x={c.x} y={c.y + nameSize + 3} textAnchor="middle" fontSize={11}
                        fill="#fff" fillOpacity={0.85} style={{ pointerEvents: 'none' }}>
                    {fmt(cat.budgeted)}
                  </text>
                )}
              </g>
            </Link>
          );
        })}
      </svg>

      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
        {[
          { c: STATUS_HEX.good, l: 'projects inside budget' },
          { c: STATUS_HEX.watch, l: '100–110%' },
          { c: STATUS_HEX.over, l: 'over 110%' },
          { c: NEUTRAL, l: 'too early to call' },
        ].map(({ c, l }) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

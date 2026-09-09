'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { BreachFinding } from '@/lib/domain/adherence';
import { MONTHS, drillHref } from '@/lib/drilldown';

const fmtCents = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/** Categories shown before the list asks to be opened. */
const VISIBLE = 5;

interface Group {
  category: string;
  /** This category's breach months, calendar order. */
  months: BreachFinding[];
  /** Overspend against a real budget line — months budgeted above $0. */
  over: number;
  /** Spend recorded against months with no budget at all. Not overspend; see below. */
  unbudgeted: number;
  unbudgetedMonths: number;
}

/**
 * The unscored breach list.
 *
 * A breach is per category per month, and the detector emits one for every month a tracked line
 * drew more than it was given, which is right: §5's "tracked and reported, never scored" says
 * tracked, not invisible. But the reader's unit is the CATEGORY. Rendered one row per finding this
 * panel ran to 47 rows on real data — eleven categories, each appearing up to seven times, in a
 * third-width column beside two panels that were usually empty. Nothing in it could be acted on
 * either: these are the lines where behaviour is by definition not the variable, so a list long
 * enough to need scrolling was a list nobody read.
 *
 * So the month dimension collapses into the category, worst first, and only the first few
 * categories are shown. The months are still there, one click down, still linking to their own
 * drilldown — a reader who wants to know WHICH August is asking a second question, and this panel
 * answers the first one.
 */
export default function UnscoredBreaches({
  findings,
  monthsElapsed,
}: {
  findings: BreachFinding[];
  /** Months of the year with data behind them, so "7 months over" can say what of. */
  monthsElapsed: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const byCategory = new Map<string, Group>();
  for (const f of findings) {
    let g = byCategory.get(f.category);
    if (!g) {
      g = { category: f.category, months: [], over: 0, unbudgeted: 0, unbudgetedMonths: 0 };
      byCategory.set(f.category, g);
    }
    g.months.push(f);
    // A $0-budget month is not an overspend, however large the number. The detector emits it as a
    // breach because spend against no budget is a real finding, but printing "over by $13,022.41"
    // for a line that was never given a dollar states a discipline failure where the fact is a
    // missing budget. Kept in a separate total, and never added to the red one.
    if (f.budgeted > 0) g.over += f.variance;
    else { g.unbudgeted += f.actual; g.unbudgetedMonths += 1; }
  }

  const groups = [...byCategory.values()]
    .map((g) => ({ ...g, months: [...g.months].sort((a, b) => a.month - b.month) }))
    .sort((a, b) => (b.over + b.unbudgeted) - (a.over + a.unbudgeted));

  const shown = showAll ? groups : groups.slice(0, VISIBLE);
  const totalOver = groups.reduce((sum, g) => sum + g.over, 0);
  const totalUnbudgeted = groups.reduce((sum, g) => sum + g.unbudgeted, 0);

  return (
    <>
      {/* Capped, though the panel beneath it is often the full page width: a row whose name sits
          at the left margin and whose figure sits a thousand pixels away is two facts the eye has
          to carry between, and the neighbouring panels read at about this measure. */}
      <p className="max-w-3xl text-xs text-slate-400 -mt-1 mb-3">
        {groups.length} {groups.length === 1 ? 'category' : 'categories'} where behaviour is not the
        variable — reported, never scored.{' '}
        {totalOver > 0 && <span className="text-slate-500">{fmtCents(totalOver)} over budget.</span>}{' '}
        {totalUnbudgeted > 0 && (
          <span className="text-slate-500">{fmtCents(totalUnbudgeted)} against no budget.</span>
        )}
      </p>

      <ul className="max-w-3xl">
        {shown.map((g) => {
          const expanded = open === g.category;
          const overMonths = g.months.length - g.unbudgetedMonths;
          return (
            <li key={g.category} className="border-b border-slate-100 last:border-0">
              <button
                onClick={() => setOpen(expanded ? null : g.category)}
                aria-expanded={expanded}
                className="w-full -mx-2 px-2 rounded-lg flex items-baseline justify-between gap-3 py-2 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-800 truncate">{g.category}</span>
                    <ChevronDown
                      size={12}
                      className={`shrink-0 text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                  <span className="block text-xs text-slate-400">
                    {overMonths > 0 && `${overMonths} of ${monthsElapsed} months over`}
                    {overMonths > 0 && g.unbudgetedMonths > 0 && ' · '}
                    {g.unbudgetedMonths > 0 && `${g.unbudgetedMonths} with no budget set`}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  {g.over > 0 && (
                    <span className="block text-sm font-mono text-red-500">over by {fmtCents(g.over)}</span>
                  )}
                  {g.unbudgeted > 0 && (
                    <span className="block text-xs font-mono text-slate-500">
                      {fmtCents(g.unbudgeted)} unbudgeted
                    </span>
                  )}
                </span>
              </button>

              {expanded && (
                <ul className="pb-2">
                  {g.months.map((f) => (
                    <li key={`${f.category}-${f.month}`}>
                      <Link
                        href={drillHref([f.category], f.month)}
                        className="group -mx-2 px-2 rounded-lg flex items-baseline justify-between gap-3 py-1 text-xs hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-slate-500 group-hover:underline">{MONTHS[f.month]}</span>
                        <span className="font-mono text-slate-500">
                          {fmtCents(f.actual)}
                          <span className="mx-1 font-sans text-[10px] font-medium uppercase tracking-wider text-slate-400">
                            {f.budgeted > 0 ? 'of' : 'no budget'}
                          </span>
                          {f.budgeted > 0 && <span className="text-slate-400">{fmtCents(f.budgeted)}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {groups.length > VISIBLE && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          {showAll ? 'Show fewer' : `Show all ${groups.length} categories`}
        </button>
      )}
    </>
  );
}

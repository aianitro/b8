import Link from 'next/link';
import { STATUS_HEX } from '@/lib/chartColors';

export interface BudgetTrackRow {
  category: string;
  /** The whole year's allocation. */
  budget: number;
  /** Spent year to date, net of refunds. */
  spent: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/**
 * Every category's year, as a track sized by its budget and filled by its spend.
 *
 * Replaces two widgets that each held half the answer. The donut said how big a category is and
 * nothing about whether it is on plan; the budget-vs-actual bars said whether it is on plan and
 * drew a $378 education line the same length as a $29,000 one. Here the TRACK WIDTH is the budget,
 * so relative size is back, and the FILL is the spend within it — which means the filled length is
 * comparable across rows as absolute dollars, not just as a percentage.
 *
 * The tick is the part neither had. At 70% through the year, 66% used is comfortable and 99% is
 * not, and without a pace mark every bar is just a number the reader has to date themselves.
 */
export default function BudgetTracks({ rows, yearElapsed }: {
  rows: BudgetTrackRow[]; yearElapsed: number;
}) {
  const usable = rows.filter((r) => r.budget > 0 || r.spent > 0);
  if (usable.length === 0) return null;

  // Scale on the largest BUDGET, not the largest spend: the track is the allocation, and an
  // over-budget row has to have somewhere to overflow into.
  const maxBudget = Math.max(...usable.map((r) => Math.max(r.budget, r.spent)), 1);
  const ordered = [...usable].sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));
  const pacePct = Math.round(yearElapsed * 1000) / 10;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">The year by category</p>
        <p className="text-[10px] text-slate-400">
          track = annual budget · fill = spent · tick = {pacePct}% of the year gone
        </p>
      </div>

      <div className="space-y-1">
        {ordered.map((r) => {
          const used = r.budget > 0 ? r.spent / r.budget : 1;
          const over = r.spent > r.budget;
          // Over budget is a FACT and red; ahead of the calendar is amber; the rest is green. Same
          // fact-then-forecast split the bubbles use, one horizon up.
          const color = over ? STATUS_HEX.over : used > yearElapsed ? STATUS_HEX.watch : STATUS_HEX.good;
          const trackPct = (Math.max(r.budget, r.spent) / maxBudget) * 100;
          // Fill is measured against the TRACK, which is itself the larger of budget and spend, so
          // an overspent row fills to the end and its track already extends past its budget mark.
          const fillPct = Math.max(r.budget, r.spent) > 0
            ? (r.spent / Math.max(r.budget, r.spent)) * 100
            : 0;
          const budgetMarkPct = over ? (r.budget / Math.max(r.budget, r.spent)) * 100 : null;

          return (
            <Link
              key={r.category}
              href={`/transactions?category=${encodeURIComponent(r.category)}&from=dashboard`}
              className="flex items-center gap-3 py-1 rounded-lg hover:bg-slate-50 transition-colors"
              title={`${r.category}: ${fmt(r.spent)} of ${fmt(r.budget)} — ${Math.round(used * 100)}% used, ${pacePct}% of the year gone`}
            >
              <span className="w-32 shrink-0 text-xs text-slate-600 truncate">{r.category}</span>

              <span className="flex-1 min-w-0">
                <span className="block relative h-3.5 rounded-sm bg-slate-100/70" style={{ width: `${trackPct}%` }}>
                  <span className="absolute inset-y-0 left-0 rounded-sm"
                        style={{ width: `${fillPct}%`, background: color, opacity: 0.85 }} />
                  {/* Where the budget ran out, shown only when the fill has gone past it. */}
                  {budgetMarkPct !== null && (
                    <span className="absolute inset-y-0 w-px bg-white/80" style={{ left: `${budgetMarkPct}%` }} />
                  )}
                  {/* The calendar, drawn on the BUDGET rather than the track, so it always means
                      "this share of the allocation" and does not slide when a row overspends. */}
                  <span className="absolute -inset-y-0.5 w-px bg-slate-400/70"
                        style={{ left: `${yearElapsed * (r.budget / Math.max(r.budget, r.spent)) * 100}%` }} />
                </span>
              </span>

              <span className="w-40 shrink-0 text-right text-[11px] font-mono text-slate-500">
                {fmt(r.spent)}<span className="text-slate-300">/{fmt(r.budget)}</span>
              </span>
              <span className={`w-12 shrink-0 text-right text-[11px] font-mono ${
                over ? 'text-red-600 font-semibold' : used > yearElapsed ? 'text-amber-600' : 'text-slate-400'
              }`}>
                {Math.round(used * 100)}%
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

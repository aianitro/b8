import Link from 'next/link';
import { monthShape, shapeLabel, type MonthShapeKind } from '@/lib/domain/monthShape';
import { STATUS_HEX } from '@/lib/chartColors';

export interface ShapeRow {
  category: string;
  budgeted: number;
  daily: number[];
  projectedRatio: number | null;
  tooEarly: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const NEUTRAL = '#94a3b8';

function lineColor(r: ShapeRow): string {
  if (r.tooEarly || r.projectedRatio === null) return NEUTRAL;
  if (r.projectedRatio > 1.1) return STATUS_HEX.over;
  if (r.projectedRatio > 1.0) return STATUS_HEX.watch;
  return STATUS_HEX.good;
}

// The shape caption is the point of this widget, so it is the only thing besides the line that is
// allowed to be emphatic. `front-loaded` is the one that changes a decision: a category at 90% of
// budget that spent it on the 2nd needs no action, and one drifting there needs one today.
const KIND_TONE: Record<MonthShapeKind, string> = {
  'front-loaded': 'text-slate-500',
  accelerating: 'text-amber-600 font-medium',
  steady: 'text-slate-400',
  refunded: 'text-emerald-600',
  'too-early': 'text-slate-300',
};

const W = 120;
const H = 34;

function Shape({ row, daysInMonth, month }: { row: ShapeRow; daysInMonth: number; month: number }) {
  const shape = monthShape(row.daily, row.budgeted, daysInMonth);
  const color = lineColor(row);
  const spent = shape.cumulative[shape.cumulative.length - 1] ?? 0;

  // Both lines share one scale, or the comparison they exist to make is a lie. The ceiling is the
  // larger of the month's full budget and what has actually been spent — so an over-budget
  // category visibly breaches its plan line rather than being rescaled back under it.
  const ceiling = Math.max(row.budgeted, spent, 1);
  const x = (i: number) => (i / Math.max(1, daysInMonth - 1)) * W;
  // Clamped, because a cumulative series that dips below zero would otherwise be drawn outside
  // the viewBox and silently clipped — a line that vanishes rather than one that reads as low.
  const y = (v: number) => H - (Math.max(0, Math.min(v, ceiling)) / ceiling) * H;

  const path = (series: number[]) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <Link
      href={`/transactions?category=${encodeURIComponent(row.category)}&month=${month}&from=dashboard`}
      className="block rounded-lg p-2 -m-2 hover:bg-slate-50 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700 truncate">{row.category}</span>
        {/* A net-negative month reads as money BACK, not as negative spending. "−$404 / $50" is
            parsed as a deficit by anyone moving at dashboard speed. */}
        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          {spent < 0
            ? <span className="text-emerald-600">+{fmt(-spent)} back</span>
            : <>{fmt(spent)}<span className="text-slate-300">/{fmt(row.budgeted)}</span></>}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-1" preserveAspectRatio="none" aria-hidden="true">
        {/* The plan, drawn to the END of the month so the gap at the right edge is the month still
            to come rather than a rescaling artefact. */}
        <path
          d={`M0,${y(0).toFixed(1)} L${W},${y(row.budgeted).toFixed(1)}`}
          stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 2" fill="none" vectorEffect="non-scaling-stroke"
        />
        <path d={path(shape.cumulative)} stroke={color} strokeWidth={1.75} fill="none"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className={`text-[10px] mt-0.5 ${KIND_TONE[shape.kind]}`}>{shapeLabel(shape.kind)}</p>
    </Link>
  );
}

/**
 * One small chart per category: cumulative spend against the straight-line plan.
 *
 * The dashboard already says how much and how far over. What it could not say is WHEN — and two
 * categories at the same percentage with opposite shapes need opposite responses. A flat line that
 * jumped on the 2nd is a decision already made and nothing to do about today; a line climbing
 * steadily into its plan is the one still worth interrupting.
 */
export default function MonthShapes({ rows, daysInMonth, month, staleFeed }: {
  rows: ShapeRow[]; daysInMonth: number; month: number; staleFeed: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">The shape of the month</p>
        <p className="text-[10px] text-slate-400">solid = spent so far · dotted = even pace to month end</p>
      </div>

      {/* Every caption here is a claim about the last few days, and a stale feed makes all of them
          say "quiet" for a reason that has nothing to do with spending. Said once, above the grid,
          rather than repeated on each tile — the qualifier applies to the whole reading. */}
      {staleFeed && (
        <p className="text-[11px] text-amber-600 -mt-2 mb-3">
          A bank feed is behind, so recent days may be incomplete — read &ldquo;quiet lately&rdquo; with that in mind.
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
        {rows.map((r) => <Shape key={r.category} row={r} daysInMonth={daysInMonth} month={month} />)}
      </div>
    </div>
  );
}

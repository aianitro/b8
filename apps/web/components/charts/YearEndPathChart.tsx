'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { STATUS_HEX } from '@/lib/chartColors';
import type { YearEndPathPoint } from '@/lib/domain/yearEndMoves';
import { dayLabel } from '@/lib/domain/netWorthPeriods';

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(v));
const signed = (n: number) => `${Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '±'}${fmt(n)}`;
const tone = (n: number) => (Math.round(n) > 0 ? 'text-green-600' : Math.round(n) < 0 ? 'text-red-600' : 'text-slate-400');

/** A spending slip, by `holdStreak`'s rule: a dollar or more, so a rounding cent marks nothing. */
const slipped = (p: YearEndPathPoint) => (p.move?.spending ?? 0) <= -1;

const PARTS = [
  { key: 'spending', label: 'Spending' },
  { key: 'budget', label: 'Budget edits' },
  { key: 'past', label: 'Past months' },
  { key: 'closed', label: 'Month closed' },
] as const;

/** The step into this point, in the four parts the budget page's table uses. Zero parts are left out. */
function PathTooltip({ active, payload }: { active?: boolean; payload?: { payload: YearEndPathPoint }[] }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const parts = p.move ? PARTS.filter((x) => Math.round(p.move![x.key]) !== 0) : [];
  return (
    <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-slate-700 mb-1">{dayLabel(p.date)}</p>
      <p className="flex justify-between gap-4"><span className="text-slate-500">Year-end P/L</span><span className="font-mono text-slate-800">{p.projected < 0 ? '−' : '+'}{fmt(p.projected)}</span></p>
      {p.move && (
        <p className="flex justify-between gap-4"><span className="text-slate-500">Moved</span><span className={`font-mono ${tone(p.move.total)}`}>{signed(p.move.total)}</span></p>
      )}
      {parts.map((x) => (
        <p key={x.key} className="flex justify-between gap-4 pl-2 text-[11px]"><span className="text-slate-400">{x.label}</span><span className={`font-mono ${tone(p.move![x.key])}`}>{signed(p.move![x.key])}</span></p>
      ))}
    </div>
  );
}

/**
 * Where the year was projected to close, morning by morning — the dynamics behind the dashboard's
 * Projected P/L card and its "since yesterday" line. Each point is a snapshot (lib/yearEndSnapshots.ts),
 * the last one live, so the line ends on the figure the card shows.
 *
 * The axis is NOT anchored at zero: a year-end in the tens of thousands moving by tens a day would
 * draw flat. The change over the whole path is printed above it so the slope is read against a
 * figure, as on the net worth chart; the break-even line is drawn when it falls inside the range.
 *
 * A red dot marks a day spending moved the year-end down — the same rule that breaks the streak —
 * so a drop with no dot was the calendar or a budget edit, not a purchase.
 */
export default function YearEndPathChart({ data }: { data: YearEndPathPoint[] }) {
  const first = data[0], last = data[data.length - 1];
  const change = data.length >= 2 ? last.projected - first.projected : 0;
  const line = last && last.projected < 0 ? STATUS_HEX.over : STATUS_HEX.good;
  const values = data.map((d) => d.projected);
  // Zero with no points, so the ticks below stay finite on the empty state.
  const lo = values.length ? Math.min(...values) : 0, hi = values.length ? Math.max(...values) : 0;
  const range = hi - lo;
  // Padded and ticked by hand: a level week is a flat line, which Recharts' 'auto' labels with one
  // figure five times over, and a padded domain left to Recharts ticks at odd values. Four steps of
  // a round size (1, 2 or 5 × a power of ten), and never finer than a one-decimal `k` label can show.
  const pad = Math.max(range * 0.1, 250);
  const raw = (range + 2 * pad) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(100, [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw)!);
  const ticks: number[] = [];
  let v = Math.floor((lo - pad) / step) * step;
  do { ticks.push(v); v += step; } while (ticks[ticks.length - 1] < hi + pad);
  // Labels at a precision the step can show, as on the net worth chart.
  const tick = (v: number) => `${v < 0 ? '−' : ''}$${(Math.abs(v) / 1000).toFixed(step < 1_000 ? 1 : 0)}k`;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-md:px-4 mt-6 sm:mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Projected P/L over time</p>
        {data.length >= 2 && (
          <p className="text-xs text-slate-500">
            <span className={`font-mono font-semibold ${tone(change)}`}>{signed(change)}</span> since {dayLabel(first.date)}
          </p>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mb-4">
        Where the year closes if the rest goes to plan, as it stood each morning · red dot: spending moved it down that day
      </p>
      {/* A line needs two points; one is an invisible dot on a collapsed axis. */}
      {data.length < 2 ? (
        <div className="h-[200px] flex items-center justify-center text-center">
          <p className="text-xs text-slate-400 max-w-sm">
            {data.length === 0
              ? 'No snapshots yet — the daily job records one each morning.'
              : 'First snapshot recorded. The line starts from tomorrow morning.'}
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#94a3b8' }}
                   axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={tick}
                   axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<PathTooltip />} />
            {/* Break-even — discarded by Recharts when it lies outside the auto range. */}
            <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
            <Line dataKey="projected" name="Projected P/L" type="linear" stroke={line} strokeWidth={2.5}
                  isAnimationActive={false} activeDot={{ r: 4, fill: line }}
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: YearEndPathPoint }) => {
                    const { cx, cy, index, payload } = props;
                    if (cx == null || cy == null || !payload || !slipped(payload)) return <g key={index} />;
                    return <circle key={index} cx={cx} cy={cy} r={3.5} fill={STATUS_HEX.over} stroke="#fff" strokeWidth={1} />;
                  }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      {data.length >= 2 && <p className="text-[10px] text-right mt-1 text-slate-400">Operational · last point is live</p>}
    </div>
  );
}

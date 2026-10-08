'use client';

import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { LANDSCAPE_HEX, STATUS_HEX } from '@/lib/chartColors';
import { lastPerPeriod, periodLabel, type NetWorthPeriod } from '@/lib/domain/netWorthPeriods';

export interface NetWorthTrendPoint {
  /** `YYYY-MM-DD`, the snapshot's calendar date. */
  iso: string;
  operational: number;
  capitalFinancial: number;
  realEstateEquity: number;
  total: number;
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

const PERIODS: { key: NetWorthPeriod; label: string }[] = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

type SeriesKey = 'total' | 'operational' | 'capitalFinancial' | 'realEstateEquity';

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'total', label: 'Total', color: '#1e293b' },
  { key: 'operational', label: 'Operational', color: LANDSCAPE_HEX.operational },
  { key: 'capitalFinancial', label: 'Capital', color: LANDSCAPE_HEX.capital },
  { key: 'realEstateEquity', label: 'Real estate', color: STATUS_HEX.good },
];

/**
 * Axis ticks at a precision the range can show: `$133k` five times over says nothing. Millions
 * read as `$1.49M` rather than `$1485k`, three significant figures either way.
 */
function tickFormatter(range: number) {
  return (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(range < 50_000 ? 3 : 2)}M`;
    return `$${(v / 1000).toFixed(range < 5_000 ? 2 : range < 50_000 ? 1 : 0)}k`;
  };
}

// Plots recorded snapshots, not a recomputation. Each point is what net worth actually was on
// that date given how accounts were classified then — which is the reason step 7 stored the
// figures rather than deriving them on read.
//
// ONE SERIES AT A TIME, ON ITS OWN SCALE — the owner's call. All four used to share one axis, and
// a shared axis is set by the largest: operational cash moving by thousands drew as a flat line
// under a total in the millions, so the chart answered "how is the total doing" and nothing else.
// A tab per series lets each fill the plot. The axis no longer starts at zero, which magnifies
// small moves — so the change over the period is printed beside the tabs, in dollars, and the
// chart's slope is read against a figure rather than on its own.
//
// WEEKLY, MONTHLY OR YEARLY — the owner's call, monthly first. A snapshot is taken daily, and a
// year of daily points is a line too dense to read on a phone; each period is drawn by its CLOSING
// snapshot — see `lib/domain/netWorthPeriods.ts` for why the close and not an average.
export default function NetWorthTrendChart({ data: snapshots }: { data: NetWorthTrendPoint[] }) {
  const [selected, setSelected] = useState<SeriesKey>('total');
  // Monthly unless that leaves a single point — under a month of history would otherwise open on an
  // empty chart. Decided once, on mount; a period the owner picks afterwards is theirs.
  const [period, setPeriod] = useState<NetWorthPeriod>(() =>
    lastPerPeriod(snapshots, 'month').length >= 2 ? 'month' : 'week');
  const closing = lastPerPeriod(snapshots, period);
  const spansYears = closing.length > 0 && closing[0].iso.slice(0, 4) !== closing[closing.length - 1].iso.slice(0, 4);
  const data = closing.map((p) => ({ ...p, date: periodLabel(p.iso, period, spansYears) }));
  const series = SERIES.find((x) => x.key === selected) ?? SERIES[0];
  const values = data.map((d) => d[selected]);
  const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const change = values.length >= 2 ? values[values.length - 1] - values[0] : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-md:px-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Net worth over time</p>
        {snapshots.length > 0 && (
          <div role="tablist" aria-label="Period" className="flex items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
            {PERIODS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={x.key === period}
                onClick={() => setPeriod(x.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  x.key === period ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* THE SERIES CHIPS SIT OUTSIDE THE EMPTY STATE. They lived inside the chart branch, so a period
          that left one point — Monthly on a single month of history — took the chips away with the
          line, and switching back did not explain where they had gone. */}
      {snapshots.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
          <div role="tablist" className="flex flex-wrap gap-1">
            {SERIES.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={x.key === selected}
                onClick={() => setSelected(x.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  x.key === selected ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: x.color }} />
                {x.label}
              </button>
            ))}
          </div>
          {data.length >= 2 && (
            <p className="text-xs text-slate-500">
              <span className={`font-mono font-semibold ${change < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {change < 0 ? '−' : '+'}{fmt(Math.abs(change))}
              </span>{' '}
              {/* The exact date, whatever the period: "since Jan" would leave which day unsaid. */}
              since {periodLabel(data[0].iso, 'week', false)}
            </p>
          )}
        </div>
      )}

      {/* A line needs two points. One snapshot renders as an invisible dot on a collapsed axis,
          which reads as a broken chart rather than as "history starts here". With periods there is a
          second way to get here — a year of history is one yearly point — so that case says so. */}
      {data.length < 2 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-mono font-semibold text-slate-800">
            {data.length === 1 ? fmt(data[0][selected]) : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-sm">
            {snapshots.length === 0
              ? 'No snapshots yet — the daily sync records one after each run.'
              : snapshots.length === 1
                ? 'First snapshot recorded. The daily sync adds one per day, so a trend appears from tomorrow.'
                : `All ${snapshots.length} snapshots fall in one ${period}. Pick a shorter period to see the trend.`}
          </p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={tickFormatter(range)}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                formatter={(v) => [fmt(Number(v)), series.label]}
                contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
              />
              <Line dataKey={selected} name={series.label} type="monotone" stroke={series.color}
                    strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: series.color }}
                    isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

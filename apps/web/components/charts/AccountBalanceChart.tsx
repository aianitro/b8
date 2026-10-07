'use client';

import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LANDSCAPE_HEX } from '@/lib/chartColors';
import type { BalancePoint } from '@/lib/domain/balanceSeries';

const RANGES = [
  { key: '7d',    label: 'Last 7 days' },
  { key: '30d',   label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: '12m',   label: 'Last 12 months' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const fmtAxis = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Parsed by hand — `new Date('YYYY-MM-DD')` is UTC midnight, a day early anywhere west of it. */
function label(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

/**
 * The points a range covers, opening point included. "This month" opens on the close of the last
 * day of the previous month, so its change reads as month-to-date rather than from the 1st's close.
 * Every slice is taken from one twelve-month series the server built, so switching is instant.
 */
function slice(points: BalancePoint[], range: RangeKey): BalancePoint[] {
  if (range === '12m') return points;
  if (range === 'month') {
    const monthStart = points[points.length - 1].date.slice(0, 8) + '01';
    const i = points.findIndex((p) => p.date >= monthStart);
    return points.slice(Math.max(0, i - 1));
  }
  return points.slice(-(range === '7d' ? 8 : 31));
}

/**
 * Four-ish round ticks spanning the data. Recharts' own `auto` domain lands on values like −2.3K
 * when the range is narrow and offset from zero, which reads as noise on a money axis.
 */
function niceTicks(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

export default function AccountBalanceChart({ points, landscape, title }: {
  points: BalancePoint[];
  landscape: 'operational' | 'capital';
  title: string;
}) {
  const [range, setRange] = useState<RangeKey>('30d');
  // Stripped to word characters: useId's punctuation is legal in an id but not reliably inside
  // the `url(#…)` that references it.
  const gradientId = `balance-fill-${useId().replace(/\W/g, '')}`;
  const color = LANDSCAPE_HEX[landscape];

  const shown = points.length > 0 ? slice(points, range) : [];
  const current = shown.at(-1)?.balance ?? null;
  const change = shown.length > 1 ? shown[shown.length - 1].balance - shown[0].balance : null;
  const pct = change !== null && shown[0].balance !== 0 ? (change / Math.abs(shown[0].balance)) * 100 : null;
  const ticks = shown.length > 1 ? niceTicks(shown.map((p) => p.balance)) : [];
  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
          <p className={`font-mono font-semibold text-2xl sm:text-3xl mt-1 ${current !== null && current < 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {current !== null ? fmt(current) : '—'}
          </p>
          {change !== null && (
            <p className="text-sm mt-1">
              <span className={`font-mono font-medium ${change > 0 ? 'text-emerald-600' : change < 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                {change > 0 ? '+' : change < 0 ? '−' : ''}{fmt(Math.abs(change))}
                {pct !== null && ` (${Math.abs(pct).toFixed(1)}%)`}
              </span>
              <span className="text-slate-400"> {rangeLabel}</span>
            </p>
          )}
        </div>
        {/* A NATIVE SELECT, not a custom menu: on a phone it opens the platform's own picker, which
            is the one control here a thumb already knows how to use. `text-base` below `sm` stops
            iOS zooming the page when it takes focus — it does that to anything under 16px. */}
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          aria-label="Chart range"
          className="shrink-0 text-base sm:text-sm border border-slate-200 rounded-lg pl-3 pr-8 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
        >
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </div>

      {shown.length < 2 ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-slate-400 text-center">
          {points.length === 0 ? 'No balance history yet.' : 'Not enough history in this range to draw a line.'}
        </div>
      ) : (
        <div className="mt-4 -mx-2 sm:mx-0">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={shown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={(d: string) => (range === '12m' ? `${MONTHS[Number(d.slice(5, 7)) - 1]} '${d.slice(2, 4)}` : label(d, false))}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[ticks[0], ticks[ticks.length - 1]]}
                ticks={ticks}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={fmtAxis}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                labelFormatter={(d) => label(String(d), true)}
                formatter={(v) => [fmt(Number(v)), 'Balance']}
                contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                // Fill DOWN to the axis floor, not to zero. Recharts' default base is 0, which for
                // a balance below zero — every credit card — sits above the line and shades the
                // wrong side of it.
                baseValue={ticks[0]}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: color }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

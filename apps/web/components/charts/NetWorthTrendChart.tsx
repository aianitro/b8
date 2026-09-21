'use client';

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { LANDSCAPE_HEX, STATUS_HEX } from '@/lib/chartColors';

export interface NetWorthTrendPoint {
  date: string;
  operational: number;
  capitalFinancial: number;
  realEstateEquity: number;
  total: number;
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

// Plots recorded snapshots, not a recomputation. Each point is what net worth actually was on
// that date given how accounts were classified then — which is the reason step 7 stored the
// figures rather than deriving them on read.
export default function NetWorthTrendChart({ data }: { data: NetWorthTrendPoint[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Net worth over time</p>
        {data.length > 0 && (
          <p className="text-[10px] text-slate-400">
            {data.length} snapshot{data.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {/* A line needs two points. One snapshot renders as an invisible dot on a collapsed axis,
          which reads as a broken chart rather than as "history starts here". */}
      {data.length < 2 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-mono font-semibold text-slate-800">
            {data.length === 1 ? fmt(data[0].total) : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-sm">
            {data.length === 1
              ? 'First snapshot recorded. The daily sync adds one per day, so a trend appears from tomorrow.'
              : 'No snapshots yet — the daily sync records one after each run.'}
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(v, name) => [fmt(Number(v)), name]}
              contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#64748b' }} />
            <ReferenceLine y={0} stroke="#e2e8f0" />
            <Line dataKey="operational" name="Operational" type="monotone" stroke={LANDSCAPE_HEX.operational} strokeWidth={1.5} dot={{ r: 2 }} />
            <Line dataKey="capitalFinancial" name="Capital" type="monotone" stroke={LANDSCAPE_HEX.capital} strokeWidth={1.5} dot={{ r: 2 }} />
            <Line dataKey="realEstateEquity" name="Real estate" type="monotone" stroke={STATUS_HEX.good} strokeWidth={1.5} dot={{ r: 2 }} />
            <Line dataKey="total" name="Total" type="monotone" stroke="#1e293b" strokeWidth={2.5} dot={{ r: 3, fill: '#1e293b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

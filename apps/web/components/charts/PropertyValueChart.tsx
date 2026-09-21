'use client';

import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { LANDSCAPE_HEX, STATUS_HEX } from '@/lib/chartColors';

export interface PropertyValuePoint {
  date: string;      // display label
  value: number;
  mortgage: number | null;
  equity: number | null;
}

const fmt = (v: number | undefined | null) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

export default function PropertyValueChart({ data }: { data: PropertyValuePoint[] }) {
  const hasMortgage = data.some((d) => d.mortgage !== null);

  return (
    <div>

      {/* A line needs two points to be a line. Recharts renders a single-point series as an
          almost-invisible dot on a collapsed axis, which reads as "the chart is broken" rather
          than "there is one reading" — so say it in words instead. */}
      {data.length < 2 ? (
        <div className="h-[200px] flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-mono font-semibold text-slate-800">
            {data.length === 1 ? fmt(data[0].value) : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-xs">
            {data.length === 1
              ? 'One reading so far. Add another valuation to see the trend.'
              : 'No valuations recorded yet.'}
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
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

            {/* Equity drawn as the filled region under the value line rather than its own line:
                equity IS the gap between value and mortgage, so shading it makes the
                relationship readable at a glance instead of asking the eye to subtract. */}
            {hasMortgage && (
              <Area
                dataKey="equity" name="Equity" type="monotone"
                stroke="none" fill={LANDSCAPE_HEX.capital} fillOpacity={0.12}
              />
            )}
            <Line dataKey="value" name="Market value" type="monotone" stroke={LANDSCAPE_HEX.capital} strokeWidth={2.5} dot={{ r: 3 }} />
            {hasMortgage && (
              <Line dataKey="mortgage" name="Mortgage" type="monotone" stroke={STATUS_HEX.over} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2.5 }} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

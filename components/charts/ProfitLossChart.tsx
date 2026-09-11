'use client';

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { STATUS_HEX } from '@/lib/chartColors';

export interface ProfitLossPoint {
  month: string;
  /** Cumulative P/L for settled months; null once the year turns to forecast. */
  pl: number | null;
  /** The same series from the last settled month onward, drawn dashed. */
  plProjected: number | null;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

/**
 * Income less spending, accumulated from January and carried to December.
 *
 * This chart used to also plot the operational account BALANCE, and the two were routinely read as
 * one thing. They are not: a balance starts at whatever cash was in the accounts and moves on every
 * transfer — 220 of them worth $312,357 this year — while P/L starts at zero and moves only when
 * money is earned or spent. Moving $5,000 between your own accounts shifts one line and not the
 * other, which made the pair read as a contradiction rather than as two answers. The balance line
 * is gone; /balances is where that question belongs.
 */
export default function ProfitLossChart({ data }: { data: ProfitLossPoint[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Profit &amp; Loss</p>
      <p className="text-[11px] text-slate-400 mb-4">
        Operational income less spending, cumulative from January · dashed once forecast
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#64748b' }} />
          {/* Break-even. On a P/L the zero line is the whole verdict — above it the year is up,
              below it the year is down — so it is drawn darker than the grid behind it. */}
          <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
          {/* Two series, because Recharts cannot change a line's dash mid-path. They share the last
              settled month so the join is continuous rather than leaving a gap at exactly the
              boundary between what happened and what is expected. */}
          <Line dataKey="pl" name="Actual" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          <Line dataKey="plProjected" name="Projected" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2.5 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

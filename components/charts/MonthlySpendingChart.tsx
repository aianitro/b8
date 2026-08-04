'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { LANDSCAPE_HEX, LANDSCAPE_HEX_LIGHT } from '@/lib/chartColors';

export interface MonthlySpendingData {
  month: string;
  operational: number;
  capital: number;
  budget_operational: number;
  budget_capital: number;
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

export default function MonthlySpendingChart({ data }: { data: MonthlySpendingData[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-5">Monthly Spending</p>
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
          <Bar dataKey="operational" name="Operational" stackId="a" fill={LANDSCAPE_HEX.operational} />
          <Bar dataKey="capital" name="Capital" stackId="a" fill={LANDSCAPE_HEX.capital} radius={[3, 3, 0, 0]} />
          <Line dataKey="budget_operational" name="Op. budget/mo" type="monotone" stroke={LANDSCAPE_HEX_LIGHT.operational} strokeDasharray="4 2" dot={false} strokeWidth={1.5} />
          <Line dataKey="budget_capital" name="Cap. budget/mo" type="monotone" stroke={LANDSCAPE_HEX_LIGHT.capital} strokeDasharray="4 2" dot={false} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

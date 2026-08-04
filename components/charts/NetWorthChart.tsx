'use client';

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { LANDSCAPE_HEX } from '@/lib/chartColors';

export interface NetWorthPoint {
  month: string;
  operational: number;
  capital: number;
  total: number;
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

export default function NetWorthChart({ data }: { data: NetWorthPoint[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-5">Net Worth Over Time</p>
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
          <ReferenceLine y={0} stroke="#e2e8f0" />
          <Line dataKey="operational" name="Operational" type="monotone" stroke={LANDSCAPE_HEX.operational} strokeWidth={1.5} dot={{ r: 2.5 }} />
          <Line dataKey="capital" name="Capital" type="monotone" stroke={LANDSCAPE_HEX.capital} strokeWidth={1.5} dot={{ r: 2.5 }} />
          <Line dataKey="total" name="Total" type="monotone" stroke="#1e293b" strokeWidth={2.5} dot={{ r: 3, fill: '#1e293b' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

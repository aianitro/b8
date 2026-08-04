'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { STATUS_HEX } from '@/lib/chartColors';

export interface BudgetVsActualRow {
  category: string;
  budget: number;
  spent: number;
  landscape: 'operational' | 'capital';
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

function Section({ rows, title }: { rows: BudgetVsActualRow[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6 last:mb-0">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={rows.length * 52 + 20}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, left: 96, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 12, fill: '#475569' }} width={90} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#64748b' }} />
          <Bar dataKey="budget" name="Budget" fill="#f1f5f9" radius={[0, 3, 3, 0]} />
          <Bar dataKey="spent" name="Spent" radius={[0, 3, 3, 0]}>
            {rows.map((row, i) => (
              <Cell key={i} fill={row.spent > row.budget ? STATUS_HEX.over : STATUS_HEX.under} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function BudgetVsActualChart({ data }: { data: BudgetVsActualRow[] }) {
  const operational = data.filter((d) => d.landscape === 'operational');
  const capital = data.filter((d) => d.landscape === 'capital');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-5">Budget vs Actual</p>
      <Section rows={operational} title="Operational" />
      <Section rows={capital} title="Capital" />
    </div>
  );
}

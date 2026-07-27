'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export interface CategorySlice {
  name: string;
  value: number;
  landscape: 'operational' | 'capital';
}

const OP_COLORS  = ['#3b82f6', '#60a5fa', '#93c5fd', '#06b6d4', '#0ea5e9', '#6366f1'];
const CAP_COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#d946ef', '#ec4899', '#f43f5e'];

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

function Donut({ data, title, colors }: { data: CategorySlice[]; title: string; colors: string[] }) {
  if (data.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">{title}: no data</div>
  );
  return (
    <div className="flex-1">
      <p className="text-xs font-medium text-center text-slate-400 uppercase tracking-wider mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={46} outerRadius={76} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
          />
          <Legend iconType="circle" iconSize={7} formatter={(v) => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function CategoryDonutChart({ data }: { data: CategorySlice[] }) {
  const operational = data.filter((d) => d.landscape === 'operational');
  const capital = data.filter((d) => d.landscape === 'capital');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Category Breakdown</p>
      <div className="flex gap-4">
        <Donut data={operational} title="Operational" colors={OP_COLORS} />
        <Donut data={capital} title="Capital" colors={CAP_COLORS} />
      </div>
    </div>
  );
}

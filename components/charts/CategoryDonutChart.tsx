'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export interface CategorySlice {
  name: string;
  value: number;
  landscape: 'operational' | 'capital';
}

const OP_COLORS  = ['#3b82f6', '#60a5fa', '#93c5fd', '#06b6d4', '#0ea5e9', '#6366f1', '#14b8a6'];
const CAP_COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#d946ef', '#ec4899', '#f43f5e', '#e879f9'];
const OTHER_COLOR = '#94a3b8';

// Recharts' built-in <Legend/> used to share the same fixed-height container as the <Pie/>, so a
// landscape with many categories wrapped the legend across enough rows to crush the pie's radius
// to near-invisible (this is exactly what was happening to Operational while Capital, with far
// fewer categories, rendered fine). Capping the slice count — grouping the tail into "Other" —
// and rendering the legend as its own block below the chart, not inside the chart's layout,
// fixes both the crowding and keeps the pie's size consistent no matter how many budget
// categories exist.
const MAX_SLICES = 7;

interface Slice { name: string; value: number; isOther?: boolean }

function capSlices(data: CategorySlice[]): Slice[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SLICES) return sorted;
  const top = sorted.slice(0, MAX_SLICES);
  const otherValue = sorted.slice(MAX_SLICES).reduce((s, d) => s + d.value, 0);
  return [...top, { name: 'Other', value: otherValue, isOther: true }];
}

const fmt = (v: number | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v ?? 0);

function Donut({ data, title, colors }: { data: CategorySlice[]; title: string; colors: string[] }) {
  if (data.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">{title}: no data</div>
  );

  const slices = capSlices(data);
  const total = slices.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium text-center text-slate-400 uppercase tracking-wider mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={46} outerRadius={76} paddingAngle={2}>
            {slices.map((s, i) => (
              <Cell key={s.name} fill={s.isOther ? OTHER_COLOR : colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="mt-2 space-y-1">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: s.isOther ? OTHER_COLOR : colors[i % colors.length] }}
            />
            <span className="truncate flex-1">{s.name}</span>
            <span className="font-mono text-slate-400 shrink-0">{fmt(s.value)}</span>
            <span className="font-mono text-slate-300 shrink-0 w-9 text-right">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
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

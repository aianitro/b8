'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { LANDSCAPE_HEX, STATUS_HEX } from '@/lib/chartColors';

export interface ProfitLossPoint {
  month: string;
  /** Operational spending for the month, already NEGATED so it hangs below the zero line. */
  spent: number | null;
  /** Money in for the month, positive, rising above the line. */
  received: number | null;
  /** Cumulative P/L for settled months; null once the year turns to forecast. */
  pl: number | null;
  /** The same series from the last settled month onward, drawn dashed. */
  plProjected: number | null;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

/**
 * The year in one frame: what each month cost, and where that leaves the running total.
 *
 * Bars and line share ONE axis rather than being split across a left and a right. A second scale
 * would let the two be slid against each other until they told whatever story the axis ranges
 * happened to imply — the standard way a combo chart lies — and both series are dollars, so there
 * is no reason to. The cost is that the bars occupy the upper band and the line swings below; the
 * benefit is that a $30,000 bar and a $30,000 drop are the same height.
 *
 * Merged from two separate widgets. Read apart, "this month cost $26,000" and "the year is
 * $32,000 down" are two facts; read together they are one sentence, and June is where you see it.
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
        Bars: money in above the line, money out below · Line: cumulative income less spending, dashed once forecast
      </p>
      <ResponsiveContainer width="100%" height={260}>
        {/* `barGap="-100%"` puts the two bars in ONE column instead of side by side, which is what
            makes money in sit directly above the money out it has to cover.
            
            Not a shared `stackId`: Recharts stacks by accumulation, so [+7,631, −3,312] becomes a
            running total — the negative eats into the positive and both rects come out sharing a
            top edge, drawing money out as a slice of money in. And not `stackOffset="sign"`, which
            is the documented fix for that and hangs the renderer outright on this chart, mixing
            bars and a null-gapped line. Full overlap needs neither: the two series have opposite
            signs, so they can never collide vertically. */}
        <ComposedChart data={data} barGap="-100%" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <Tooltip
            // Money out is stored negative to make the bar hang downward, so it is put back
            // before anyone reads it. Only that series: the P/L line's sign is the whole verdict
            // and stripping it would turn a loss into a gain on the way to the screen.
            formatter={(v, name) => fmt(name === 'Money out' ? Math.abs(Number(v)) : Number(v))}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)' }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#64748b' }} />
          {/* Break-even. On a P/L the zero line is the whole verdict — above it the year is up,
              below it the year is down — so it is drawn darker than the grid behind it. */}
          <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1} />
          {/* Behind the line, and muted: the bars are the context, the running total is the point. */}
          {/* Money in rises from zero, money out hangs below it in the same column — the
              comparison the chart is for, made vertical rather than leaving the eye to pair two
              neighbouring bars. */}
          <Bar dataKey="received" name="Money in" fill={STATUS_HEX.good}
               fillOpacity={0.22} radius={[3, 3, 0, 0]} />
          <Bar dataKey="spent" name="Money out" fill={LANDSCAPE_HEX.operational}
               fillOpacity={0.25} radius={[0, 0, 3, 3]} />
          {/* Two series, because Recharts cannot change a line's dash mid-path. They share the last
              settled month so the join is continuous rather than leaving a gap at exactly the
              boundary between what happened and what is expected. */}
          <Line dataKey="pl" name="P/L to date" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          <Line dataKey="plProjected" name="P/L projected" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2.5 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

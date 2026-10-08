'use client';

import { useSyncExternalStore } from 'react';
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
  /** The same pair for months still to come, drawn faded. */
  spentProjected: number | null;
  receivedProjected: number | null;
  /** Cumulative P/L for settled months; null once the year turns to forecast. */
  pl: number | null;
  /** The same series from the last settled month onward, drawn dashed. */
  plProjected: number | null;
}

/** Pixels. Paired with an equal and opposite `barGap` so the two series share one column. */
const BAR_WIDTH = 40;
/** The phone's bar, the width the phone app draws: twelve 40px columns do not fit 340px. */
const BAR_WIDTH_NARROW = 8;

// THE PHONE GETS THE PHONE APP'S CHART, at the owner's request: no y-axis and no legend, so the
// plot takes the card's whole width. The axis cost about a fifth of a 390px screen to label a scale
// the tooltip already gives exactly, and the legend wrapped to three lines above a chart the
// caption already explains.
//
// Width, not `display-mode: standalone`, for the reason set out in WhereTheMonthSits.tsx: the
// installed app also runs in a desktop window, and a phone browser tab is just as narrow. A hook
// rather than CSS because these are Recharts props, and it costs no flash: the chart is measured
// on the client before it draws anything, so there is no server-rendered shape to swap.
const NARROW = '(max-width: 767px)';
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

interface TooltipEntry { dataKey?: string | number; name?: string | number; value?: number | string; color?: string }

/**
 * Custom because the default lists every series with a value at that x, and one month is in two of
 * them on purpose.
 *
 * The settled and forecast P/L lines OVERLAP on the last settled month — August is the end of one
 * and the start of the other — so that the solid line and the dashed one share a point and join
 * without a gap. That is right on the canvas and wrong in a tooltip, where it printed the same
 * figure twice under two labels and read as a contradiction. The forecast entry is dropped
 * wherever the settled one is present: on the boundary the month IS settled, and the dashed line
 * starting there is a drawing convenience rather than a second claim about it.
 *
 * Money out is stored negative so its bar hangs below the axis, and it is put back here. Only that
 * series — the P/L line's sign is the whole verdict, and stripping it would turn a loss into a
 * gain on the way to the screen.
 */
function FlowTooltip({ active, payload, label }: {
  active?: boolean; payload?: TooltipEntry[]; label?: string;
}) {
  if (!active || !payload?.length) return null;

  const hasSettled = payload.some((e) => e.dataKey === 'pl' && e.value != null);
  const rows = payload.filter((e) =>
    e.value != null && !(e.dataKey === 'plProjected' && hasSettled));
  if (rows.length === 0) return null;

  return (
    <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-slate-700 mb-1">{label}</p>
      {rows.map((e) => (
        <p key={String(e.dataKey)} className="flex items-center justify-between gap-4">
          <span style={{ color: e.color }}>{String(e.name)}</span>
          <span className="font-mono text-slate-700">
            {fmt(String(e.name).startsWith('Money out') ? Math.abs(Number(e.value)) : Number(e.value))}
          </span>
        </p>
      ))}
    </div>
  );
}

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
 * is gone; the accounts page is where that question belongs.
 */
export default function ProfitLossChart({ data }: { data: ProfitLossPoint[] }) {
  const narrow = useNarrow();
  const barSize = narrow ? BAR_WIDTH_NARROW : BAR_WIDTH;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-md:px-3 max-md:py-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1 max-md:px-2">Profit &amp; Loss</p>
      <p className="text-[11px] text-slate-400 mb-4 max-md:px-2">
        Bars: money in above the line, money out below · Line: cumulative income less spending, dashed once forecast
      </p>
      <ResponsiveContainer width="100%" height={260}>
        {/* One column for the pair, so money in sits exactly above the money out it has to cover.
            `barSize` and `barGap` are both EXPLICIT PIXELS and they are the same number: Recharts
            lays the second bar at `first.x + barSize + barGap`, so equal magnitudes cancel to zero
            and the two share an origin. Expressed as `barGap="-100%"` it was a percentage of a
            width Recharts derives from the category, and the rounding left the bars a pixel or two
            apart — close enough to look like a glitch and far enough to be one.

            Not a shared `stackId`: Recharts stacks by accumulation, so [+7,631, −3,312] becomes a
            running total — the negative eats into the positive and both rects come out sharing a
            top edge, drawing money out as a slice of money in. And not `stackOffset="sign"`, the
            documented fix for that, which hangs the renderer outright on this chart, mixing bars
            and a null-gapped line. Overlap needs neither: the two series have opposite signs, so
            they can never collide vertically. */}
        <ComposedChart data={data} barSize={barSize} barGap={-barSize}
                       margin={narrow ? { top: 4, right: 4, left: 4, bottom: 0 } : { top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          {/* Every month labelled on the phone too — `interval={0}` — or Recharts thins them to
              every other one, and "which bar is June" becomes a count. */}
          <XAxis dataKey="month" tick={{ fontSize: narrow ? 10 : 11, fill: '#94a3b8' }} interval={0}
                 axisLine={false} tickLine={false} />
          <YAxis hide={narrow} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <Tooltip content={<FlowTooltip />} />
          {!narrow && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#64748b' }} />}
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
          {/* The months still to come. Same colours, roughly half the fill, and an outline — a
              forecast should be recognisable as one at a glance without being a fourth hue to
              learn. They carry the same `barSize`/`barGap` as the pair above, so all four series
              land in one column and the settled and forecast bars, which never share a month,
              cannot overlap. */}
          <Bar dataKey="receivedProjected" name="Money in (projected)" fill={STATUS_HEX.good}
               fillOpacity={0.1} stroke={STATUS_HEX.good} strokeOpacity={0.45} strokeDasharray="3 2"
               radius={[3, 3, 0, 0]} />
          <Bar dataKey="spentProjected" name="Money out (projected)" fill={LANDSCAPE_HEX.operational}
               fillOpacity={0.12} stroke={LANDSCAPE_HEX.operational} strokeOpacity={0.45} strokeDasharray="3 2"
               radius={[0, 0, 3, 3]} />
          {/* Two series, because Recharts cannot change a line's dash mid-path. They share the last
              settled month so the join is continuous rather than leaving a gap at exactly the
              boundary between what happened and what is expected. */}
          <Line dataKey="pl" name="P/L to date" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          <Line dataKey="plProjected" name="P/L projected" type="monotone" stroke={STATUS_HEX.good}
                strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2.5 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Phone only — `md:hidden`, the same width switch as the chart's compact shape above. */}
      <div className="md:hidden">
        <ProfitLossFigures data={data} />
      </div>
    </div>
  );
}

/**
 * The chart's figures, as rows — the phone app's `PlFigures`, at the owner's request.
 *
 * On a phone it is the only place the exact numbers sit in view: the compact chart has no axis, and
 * a tooltip shows one month at a time. Read off the SAME points the chart draws, so the table cannot
 * disagree with the picture above it. A month is projected when it has no settled bar, which is the
 * boundary the chart fades and dashes at; projected rows are faded and marked here the same way.
 *
 * Money out is coloured as its bar is on this chart (blue), not as the phone app's (orange), so each
 * figure matches the bar directly above it.
 */
function ProfitLossFigures({ data }: { data: ProfitLossPoint[] }) {
  const cell = 'py-1.5 text-right font-mono tabular-nums';
  return (
    <table className="w-full mt-4 text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
          <th className="pb-1.5 px-2 text-left font-medium">Month</th>
          <th className="pb-1.5 text-right font-medium">In</th>
          <th className="pb-1.5 text-right font-medium">Out</th>
          <th className="pb-1.5 px-2 text-right font-medium">Net so far</th>
        </tr>
      </thead>
      <tbody>
        {data.map((p) => {
          const projected = p.spent === null;
          const moneyIn = p.received ?? p.receivedProjected ?? 0;
          const moneyOut = Math.abs(p.spent ?? p.spentProjected ?? 0);
          const net = p.pl ?? p.plProjected ?? 0;
          return (
            <tr key={p.month} className={`border-b border-slate-50 last:border-0 ${projected ? 'opacity-50' : ''}`}>
              <td className="py-1.5 px-2 text-slate-500">{p.month}{projected ? ' ·' : ''}</td>
              <td className={`${cell} text-emerald-600`}>{fmt(moneyIn)}</td>
              <td className={`${cell} text-blue-600`}>{fmt(moneyOut)}</td>
              <td className={`${cell} px-2 font-semibold ${net < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {net < 0 ? '−' : ''}{fmt(Math.abs(net))}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td colSpan={4} className="pt-2 px-2 text-right text-[10px] text-slate-400">· projected</td></tr>
      </tfoot>
    </table>
  );
}

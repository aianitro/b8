'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { GripVertical } from 'lucide-react';
import type { GridRow } from './BudgetMonthlyGrid';
import { expenseCellStyle, expenseCellText, incomeCellStyle, incomeCellText } from '@/lib/budgetColors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) =>
  n === 0
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const fmtSigned = (n: number) =>
  n === 0
    ? '—'
    : `${n > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)}`;

const LANDSCAPE_COLOR = { operational: 'bg-blue-500', capital: 'bg-violet-500' } as const;

// Flat (no schedule): "$X/mo". Lumpy schedule with equal nonzero amounts in a subset of
// months (e.g. property tax twice a year): "$X · Apr/Oct". Fully custom, varying amount
// per month (e.g. a salary with raises): "$min–$max · custom".
function budgetLabel(row: GridRow): string {
  if (!row.monthly_amounts) {
    return `${fmtFull(row.annual_budget / 12)}/mo${row.is_income ? ' expected' : ''}`;
  }
  const nonZero = row.monthly_amounts.filter((n) => n > 0);
  if (nonZero.length === 0) return `${fmtFull(0)}/mo`;
  const min = Math.min(...nonZero);
  const max = Math.max(...nonZero);
  if (min === max) {
    const activeMonths = row.monthly_amounts.map((n, i) => (n > 0 ? MONTHS[i] : null)).filter(Boolean);
    return activeMonths.length < 12 ? `${fmtFull(min)} · ${activeMonths.join('/')}` : `${fmtFull(min)}/mo`;
  }
  return `${fmtFull(min)}–${fmtFull(max)} · custom`;
}

type Section = 'income' | 'expense';

function Row({
  row, section, currentMonth, dragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  row: GridRow;
  section: Section;
  currentMonth: number;
  dragOver: number | null;
  onDragStart: (section: Section, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (section: Section, targetId: number) => void;
  onDragEnd: () => void;
}) {
  const ytdNetIncome  = !row.is_income && row.ytd < 0; // expense category with net income
  const ytdNetExpense =  row.is_income && row.ytd < 0; // income category with net expense
  const ytdPct = row.annual_budget > 0 ? Math.round((Math.max(row.ytd, 0) / row.annual_budget) * 100) : 0;
  const accentColor = row.is_income ? 'bg-emerald-500' : LANDSCAPE_COLOR[row.landscape];
  const isDragOver = dragOver === row.id;

  return (
    <tr
      draggable
      onDragStart={() => onDragStart(section, row.id)}
      onDragOver={(e) => onDragOver(e, row.id)}
      onDrop={() => onDrop(section, row.id)}
      onDragEnd={onDragEnd}
      className={`border-b border-slate-100 last:border-0 group hover:bg-slate-50/30 cursor-grab active:cursor-grabbing transition-colors ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}`}
    >
      {/* Category */}
      <td className="sticky left-0 bg-white group-hover:bg-slate-50/30 px-2 py-1.5 border-r border-slate-100 z-10 min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <GripVertical size={12} className="text-slate-300 group-hover:text-slate-400 shrink-0 transition-colors" />
          <div className={`w-0.5 h-5 rounded-full shrink-0 ${accentColor}`} />
          <Link
            href={`/categories/${encodeURIComponent(row.category)}`}
            title={`Open ${row.category} statement`}
            draggable={false}
            className="block hover:opacity-70 transition-opacity"
          >
            <div className="text-xs font-medium text-slate-800 whitespace-nowrap hover:text-blue-600 hover:underline">{row.category}</div>
            <div className="text-[9px] text-slate-400 font-mono mt-0.5">
              {budgetLabel(row)}
            </div>
          </Link>
        </div>
      </td>

      {/* Month cells */}
      {row.months.map((amount, i) => {
        const isFuture = i > currentMonth;
        const isNetIncome  = !row.is_income && amount < 0; // expense category, net income this month
        const isNetExpense =  row.is_income && amount < 0; // income category, net expense this month
        const monthBudget = row.months_budget[i];
        const hasSchedule = Boolean(row.monthly_amounts);
        const offCycle = hasSchedule && monthBudget === 0 && amount !== 0;
        const pct = monthBudget > 0 ? Math.round((Math.abs(amount) / monthBudget) * 100) : 0;
        // The second line of a cell is the PLAN, not the ratio. A percentage answers "how much of
        // it went" and hides the only figure a reader can act on: what this month was actually
        // given. "$1,729" over "$1,100" says both — the ratio is still readable, and now it is
        // readable in dollars. The exact ratio stays in the cell's tooltip for anyone who wants
        // the number. Bare, with no "of": twelve columns of it is twelve repetitions of a word
        // the position in the cell already says.
        const planLabel = offCycle
          ? 'off-cycle'
          : monthBudget > 0
            ? fmt(monthBudget)
            : 'no budget';
        // The month in progress is the one month whose plan can still be acted on, and it is also
        // the month most likely to have nothing against a category yet — early September, with the
        // grocery run still ahead of it. Gating the plan line on `amount !== 0` hid the figure in
        // exactly that window: the cell read "—" and named no budget, so the one row that wants a
        // target showed none. A budgeted current month now always prints its plan. With no budget
        // there is still nothing to say, so it stays bare rather than printing "no budget" under
        // every unbudgeted category for a month that has barely started.
        const showPlan =
          !isFuture && !isNetIncome && (amount !== 0 || (i === currentMonth && monthBudget > 0));
        const upcoming = row.months_upcoming[i];
        // Expense category projecting negative means the remaining budget is already
        // spent — no room left in the months ahead at the current pace.
        const upcomingOver = isFuture && !row.is_income && upcoming < 0;
        const drillHref = !isFuture
          ? `/transactions?category=${encodeURIComponent(row.category)}&month=${i + 1}`
          : undefined;

        let bg: string, text: string;
        if (isNetIncome) {
          bg   = isFuture ? 'bg-slate-50' : 'bg-emerald-50';
          text = isFuture ? 'text-slate-300' : 'text-emerald-600 font-medium';
        } else if (isNetExpense) {
          // An income category netting negative for the month is always unexpected —
          // not graded by magnitude like an over-budget expense would be.
          bg   = isFuture ? 'bg-slate-50' : 'bg-red-100';
          text = isFuture ? 'text-slate-300' : 'text-red-700 font-semibold';
        } else if (row.is_income) {
          bg   = incomeCellStyle(amount, monthBudget, isFuture, offCycle);
          text = incomeCellText(amount, isFuture);
        } else {
          bg   = expenseCellStyle(amount, monthBudget, isFuture, offCycle);
          text = expenseCellText(amount, monthBudget, isFuture, offCycle);
        }
        if (isFuture) text = upcomingOver ? 'text-red-300' : 'text-slate-400';

        const prefix = isNetIncome ? '+' : isNetExpense ? '−' : '';

        const inner = (
          <>
            {/* Top line is what actually happened. In a future month nothing has, so there it is a
                spacer rather than an omission: it holds the line open, and the projection below
                lands on the same baseline as the plan figures in the months either side of it. A
                cell left with one short line instead floats it mid-height, which is what a table
                cell does with content shorter than its row. Reading across a row now, actuals sit
                on one line and expectations on the line beneath, whichever side of today a month
                falls on — and a projection is simply that month's plan, not yet spent against. */}
            <div className="font-mono" aria-hidden={isFuture || undefined}>
              {isFuture ? '\u00A0' : prefix + fmt(prefix ? Math.abs(amount) : amount)}
            </div>
            {isFuture ? (
              <div className="font-mono text-[10px] mt-0.5">
                {upcoming !== 0 ? fmt(Math.abs(upcoming)) : ''}
              </div>
            ) : showPlan && (
              // Muted, whatever the cell is doing. The over-budget grading lives in the cell's
              // background and in the figure above; a budget line printed in red reads as though
              // the plan itself were the problem. `off-cycle` keeps its warning colour, because
              // there the finding IS the absent plan.
              <div className={`text-[8px] mt-0.5 ${
                isNetExpense || offCycle ? 'text-red-500' : 'text-slate-400'
              }`}>
                {isNetExpense ? 'unexpected' : planLabel}
              </div>
            )}
          </>
        );

        const tooltipBudget = offCycle
          ? 'no budget expected this month'
          : `${pct}% of ${fmtFull(monthBudget)}`;
        const futureTitle = upcoming !== 0
          ? `${MONTHS[i]}: ${fmtFull(Math.abs(upcoming))} projected (${hasSchedule ? 'scheduled' : 'remaining budget ÷ months left'})`
          : MONTHS[i];

        return (
          <td
            key={i}
            title={isFuture ? futureTitle : `${MONTHS[i]}: ${prefix}${fmtFull(Math.abs(amount))} (${tooltipBudget})`}
            // The separator has to outrank the cell it is separating. `border-slate-50` is the same
            // colour as a future cell's own `bg-slate-50`, so from October on the column rules
            // vanished and the quarter read as one merged cell — most visibly on a row that is
            // mostly empty, where a lone November figure floated in a wide blank block with no
            // column to belong to.
            className={`p-0 text-right text-xs min-w-[56px] border-r ${isFuture ? 'border-slate-200' : 'border-slate-50'} transition-colors ${bg} ${text} ${i === currentMonth ? 'ring-1 ring-inset ring-blue-200' : ''} ${!isFuture ? 'hover:brightness-95' : ''}`}
          >
            {drillHref ? (
              <a href={drillHref} className="block px-2 py-1.5 w-full h-full">{inner}</a>
            ) : (
              <div className="px-2 py-1.5">{inner}</div>
            )}
          </td>
        );
      })}

      {/* YTD */}
      <td className="sticky right-0 bg-white group-hover:bg-slate-50/30 px-3 py-1.5 text-right border-l border-slate-100 z-10 min-w-[85px]">
        <div className={`font-mono text-xs font-semibold ${
          ytdNetIncome  ? 'text-emerald-700' :
          ytdNetExpense ? 'text-red-600' :
          row.is_income ? 'text-emerald-700' : 'text-slate-800'
        }`}>
          {ytdNetIncome ? '+' : ytdNetExpense ? '−' : ''}{fmt(ytdNetIncome || ytdNetExpense ? Math.abs(row.ytd) : row.ytd)}
        </div>
        <div className={`text-[9px] mt-0.5 ${ytdPct > 100 && !row.is_income ? 'text-red-500' : 'text-slate-400'}`}>
          {ytdNetIncome ? 'net income' : ytdNetExpense ? 'net expense' : `${ytdPct}% of annual`}
        </div>
        <div className="mt-1 bg-slate-100 rounded-full h-1">
          <div
            className={`h-1 rounded-full ${
              ytdNetIncome  ? 'bg-emerald-500' :
              ytdNetExpense ? 'bg-red-400' :
              row.is_income ? 'bg-emerald-500' :
              ytdPct > 100  ? 'bg-red-500' : LANDSCAPE_COLOR[row.landscape]
            }`}
            style={{ width: `${Math.min(ytdPct, 100)}%` }}
          />
        </div>
      </td>
    </tr>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={15}
        className="sticky left-0 bg-slate-50 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400 border-b border-slate-100"
      >
        {title}
      </td>
    </tr>
  );
}

function TotalsRow({
  label, monthTotals, ytd, accent, isIncome, currentMonth,
}: { label: string; monthTotals: number[]; ytd: number; accent: string; isIncome?: boolean; currentMonth: number }) {
  return (
    <tr className="bg-slate-50 border-t border-slate-200">
      <td className={`sticky left-0 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 border-r border-slate-200 z-10 ${accent}`}>
        {label}
      </td>
      {monthTotals.map((total, i) => {
        const isFuture = i > currentMonth;
        // Total income going negative for a month is always unexpected — flag it, don't hide it.
        const negative = isIncome && total < 0;
        // The month in progress is a forecast like the ones after it, so it says so on hover rather
        // than by going grey — it keeps the emphasis its column has earned.
        const title = i === currentMonth
          ? `${MONTHS[i]}: projected close — the month's plan, or what it has already reached`
          : isFuture ? `${MONTHS[i]}: projected` : MONTHS[i];
        return (
          <td
            key={i}
            title={title}
            className={`px-2 py-1.5 text-right font-mono border-r border-slate-100 ${
              isFuture ? 'text-[10px] font-normal text-slate-400' : `text-xs font-semibold ${negative ? 'text-red-600' : 'text-slate-700'}`
            } ${negative && !isFuture ? 'bg-red-50' : i === currentMonth ? 'bg-blue-50/30' : ''}`}
          >
            {total !== 0 ? fmt(isFuture ? Math.abs(total) : total) : ''}
          </td>
        );
      })}
      <td className={`sticky right-0 px-3 py-1.5 text-right text-xs font-mono font-bold border-l border-slate-200 z-10 ${isIncome && ytd < 0 ? 'text-red-600' : 'text-slate-700'} ${accent}`}>
        {fmt(ytd)}
      </td>
    </tr>
  );
}

function NetRow({ netMonthTotals, netYtd, currentMonth }: { netMonthTotals: number[]; netYtd: number; currentMonth: number }) {
  return (
    <tr className="border-t-2 border-slate-300">
      <td className="sticky left-0 bg-slate-900 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white border-r border-slate-700 z-10">
        Net
      </td>
      {netMonthTotals.map((net, i) => {
        const isFuture = i > currentMonth;
        const color = isFuture ? 'text-[10px] font-normal text-slate-500' : `text-xs font-bold ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-slate-500'}`;
        return (
          <td
            key={i}
            title={i === currentMonth
              ? `${MONTHS[i]}: projected close — both sides drawn to month end`
              : isFuture ? `${MONTHS[i]}: projected` : MONTHS[i]}
            className={`px-2 py-1.5 text-right font-mono border-r border-slate-700 bg-slate-900 ${color} ${i === currentMonth ? 'bg-slate-800' : ''}`}
          >
            {isFuture ? (net !== 0 ? fmtSigned(net) : '') : fmtSigned(net)}
          </td>
        );
      })}
      <td className={`sticky right-0 bg-slate-900 px-3 py-1.5 text-right text-xs font-mono font-bold border-l border-slate-700 z-10 ${netYtd > 0 ? 'text-emerald-400' : netYtd < 0 ? 'text-red-400' : 'text-white'}`}>
        {fmtSigned(netYtd)}
      </td>
    </tr>
  );
}

function UncategorizedRow({
  months, isIncome, currentMonth,
}: { months: number[]; isIncome: boolean; currentMonth: number }) {
  const ytd = months.reduce((s, n) => s + n, 0);
  if (ytd === 0 && months.every((n) => n === 0)) return null;
  return (
    <tr className="border-b border-amber-100 bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
      <td className="sticky left-0 bg-amber-50/40 px-2 py-1.5 border-r border-amber-100 z-10 min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <div className="w-4 shrink-0" />
          <div className="w-0.5 h-5 rounded-full shrink-0 bg-amber-400" />
          <div className="text-xs font-medium text-amber-700 whitespace-nowrap">Uncategorized</div>
        </div>
      </td>
      {months.map((amount, i) => {
        const isFuture = i > currentMonth;
        const href = !isFuture
          ? `/transactions?filter=uncategorized&month=${i + 1}`
          : undefined;
        const inner = (
          <div className={`font-mono ${isFuture || amount === 0 ? 'text-slate-300' : isIncome ? 'text-emerald-600 font-medium' : 'text-amber-700 font-medium'}`}>
            {!isFuture && amount > 0 ? fmt(amount) : ''}
          </div>
        );
        return (
          <td
            key={i}
            className={`p-0 text-right text-xs min-w-[56px] border-r border-amber-100 ${i === currentMonth ? 'bg-amber-50' : ''}`}
          >
            {href ? (
              <a href={href} className="block px-2 py-1.5 w-full h-full hover:bg-amber-100/50 transition-colors">{inner}</a>
            ) : (
              <div className="px-2 py-1.5">{inner}</div>
            )}
          </td>
        );
      })}
      <td className="sticky right-0 bg-amber-50/40 px-3 py-1.5 text-right border-l border-amber-100 z-10 min-w-[85px]">
        <div className={`font-mono text-xs font-semibold ${isIncome ? 'text-emerald-700' : 'text-amber-700'}`}>
          {ytd > 0 ? fmt(ytd) : '—'}
        </div>
      </td>
    </tr>
  );
}

function BalanceRow({
  label, balances, ytdBalance, accent, currentMonth,
}: { label: string; balances: number[]; ytdBalance: number; accent: string; currentMonth: number }) {
  return (
    <tr className={`border-t border-slate-200 ${accent}`}>
      <td className={`sticky left-0 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 border-r border-slate-200 z-10 ${accent}`}>
        {label}
      </td>
      {balances.map((bal, i) => {
        const isFuture = i > currentMonth;
        const color = isFuture ? 'text-[10px] font-normal text-slate-400' : `text-xs font-semibold ${bal >= 0 ? 'text-slate-700' : 'text-red-600'}`;
        return (
          <td
            key={i}
            className={`px-2 py-1.5 text-right font-mono border-r border-slate-100 ${color} ${i === currentMonth ? 'bg-blue-50/40' : ''}`}
          >
            {fmt(bal)}
          </td>
        );
      })}
      <td className={`sticky right-0 px-3 py-1.5 text-right text-xs font-mono font-semibold border-l border-slate-200 z-10 ${accent} ${ytdBalance >= 0 ? 'text-slate-700' : 'text-red-600'}`}>
        {fmt(ytdBalance)}
      </td>
    </tr>
  );
}

interface Props {
  rows: GridRow[];
  currentMonth: number;
  beginningBalance: number;
  uncategorizedIncome: number[];
  uncategorizedExpense: number[];
}

export default function BudgetMonthlyGridClient({ rows, currentMonth, beginningBalance, uncategorizedIncome, uncategorizedExpense }: Props) {
  const incomeInitial  = rows.filter((r) => r.is_income);
  const expenseInitial = rows.filter((r) => !r.is_income);

  const [incomeOrder,  setIncomeOrder]  = useState<GridRow[]>(incomeInitial);
  const [expenseOrder, setExpenseOrder] = useState<GridRow[]>(expenseInitial);
  const [dragOver, setDragOver] = useState<number | null>(null); // category id

  const dragRef = useRef<{ section: Section; id: number } | null>(null);

  // What each month is expected to CLOSE at — closed months are settled, the rest are forecast.
  // Only the totals, Net and running-balance rows read this; the category cells above keep showing
  // actual over plan, which is what a month in progress is actually asking about.
  //
  // The month in progress used to be lumped in with the closed ones and counted at its actual, and
  // that quietly broke the forecast beneath it. Spending accrues daily, pay does not: on the 10th
  // of a month whose salary lands on the 15th, income to date is genuinely zero, so September
  // totalled no income at all, showed a $1,345 loss, and carried that error into every closing
  // balance after it. The month was not a loss; it was ten days old.
  //
  // Projecting one side alone would only move the error: a full month's pay against ten days of
  // spending reads optimistic exactly as far as the old version read pessimistic. So both sides
  // project, and Net compares two figures drawn to the same horizon.
  //
  // Plan, or actual where actual has already passed it — a month cannot un-spend what it has spent,
  // and a category already over its line will not close back under it. This is the grid's own
  // schedule, deliberately NOT the recurring-aware pacing in lib/domain/pacing.ts: that projection
  // is defined only over scored spending categories (`is_income = FALSE`, see lib/domain/adherence.ts)
  // and so has nothing to say about the income half, which is the half that was blank.
  const combined = (r: GridRow) => r.months.map((amt, i) => {
    if (i > currentMonth) return r.months_upcoming[i];
    if (i < currentMonth) return amt;
    return Math.max(amt, r.months_budget[i]);
  });

  const incomeMonthTotals  = Array.from({ length: 12 }, (_, i) => incomeOrder.reduce((s, r) => s + combined(r)[i], 0) + uncategorizedIncome[i]);
  const expenseMonthTotals = Array.from({ length: 12 }, (_, i) => expenseOrder.reduce((s, r) => s + combined(r)[i], 0) + uncategorizedExpense[i]);
  const netMonthTotals     = Array.from({ length: 12 }, (_, i) => incomeMonthTotals[i] - expenseMonthTotals[i]);
  const incomeYtd          = incomeOrder.reduce((s, r) => s + r.ytd, 0) + uncategorizedIncome.reduce((s, n) => s + n, 0);
  const expenseYtd         = expenseOrder.reduce((s, r) => s + r.ytd, 0) + uncategorizedExpense.reduce((s, n) => s + n, 0);
  const netYtd             = incomeYtd - expenseYtd;

  // Running balance: opening[i] = beginningBalance + sum of net for months 0..i-1
  const openingBalances = Array.from({ length: 12 }, (_, i) =>
    beginningBalance + netMonthTotals.slice(0, i).reduce((s, n) => s + n, 0)
  );
  const closingBalances = Array.from({ length: 12 }, (_, i) =>
    openingBalances[i] + netMonthTotals[i]
  );

  function onDragStart(section: Section, id: number) {
    dragRef.current = { section, id };
  }

  function onDragOver(e: React.DragEvent, id: number) {
    e.preventDefault();
    setDragOver(id);
  }

  function onDrop(section: Section, targetId: number) {
    const drag = dragRef.current;
    if (!drag || drag.section !== section || drag.id === targetId) {
      setDragOver(null);
      return;
    }

    const setOrder = section === 'income' ? setIncomeOrder : setExpenseOrder;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((r) => r.id === drag.id);
      const toIdx   = next.findIndex((r) => r.id === targetId);
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);

      // Persist after state update
      const items = next.map((r, i) => ({ id: r.id, sort_order: i }));
      fetch('/api/categories/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });

      return next;
    });

    setDragOver(null);
    dragRef.current = null;
  }

  function onDragEnd() {
    setDragOver(null);
    dragRef.current = null;
  }


  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="sticky left-0 bg-slate-50 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 border-r border-slate-100 min-w-[140px] z-30">
                Category
              </th>
              {MONTHS.map((m, i) => (
                <th
                  key={m}
                  className={`px-2 py-1.5 text-right text-xs font-semibold uppercase tracking-wide min-w-[56px] border-r border-slate-50 ${
                    i === currentMonth
                      ? 'text-blue-600 bg-blue-50/50'
                      : i > currentMonth
                      ? 'text-slate-300'
                      : 'text-slate-400'
                  }`}
                >
                  {m}
                  {i === currentMonth && <div className="text-[8px] font-normal mt-0.5 text-blue-400">current</div>}
                </th>
              ))}
              <th className="sticky right-0 bg-slate-50 px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-400 border-l border-slate-100 min-w-[85px] z-30">
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            <BalanceRow
              label="Opening Balance"
              balances={openingBalances}
              ytdBalance={beginningBalance}
              accent="bg-sky-50/60"
              currentMonth={currentMonth}
            />

            {incomeOrder.length > 0 && (
              <>
                <SectionHeader title="Income" />
                {incomeOrder.map((row) => (
                  <Row
                    key={row.id} row={row} section="income" currentMonth={currentMonth} dragOver={dragOver}
                    onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
                  />
                ))}
                <UncategorizedRow months={uncategorizedIncome} isIncome={true} currentMonth={currentMonth} />
                <TotalsRow label="Total Income" monthTotals={incomeMonthTotals} ytd={incomeYtd} accent="bg-emerald-50" isIncome currentMonth={currentMonth} />
              </>
            )}

            {expenseOrder.length > 0 && (
              <>
                <SectionHeader title={expenseOrder[0]?.landscape === 'operational' ? 'Operational' : 'Capital'} />
                {expenseOrder.map((row) => (
                  <Row
                    key={row.id} row={row} section="expense" currentMonth={currentMonth} dragOver={dragOver}
                    onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
                  />
                ))}
                <UncategorizedRow months={uncategorizedExpense} isIncome={false} currentMonth={currentMonth} />
                <TotalsRow label="Total Expenses" monthTotals={expenseMonthTotals} ytd={expenseYtd} accent="bg-slate-100" currentMonth={currentMonth} />
              </>
            )}

            <NetRow netMonthTotals={netMonthTotals} netYtd={netYtd} currentMonth={currentMonth} />

            <BalanceRow
              label="Closing Balance"
              balances={closingBalances}
              ytdBalance={beginningBalance + netYtd}
              accent="bg-sky-50/60"
              currentMonth={currentMonth}
            />
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-1.5 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-400 flex-wrap">
        {/* Names the shading explicitly now that no cell prints a percentage: the bands are the
            only place the ratio is stated on screen, and a legend headed with a bare "%" beside
            cells full of dollars reads as a stale label. */}
        <span className="font-medium">Cell shading — expenses as % of monthly budget:</span>
        {[
          { color: 'bg-green-50',   label: '< 50%' },
          { color: 'bg-emerald-50', label: '50–100% · on budget' },
          { color: 'bg-amber-50',   label: '101–110% · watch it' },
          { color: 'bg-red-100',    label: '> 110% · over budget' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded ${color} border border-slate-200`} />
            {label}
          </span>
        ))}
        <span className="ml-2 flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border border-blue-300 ring-1 ring-blue-200" />
          Current month
        </span>
        <span className="ml-2 flex items-center gap-1.5 text-slate-400">
          Projected (lighter text) · scheduled amount, or remaining budget ÷ months left
        </span>
      </div>
    </div>
  );
}

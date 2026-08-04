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
        const pctLabel = offCycle ? 'off-cycle' : `${pct}%`;
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
            <div className={`font-mono ${isFuture ? 'text-[10px]' : ''}`}>
              {isFuture
                ? (upcoming !== 0 ? fmt(Math.abs(upcoming)) : '')
                : prefix + fmt(prefix ? Math.abs(amount) : amount)}
            </div>
            {!isFuture && amount !== 0 && !isNetIncome && (
              <div className={`text-[8px] mt-0.5 ${
                isNetExpense
                  ? 'text-red-500'
                  : row.is_income
                  ? 'text-emerald-500'
                  : offCycle || pct > 110
                  ? 'text-red-500'
                  : pct > 100
                  ? 'text-amber-500'
                  : 'text-slate-400'
              }`}>
                {isNetExpense ? 'unexpected' : pctLabel}
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
            className={`p-0 text-right text-xs min-w-[56px] border-r border-slate-50 transition-colors ${bg} ${text} ${i === currentMonth ? 'ring-1 ring-inset ring-blue-200' : ''} ${!isFuture ? 'hover:brightness-95' : ''}`}
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
        return (
          <td
            key={i}
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

  // Actual through the current month, projected (annual - YTD spread across remaining months,
  // or the explicit schedule) for months after it — see months_upcoming in BudgetMonthlyGrid.tsx.
  const combined = (r: GridRow) => r.months.map((amt, i) => (i > currentMonth ? r.months_upcoming[i] : amt));

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
        <span className="font-medium">Expenses % of monthly budget:</span>
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

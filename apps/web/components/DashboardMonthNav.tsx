import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS } from '@/lib/drilldown';

/**
 * The dashboard's month, with arrows to step back through the year and forward to today.
 *
 * THIS YEAR ONLY. The budget is one plan per category with no year attached, and the tiles link
 * into a Transactions filter that is pinned to the current year — so last December would be
 * graded against this year's plan and drill into this year's December. Stopping at January keeps
 * every figure on the page measured against the plan it was actually made under.
 *
 * Links, not buttons: each month is its own URL, so the back button and a bookmark both work.
 * The current month has no `?month=` at all, so `/dashboard` stays the page it always was.
 *
 * @param month    0-based, the month on screen.
 * @param current  0-based, today's month.
 */
export default function DashboardMonthNav({ year, month, current, day, monthLength }: {
  year: number;
  month: number;
  current: number;
  day: number;
  monthLength: number;
}) {
  const href = (m: number) => (m === current ? '/dashboard' : `/dashboard?month=${m + 1}`);
  const arrow = 'p-1 -m-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors';

  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
      {month > 0
        ? <Link href={href(month - 1)} aria-label={`${MONTHS[month - 1]} ${year}`} className={arrow}><ChevronLeft size={16} /></Link>
        : <span className="p-1 -m-1 text-slate-200"><ChevronLeft size={16} /></span>}
      <span className="font-medium text-slate-700">{MONTHS[month]} {year}</span>
      {month < current
        ? <Link href={href(month + 1)} aria-label={`${MONTHS[month + 1]} ${year}`} className={arrow}><ChevronRight size={16} /></Link>
        : <span className="p-1 -m-1 text-slate-200"><ChevronRight size={16} /></span>}
      <span className="text-slate-400">
        {month === current ? `· day ${day} of ${monthLength}` : '· closed'}
      </span>
    </div>
  );
}

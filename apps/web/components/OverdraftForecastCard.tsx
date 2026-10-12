import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import type { ForecastFinding } from '@/lib/overdraftWatch';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * A cash account whose next week of recurring charges would take it below its cushion — amber, the
 * overdraft card's earlier and milder sibling: nothing is short yet, and there are days to act.
 *
 * Names the charges that do it, because "which payment" is what decides whether to move money or
 * let it ride. The projection is the last sync's, so its age is shown with it.
 */
export default function OverdraftForecastCard({ findings }: { findings: ForecastFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <CalendarClock size={14} className="text-amber-600" />
        {findings.length === 1
          ? `An account is heading below ${findings[0].cushion > 0 ? 'its cushion' : 'zero'} this week`
          : `${findings.length} accounts are heading below ${findings.every((f) => f.cushion === 0) ? 'zero' : 'their cushion'} this week`}
      </p>
      <ul className="mt-2 space-y-2">
        {findings.map((f) => (
          <li key={f.accountId}>
            <Link href={`/accounts/${encodeURIComponent(f.accountId)}`} className="flex items-baseline justify-between gap-3 text-sm hover:underline">
              <span className="min-w-0 truncate text-slate-800">{f.bank ? `${f.bank} · ` : ''}{f.account}</span>
              <span className="shrink-0 font-mono text-amber-800">{fmt(f.low)}</span>
            </Link>
            <p className="text-[11px] text-amber-800/90">
              by {day(f.lowOn)}, after {f.charges.map((c) => `${c.label} ${fmt(c.amount)}`).join(', ')}
            </p>
            <p className="text-[11px] text-amber-700/70">as projected at the {when(f.projectedAt)} sync</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

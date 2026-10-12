import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';
import type { OverdraftFinding } from '@/lib/overdraftWatch';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

// When the balance was read: it is the last sync's figure, not a live one, so its age is shown.
const seen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * A cash account below its cushion — the bell's one card about money rather than about a figure's
 * freshness, so the first in it and the only red one. The fix is a transfer with a deadline (the
 * fee), which is why each row links to the account.
 *
 * Silent when nothing is short.
 */
export default function OverdraftCard({ findings }: { findings: OverdraftFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
        <AlertOctagon size={14} className="text-red-600" />
        {findings.length === 1 ? 'An account is about to cost a fee' : `${findings.length} accounts are about to cost a fee`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {findings.map((f) => (
          <li key={f.accountId}>
            <Link href={`/accounts/${encodeURIComponent(f.accountId)}`} className="flex items-baseline justify-between gap-3 text-sm hover:underline">
              <span className="min-w-0 truncate text-slate-800">{f.bank ? `${f.bank} · ` : ''}{f.account}</span>
              <span className="shrink-0 font-mono text-red-700">{fmt(f.balance)}</span>
            </Link>
            <p className="text-[11px] text-red-700/80">
              {f.balance < 0 ? 'Overdrawn' : `Below your ${fmt(f.cushion)} cushion`} at the {seen(f.seenAt)} sync · move money in before the bank charges
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

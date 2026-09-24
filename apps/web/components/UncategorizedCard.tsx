import Link from 'next/link';
import { Tag } from 'lucide-react';
import TransactionEditButton from './TransactionEditButton';
import type { CategoryOption } from '@/lib/transactionEdits';
import type { UnfiledTransaction } from '@/app/dashboard/page';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Math.abs(n));

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * The unfiled rows, filed where they sit.
 *
 * ─── Why this card stopped navigating ────────────────────────────────────────────────────────
 *
 * Uncategorized was the one of the three counts that LEFT the page: the other two open a list in
 * place and this one went to `/transactions?filter=uncategorized`. The argument for that was that
 * filing is real work and the ledger is where work happens — which held right up until the rows
 * themselves became editable. A row editor on the panel means the whole job is four taps from the
 * dashboard, and sending the reader to another page to do what this one can now do is a detour.
 *
 * The link out survives in the corner, because the ledger still has what a panel cannot: search,
 * the amount and date filters, and every row rather than the first twelve.
 *
 * ─── The count is not this list's length ─────────────────────────────────────────────────────
 *
 * The reader caps at twelve. `stats.uncategorized` is the count and comes from its own query over
 * the same predicate, so a backlog of forty shows twelve rows under a card reading forty. The line
 * at the foot says which twelve, rather than leaving the reader to wonder where the rest went.
 */
export default function UncategorizedCard({ items, total, categories }: {
  items: UnfiledTransaction[];
  /** `stats.uncategorized` — the real count, which may exceed what is listed. */
  total: number;
  categories: CategoryOption[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Waiting to be filed</p>
        <Link href="/transactions?filter=uncategorized" className="text-[10px] text-blue-600 hover:underline">
          Open in the ledger
        </Link>
      </div>

      {items.length === 0 ? (
        // Worth saying rather than rendering an empty box. This is the one of the three panels whose
        // empty state is unambiguously good news, and the card above it reads zero either way.
        <div className="flex items-start gap-2.5 text-sm text-slate-400">
          <Tag size={15} className="mt-0.5 shrink-0 text-slate-300" />
          <p>Everything has a category.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate-50">
            {items.map((t) => {
              const inbound = t.amount < 0;
              return (
                // Wraps below `sm:`, as the two panels beside it do: a date, a label, a figure and
                // an edit button do not fit 358px on one line, and the label is what would lose.
                <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="text-[10px] font-mono text-slate-300 w-11 shrink-0">{dayLabel(t.date)}</span>
                  <span className="text-sm text-slate-700 truncate flex-1 min-w-0">{t.label}</span>
                  <span className={`text-xs font-mono shrink-0 w-20 text-right ${inbound ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {inbound ? `+${fmt(t.amount)}` : fmt(t.amount)}
                  </span>
                  {/* The verb this panel exists for. Opens on Category, which is the field every
                      row here is missing by definition. */}
                  <TransactionEditButton categories={categories} row={t} />
                </div>
              );
            })}
          </div>
          {total > items.length && (
            <p className="text-[10px] text-slate-300 mt-3">
              The {items.length} largest of {total.toLocaleString()}. The rest are in the ledger.
            </p>
          )}
        </>
      )}
    </div>
  );
}

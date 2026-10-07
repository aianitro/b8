import CategorySelect from '@/components/CategorySelect';
import type { BudgetCategory } from '@b8/contracts/types';

export interface StatementRow {
  id: number;
  date: string;
  /** Plaid's sign: positive is money out. */
  amount: number;
  name: string | null;
  merchant_name: string | null;
  mapped_category: string | null;
  /** Running balance after this row; null where a running balance means nothing (valuation mode). */
  balance: number | null;
}

export interface StatementMonth {
  /** `YYYY-MM` */
  key: string;
  closingBalance: number | null;
  /** Newest first. */
  rows: StatementRow[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/**
 * The year's rows, newest month first, as a list rather than a table.
 *
 * A LIST BECAUSE OF THE PHONE. The five-column table this replaced was `table-fixed` with three
 * fixed widths summing past a 390px screen before the merchant column got anything. Two lines per
 * row — what and when on the left, how much and what it left on the right — is the shape every
 * banking app settles on, and it needs no second layout for the desktop.
 */
export default function AccountStatementList({ months, categories }: {
  months: StatementMonth[];
  categories: Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>[];
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {months.map((m) => (
        <section key={m.key} className="border-t border-slate-100 first:border-t-0">
          <div className="flex items-baseline justify-between px-4 sm:px-5 py-2 bg-slate-50 border-b border-slate-100">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {MONTHS[Number(m.key.slice(5, 7)) - 1]} {m.key.slice(0, 4)}
            </h3>
            {m.closingBalance !== null && (
              <p className="text-xs text-slate-400">
                Closed at <span className="font-mono text-slate-600">{fmt(m.closingBalance)}</span>
              </p>
            )}
          </div>
          <ul className="divide-y divide-slate-50">
            {m.rows.map((t) => {
              const isIncome = t.amount < 0;
              const title = t.merchant_name ?? t.name;
              return (
                // ONE GRID, TWO SHAPES. On a phone the picker drops under the payee beside the
                // date; from `sm` up it takes a column of its own, so a row is one line tall
                // instead of two and the year reads as a list rather than a stack of cards.
                <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_12rem_9rem] items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="col-start-1 row-start-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800 truncate">
                      {title ?? <span className="text-slate-300">—</span>}
                    </p>
                    <p className="hidden sm:block text-xs text-slate-400 mt-0.5">{shortDate(t.date)}</p>
                  </div>
                  <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1 flex items-center gap-2 min-w-0">
                    <span className="sm:hidden text-xs text-slate-400 whitespace-nowrap">{shortDate(t.date)}</span>
                    <div className="min-w-0 w-full max-w-[200px] sm:max-w-none">
                      <CategorySelect transactionId={t.id} current={t.mapped_category} categories={categories} description={t.name ?? t.merchant_name} />
                    </div>
                  </div>
                  <div className="col-start-2 row-start-1 row-span-2 sm:col-start-3 sm:row-span-1 text-right">
                    <p className={`font-mono font-semibold text-sm whitespace-nowrap ${isIncome ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {isIncome ? '+' : '−'}{fmt(Math.abs(t.amount))}
                    </p>
                    {t.balance !== null && (
                      <p className="font-mono text-xs text-slate-400 mt-0.5 whitespace-nowrap">{fmt(t.balance)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

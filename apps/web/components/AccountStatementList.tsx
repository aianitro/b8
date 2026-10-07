'use client';

import { useState } from 'react';
import CategorySelect from '@/components/CategorySelect';
import MerchantMark from '@/components/MerchantMark';
import SwipeDeleteRow from '@/components/SwipeDeleteRow';
import { detailLine, enrichmentDetail } from '@/lib/enrichedDisplay';
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
  /** Plaid's logo for the merchant, as stored. Untrusted: only `safeLogoUrl`'s output reaches an `img`. */
  logo_url: string | null;
  /** `YYYY-MM-DD` (selected `::text`), the day the card was authorised; `date` above is posted. */
  authorized_date: string | null;
  location_city: string | null;
  location_region: string | null;
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
/** Rows shown before "Show more", and how many each press adds. */
const PAGE = 10;

/**
 * The newest PAGE rows across months: whole months while they fit, then the newest part of the
 * month the limit falls in. Months left with no rows are dropped rather than shown as a bare header.
 */
function firstRows(months: StatementMonth[], limit: number): StatementMonth[] {
  const out: StatementMonth[] = [];
  let left = limit;
  for (const m of months) {
    if (left <= 0) break;
    out.push(m.rows.length <= left ? m : { ...m, rows: m.rows.slice(0, left) });
    left -= m.rows.length;
  }
  return out;
}

export default function AccountStatementList({ months, categories }: {
  months: StatementMonth[];
  categories: Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>[];
}) {
  // The latest PAGE rows first: the statement opens to "what happened lately", and a year of rows
  // under the chart pushed everything else on a phone screen several screens down.
  const [limit, setLimit] = useState(PAGE);
  const total = months.reduce((n, m) => n + m.rows.length, 0);
  const hidden = Math.max(0, total - limit);
  const shown = hidden > 0 ? firstRows(months, limit) : months;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {shown.map((m) => (
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
              const detail = detailLine(enrichmentDetail(t), shortDate);
              return (
                // ONE GRID, TWO SHAPES. On a phone the picker drops under the payee beside the
                // date; from `sm` up it takes a column of its own, so a row is one line tall
                // instead of two and the year reads as a list rather than a stack of cards.
                // Deleting is a swipe left on a phone and the trailing trash column above `sm`.
                //
                // THE MARK HAS A TRACK OF ITS OWN, exactly its width (1.75rem = 28px), rather than
                // sitting inside the title cell. A fixed track is what makes a logo, a placeholder
                // and a dead-URL fallback land on the same x with the title starting at the same x
                // after it; and on a phone it spans both lines, so the date and picker under the
                // payee start where the payee does instead of back under the logo. Every cell is
                // placed explicitly — the trash button SwipeDeleteRow appends is the only one left
                // to flow, into the last free cell of the first line, as before.
                <SwipeDeleteRow
                  key={t.id}
                  transactionId={t.id}
                  description={`${title ?? 'Transaction'} · ${shortDate(t.date)}`}
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:grid-cols-[1.75rem_minmax(0,1fr)_12rem_9rem_2rem] items-center gap-x-3 sm:gap-x-4 gap-y-1 px-4 sm:px-5 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="col-start-1 row-start-1 row-span-2 sm:row-span-1">
                    <MerchantMark logoUrl={t.logo_url} title={title} />
                  </div>
                  <div className="col-start-2 row-start-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800 truncate">
                      {title ?? <span className="text-slate-300">—</span>}
                    </p>
                    <p className="hidden sm:block text-xs text-slate-400 mt-0.5">{shortDate(t.date)}</p>
                    {/* Plain text, no hover — a phone has none. Not rendered at all when there is
                        nothing to say, so such a row is exactly as tall as before. */}
                    {detail !== null && <p className="text-xs text-slate-400 mt-0.5 truncate">{detail}</p>}
                  </div>
                  <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 flex items-center gap-2 min-w-0">
                    <span className="sm:hidden text-xs text-slate-400 whitespace-nowrap">{shortDate(t.date)}</span>
                    <div className="min-w-0 w-full max-w-[200px] sm:max-w-none">
                      <CategorySelect transactionId={t.id} current={t.mapped_category} categories={categories} description={t.name ?? t.merchant_name} />
                    </div>
                  </div>
                  <div className="col-start-3 row-start-1 row-span-2 sm:col-start-4 sm:row-span-1 text-right">
                    <p className={`font-mono font-semibold text-sm whitespace-nowrap ${isIncome ? 'text-emerald-600' : 'text-slate-800'}`}>
                      {isIncome ? '+' : '−'}{fmt(Math.abs(t.amount))}
                    </p>
                    {t.balance !== null && (
                      <p className="font-mono text-xs text-slate-400 mt-0.5 whitespace-nowrap">{fmt(t.balance)}</p>
                    )}
                  </div>
                </SwipeDeleteRow>
              );
            })}
          </ul>
        </section>
      ))}
      {(hidden > 0 || limit > PAGE) && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-3 border-t border-slate-100 text-sm">
          {hidden > 0 ? (
            <>
              <button type="button" onClick={() => setLimit(limit + PAGE)} className="font-medium text-blue-600 hover:text-blue-700 py-1">
                Show {Math.min(PAGE, hidden)} more
              </button>
              {hidden > PAGE && (
                <button type="button" onClick={() => setLimit(total)} className="text-slate-500 hover:text-slate-700 py-1">
                  Show all {total.toLocaleString()}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={() => setLimit(PAGE)} className="text-slate-500 hover:text-slate-700 py-1">
              Show fewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

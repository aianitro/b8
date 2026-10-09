export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import AccountBalanceEdit from '@/components/AccountBalanceEdit';
import AccountHeader from '@/components/AccountHeader';
import CashManagementCard from '@/components/CashManagementCard';
import StatementUpload from '@/components/StatementUpload';
import { walletStatuses } from '@/lib/cashCountStore';
import AccountStatementList, { type StatementMonth } from '@/components/AccountStatementList';
import AccountBalanceChart from '@/components/charts/AccountBalanceChart';
import { ledgerSeries, valuationSeries } from '@/lib/domain/balanceSeries';
import type { BudgetCategory } from '@b8/contracts/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/** The chart's longest range. Every shorter one is a slice of this, made on the client. */
const SERIES_DAYS = 365;

type AccountRow = {
  name: string; landscape: string; bank: string | null; mask: string | null;
  type: string; subtype: string | null; countable: boolean;
  valuation_mode: 'ledger' | 'valuation'; is_liability: boolean; linked: boolean;
};

type TxRow = {
  id: number; date: string; amount: string;
  name: string | null; merchant_name: string | null; mapped_category: string | null;
  // Plaid's enrichment (P6-40b), for the statement row's mark and detail line. Display only:
  // nothing below reads them, and the running balance is untouched by them.
  logo_url: string | null; authorized_date: string | null;
  location_city: string | null; location_region: string | null;
};

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // TODAY FROM THE DATABASE, not from `new Date()`. The rows are dated by Postgres, and a series
  // that ends on the server's idea of today while the rows use the database's would drop or
  // double a day whenever the two disagree about the zone.
  const today = (await db.query<{ today: string }>('SELECT CURRENT_DATE::text AS today')).rows[0].today;
  const year = Number(today.slice(0, 4));

  const [accountRes, balanceRes, txRes, valuationRes, categoriesRes] = await Promise.all([
    db.query<AccountRow>(
      'SELECT name, landscape, bank, mask, type, subtype, valuation_mode, is_liability, countable, access_token IS NOT NULL AS linked FROM accounts WHERE id = $1',
      [id]
    ),
    db.query<{ beginning_balance: string }>(
      'SELECT beginning_balance FROM account_balances WHERE account_id = $1 AND year = $2',
      [id, year]
    ),
    // From whichever is earlier, January 1st or a year ago: the statement needs the calendar year,
    // the chart needs twelve months back, and one query covers both. The authorized date is cast
    // to text like the posted one: a pg Date would not survive the trip to the client component,
    // and could not be compared with the posted date by equality.
    db.query<TxRow>(
      `SELECT id, date::text, amount::text, name, merchant_name, mapped_category,
              logo_url, authorized_date::text, location_city, location_region
       FROM transactions
       WHERE account_id = $1 AND date >= LEAST(make_date($2, 1, 1), CURRENT_DATE - $3::int)
       ORDER BY date ASC, id ASC`,
      [id, year, SERIES_DAYS]
    ),
    db.query<{ date: string; value: string }>(
      'SELECT valued_at::date::text AS date, value::text FROM account_valuations WHERE account_id = $1 ORDER BY valued_at',
      [id]
    ),
    db.query<Pick<BudgetCategory, 'name' | 'landscape' | 'exclude_from_budget'>>(
      'SELECT name, landscape, exclude_from_budget FROM budget_categories ORDER BY name'
    ),
  ]);

  const account = accountRes.rows[0];
  if (!account) {
    return <div className="p-4 sm:p-8 text-slate-400">Account not found.</div>;
  }

  const isValuation = account.valuation_mode === 'valuation';

  // Only a wallet pays for these two reads. Every other wallet is a place cash can be moved to,
  // and the categories are what a shortfall can be filed as: operational spending — not income,
  // not the transfer bucket, since cash that went missing was spent rather than moved.
  const cash = account.countable
    ? await Promise.all([
        walletStatuses(),
        db.query<{ name: string }>(
          `SELECT name FROM budget_categories
            WHERE landscape = 'operational' AND NOT is_income AND NOT exclude_from_budget
            ORDER BY name`
        ).then((r) => r.rows.map((c) => c.name)),
      ]).then(([wallets, spendCategories]) => ({
        lastCountedAt: wallets.find((w) => w.accountId === id)?.lastCountedAt ?? null,
        otherWallets: wallets.filter((w) => w.accountId !== id).map((w) => ({ accountId: w.accountId, name: w.name })),
        spendCategories,
      }))
    : null;
  const landscape = account.landscape === 'capital' ? 'capital' : 'operational';
  const beginningBalance = Number(balanceRes.rows[0]?.beginning_balance ?? 0);
  const flows = txRes.rows.map((t) => ({ ...t, amount: Number(t.amount) }));
  const yearRows = flows.filter((t) => t.date.startsWith(`${year}-`));

  // The statement: this year's rows with a running balance from the editable opening figure. The
  // same arithmetic as net worth's ledger balance, so the last row agrees with the chart's today.
  let running = beginningBalance;
  const monthMap = new Map<string, StatementMonth>();
  for (const t of yearRows) {
    running -= t.amount; // positive amount is money out
    const key = t.date.slice(0, 7);
    if (!monthMap.has(key)) monthMap.set(key, { key, closingBalance: null, rows: [] });
    const month = monthMap.get(key)!;
    month.rows.unshift({ ...t, balance: isValuation ? null : running });
    if (!isValuation) month.closingBalance = running;
  }
  const months = [...monthMap.values()].reverse();

  const ledgerToday = beginningBalance - yearRows.filter((t) => t.date <= today).reduce((s, t) => s + t.amount, 0);
  const points = isValuation
    ? valuationSeries(today, SERIES_DAYS, valuationRes.rows.map((v) => ({ date: v.date, value: Number(v.value) })))
    : ledgerSeries(ledgerToday, today, SERIES_DAYS, flows);

  const moneyIn  = yearRows.reduce((s, t) => s + Math.max(-t.amount, 0), 0);
  const moneyOut = yearRows.reduce((s, t) => s + Math.max(t.amount, 0), 0);
  const net = moneyIn - moneyOut;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <AccountHeader
        id={id}
        name={account.name}
        type={account.type}
        subtype={account.subtype}
        bank={account.bank}
        mask={account.mask}
        landscape={landscape}
        valuationMode={account.valuation_mode}
        isLiability={account.is_liability}
      />

      <AccountBalanceChart
        points={points}
        landscape={landscape}
        title={isValuation ? (account.is_liability ? 'Amount owed' : 'Current value') : 'Balance'}
      />

      {/* A hand-valued investment account is refreshed from its statement, here on its own page:
          the value, and the period's shares received. Never for a loan, and never for an account
          Plaid links — its balance arrives with every sync, and a typed-in figure would compete. */}
      {isValuation && !account.is_liability && !account.linked && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Update from a statement</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload the PDF to record its ending value and any shares received.
            </p>
          </div>
          <StatementUpload accountId={id} />
        </div>
      )}

      {/* ONE CARD, NOT THREE. Three side by side leave a 390px phone about 90px per figure, and a
          five-figure amount in a monospace face does not fit in that — it truncates, which on a
          money page is worse than wrapping. Below `sm` the three stack as rows; above, columns. */}
      {cash && (
        <CashManagementCard
          wallet={{ accountId: id, name: account.name }}
          lastCountedAt={cash.lastCountedAt}
          otherWallets={cash.otherWallets}
          categories={cash.spendCategories}
        />
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100 sm:grid sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
        {[
          { label: 'Money in',  text: moneyIn > 0 ? `+${fmt(moneyIn)}` : '—',   color: 'text-emerald-600' },
          { label: 'Money out', text: moneyOut > 0 ? `−${fmt(moneyOut)}` : '—', color: 'text-slate-800' },
          { label: 'Net',       text: net === 0 ? '—' : `${net > 0 ? '+' : '−'}${fmt(Math.abs(net))}`, color: net > 0 ? 'text-emerald-600' : 'text-slate-800' },
        ].map(({ label, text, color }) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3 sm:block sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label} · {year}</p>
            <p className={`font-mono font-semibold text-base sm:text-xl sm:mt-1 whitespace-nowrap ${color}`}>{text}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{year} statement</h2>
            <p className="text-sm text-slate-500">
              {yearRows.length.toLocaleString()} transaction{yearRows.length === 1 ? '' : 's'}
            </p>
          </div>
          {/* The figure the running balance starts from. Valuation-mode accounts have no running
              balance, so the control that sets its start would edit nothing visible. */}
          {!isValuation && (
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Opening balance</p>
              <AccountBalanceEdit accountId={id} value={beginningBalance} />
            </div>
          )}
        </div>
        {months.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center text-sm text-slate-400">
            No transactions yet for {year}.
          </div>
        ) : (
          <AccountStatementList months={months} categories={categoriesRes.rows} />
        )}
      </section>
    </div>
  );
}

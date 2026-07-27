export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import AccountBalanceEdit from '@/components/AccountBalanceEdit';
import BalancesTabsToggle from '@/components/BalancesTabsToggle';
import type { Landscape } from '@/shared/types';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtCompact = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtSigned = (n: number) =>
  (n >= 0 ? '+' : '−') + fmtCompact(Math.abs(n));

type AccountRow = { id: string; name: string; landscape: string; bank: string | null };

type AccountData = {
  id: string;
  name: string;
  landscape: string;
  bank: string | null;
  beginningBalance: number;
  monthlyBalance: (number | null)[];
  monthlyNet: number[];
  ytdNet: number;
  endingBalance: number;
};

const LANDSCAPE: Record<string, { label: string; bar: string }> = {
  operational: { label: 'Operational', bar: 'bg-blue-500' },
  capital:     { label: 'Capital',     bar: 'bg-violet-500' },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BalancesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const landscape: Landscape =
    params.landscape === 'capital' ? 'capital' : 'operational';

  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [accountsRes, netRes, balancesRes] = await Promise.all([
    db.query<AccountRow>(
      'SELECT id, name, landscape, bank FROM accounts WHERE track_transactions = TRUE AND landscape = $1 ORDER BY name',
      [landscape]
    ),
    db.query<{ account_id: string; month: number; net: string }>(`
      SELECT t.account_id,
             EXTRACT(MONTH FROM t.date)::int AS month,
             (COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
              - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0))::text AS net
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE AND a.landscape = $1
      WHERE EXTRACT(YEAR FROM t.date) = $2
      GROUP BY t.account_id, EXTRACT(MONTH FROM t.date)::int
    `, [landscape, year]),
    db.query<{ account_id: string; beginning_balance: string }>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1',
      [year]
    ),
  ]);

  const netByAccount = new Map<string, Map<number, number>>();
  for (const r of netRes.rows) {
    if (!netByAccount.has(r.account_id)) netByAccount.set(r.account_id, new Map());
    netByAccount.get(r.account_id)!.set(r.month, Number(r.net));
  }
  const beginningByAccount = new Map(balancesRes.rows.map((r) => [r.account_id, Number(r.beginning_balance)]));

  const accounts: AccountData[] = accountsRes.rows.map((a) => {
    const byMonth = netByAccount.get(a.id) ?? new Map();
    const beginning = beginningByAccount.get(a.id) ?? 0;
    let running = beginning;
    let ytdNet = 0;
    const monthlyNet: number[] = [];
    const monthlyBalance: (number | null)[] = [];

    for (let i = 0; i < 12; i++) {
      const net = byMonth.get(i + 1) ?? 0;
      monthlyNet.push(net);
      if (i <= currentMonth) {
        running += net;
        ytdNet  += net;
        monthlyBalance.push(running);
      } else {
        monthlyBalance.push(null);
      }
    }

    return { id: a.id, name: a.name, landscape: a.landscape, bank: a.bank, beginningBalance: beginning, monthlyBalance, monthlyNet, ytdNet, endingBalance: running };
  });

  const totalBeginning = accounts.reduce((s, a) => s + a.beginningBalance, 0);
  const totalEnding    = accounts.reduce((s, a) => s + a.endingBalance, 0);
  const totalYtdNet    = totalEnding - totalBeginning;
  const meta = LANDSCAPE[landscape];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Balances</h1>
        <p className="text-sm text-slate-500 mt-1">{year} · {MONTHS[currentMonth]} snapshot</p>
      </div>

      <BalancesTabsToggle current={landscape} />

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Beginning of Year', value: fmtCompact(totalBeginning), sub: 'Jan 1 opening',        color: 'text-slate-900' },
          { label: 'YTD Change',        value: fmtSigned(totalYtdNet),     sub: `through ${MONTHS[currentMonth]}`, color: totalYtdNet >= 0 ? 'text-emerald-600' : 'text-red-500' },
          { label: 'Current Balance',   value: fmtCompact(totalEnding),    sub: `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`, color: 'text-slate-900' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{label}</p>
            <p className={`text-3xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-1.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Account cards */}
      {accounts.length === 0 ? (
        <p className="text-slate-400 text-sm">No tracked accounts for this landscape.</p>
      ) : (
        <div className="space-y-3">
          {accounts.map((acct) => {
            const change = acct.endingBalance - acct.beginningBalance;
            const hasBalance = acct.beginningBalance !== 0;

            return (
              <div key={acct.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-1 h-8 rounded-full ${meta.bar}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`/accounts/${acct.id}`}
                          className="font-semibold text-slate-800 hover:text-blue-600 transition-colors underline decoration-slate-200 hover:decoration-blue-400 underline-offset-2"
                        >
                          {acct.name}
                        </a>
                        {acct.bank && <span className="text-xs text-slate-400">{acct.bank}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                        <span>Beginning</span>
                        <AccountBalanceEdit accountId={acct.id} value={acct.beginningBalance} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-right">
                    {hasBalance && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Change</p>
                        <p className={`font-mono font-semibold text-sm ${change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {fmtSigned(change)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Current</p>
                      <p className={`font-mono font-bold text-lg ${acct.endingBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                        {fmtCompact(acct.endingBalance)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Month timeline */}
                <div className="grid grid-cols-12 border-t border-slate-50">
                  {MONTHS.map((m, i) => {
                    const bal = acct.monthlyBalance[i];
                    const net = acct.monthlyNet[i];
                    const isFuture  = i > currentMonth;
                    const isCurrent = i === currentMonth;

                    return (
                      <a
                        key={i}
                        href={!isFuture ? `/accounts/${acct.id}` : undefined}
                        className={`flex flex-col items-center justify-center px-1 py-3 text-center border-r border-slate-50 last:border-r-0 transition-colors
                          ${isFuture ? 'cursor-default' : 'hover:bg-slate-50 cursor-pointer'}
                          ${isCurrent ? 'bg-blue-50/40' : ''}
                        `}
                      >
                        <span className={`text-[9px] font-semibold uppercase tracking-wider mb-1 ${isFuture ? 'text-slate-300' : isCurrent ? 'text-blue-500' : 'text-slate-400'}`}>
                          {m}
                        </span>
                        {!isFuture && bal !== null ? (
                          <>
                            <span className={`text-[10px] font-mono font-semibold leading-tight ${bal >= 0 ? 'text-slate-700' : 'text-red-500'}`}>
                              {fmtCompact(bal)}
                            </span>
                            {net !== 0 && (
                              <span className={`text-[9px] font-mono mt-0.5 ${net > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                                {fmtSigned(net)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-200">—</span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';
import db from '@/lib/db';
import AccountBalanceEdit from './AccountBalanceEdit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtSigned = (n: number) =>
  (n >= 0 ? '+' : '−') +
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));

type AccountRow = { id: string; name: string; landscape: string };

type MonthRow   = { account_id: string; month: number; income: string; expenses: string };
type BalanceRow = { account_id: string; beginning_balance: string };

type AccountData = {
  id: string;
  name: string;
  landscape: string;
  beginningBalance: number;
  months: { income: number; expenses: number; net: number; balance: number }[];
  ytdIncome: number;
  ytdExpenses: number;
  ytdNet: number;
  endingBalance: number;
};

const LANDSCAPE_BADGE: Record<string, string> = {
  operational: 'bg-blue-50 text-blue-600',
  capital:     'bg-violet-50 text-violet-600',
};

export default async function AccountBalancesSection({ landscape }: { landscape?: string } = {}) {
  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed

  const accountsQuery = landscape
    ? 'SELECT id, name, landscape FROM accounts WHERE track_transactions = TRUE AND landscape = $1 ORDER BY name'
    : 'SELECT id, name, landscape FROM accounts WHERE track_transactions = TRUE ORDER BY landscape, name';

  const [accountsResult, monthlyResult, balancesResult] = await Promise.all([
    db.query<AccountRow>(accountsQuery, landscape ? [landscape] : []),
    db.query<MonthRow>(`
      SELECT t.account_id,
             EXTRACT(MONTH FROM t.date)::int AS month,
             COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text AS income,
             COALESCE(SUM(t.amount)     FILTER (WHERE t.amount > 0), 0)::text  AS expenses
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
      WHERE EXTRACT(YEAR FROM t.date) = $1
      GROUP BY t.account_id, EXTRACT(MONTH FROM t.date)::int
    `, [year]),
    db.query<BalanceRow>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1',
      [year]
    ),
  ]);

  const beginningByAccount = new Map(
    balancesResult.rows.map((r) => [r.account_id, Number(r.beginning_balance)])
  );

  const monthlyByAccount = new Map<string, Map<number, { income: number; expenses: number }>>();
  for (const r of monthlyResult.rows) {
    if (!monthlyByAccount.has(r.account_id)) monthlyByAccount.set(r.account_id, new Map());
    monthlyByAccount.get(r.account_id)!.set(r.month, {
      income:   Number(r.income),
      expenses: Number(r.expenses),
    });
  }

  const accounts: AccountData[] = accountsResult.rows.map((a) => {
    const beginning = beginningByAccount.get(a.id) ?? 0;
    const byMonth = monthlyByAccount.get(a.id) ?? new Map();
    let runningBalance = beginning;
    let ytdIncome = 0, ytdExpenses = 0;

    const months = MONTHS.map((_, i) => {
      const m = byMonth.get(i + 1);
      const income   = m?.income   ?? 0;
      const expenses = m?.expenses ?? 0;
      const net = income - expenses;
      if (i <= currentMonth) {
        runningBalance += net;
        ytdIncome   += income;
        ytdExpenses += expenses;
      }
      return { income, expenses, net, balance: runningBalance };
    });

    const ytdNet = ytdIncome - ytdExpenses;
    return {
      id: a.id, name: a.name, landscape: a.landscape,
      beginningBalance: beginning,
      months,
      ytdIncome, ytdExpenses, ytdNet,
      endingBalance: beginning + ytdNet,
    };
  });

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
        Account Balances · {year}
      </h2>

      <div className="space-y-6">
        {accounts.map((account) => (
          <div key={account.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Link href={`/accounts/${account.id}`} className="font-semibold text-slate-800 hover:text-blue-600 underline decoration-slate-200 hover:decoration-blue-400 underline-offset-2 transition-colors">
                  {account.name}
                </Link>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANDSCAPE_BADGE[account.landscape] ?? ''}`}>
                  {account.landscape}
                </span>
              </div>
              <div className="flex items-center gap-8 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span>Beginning</span>
                  <AccountBalanceEdit accountId={account.id} value={account.beginningBalance} />
                </div>
                <div className="flex items-center gap-2">
                  <span>Ending</span>
                  <span className={`font-mono font-semibold text-sm ${account.endingBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                    {fmt(account.endingBalance)}
                  </span>
                </div>
              </div>
            </div>

            {/* Monthly table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400 w-20">Month</th>
                    <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wider text-slate-400">Income</th>
                    <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wider text-slate-400">Expenses</th>
                    <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wider text-slate-400">Net</th>
                    <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-wider text-slate-400">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {account.months.map((m, i) => {
                    const isFuture  = i > currentMonth;
                    const isCurrent = i === currentMonth;
                    const href = !isFuture
                      ? `/transactions?account=${account.id}&month=${i + 1}`
                      : undefined;

                    const row = (
                      <tr
                        key={i}
                        className={`border-b border-slate-50 last:border-0 transition-colors ${
                          isCurrent ? 'bg-blue-50/40' : isFuture ? '' : 'hover:bg-slate-50/60'
                        } ${href ? 'cursor-pointer' : ''}`}
                      >
                        <td className={`px-4 py-2.5 font-medium ${isFuture ? 'text-slate-300' : isCurrent ? 'text-blue-600 font-semibold' : 'text-slate-600'}`}>
                          {MONTHS[i]}
                          {isCurrent && <span className="ml-1 text-[9px] text-blue-400">now</span>}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${isFuture ? 'text-slate-200' : m.income > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                          {!isFuture && m.income > 0 ? fmt(m.income) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${isFuture ? 'text-slate-200' : m.expenses > 0 ? 'text-slate-700' : 'text-slate-300'}`}>
                          {!isFuture && m.expenses > 0 ? fmt(m.expenses) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-medium ${
                          isFuture ? 'text-slate-200' :
                          m.net > 0 ? 'text-emerald-600' :
                          m.net < 0 ? 'text-red-500' : 'text-slate-300'
                        }`}>
                          {!isFuture && m.net !== 0 ? fmtSigned(m.net) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${
                          isFuture ? 'text-slate-200' :
                          m.balance >= 0 ? 'text-slate-800' : 'text-red-600'
                        }`}>
                          {!isFuture ? fmt(m.balance) : '—'}
                        </td>
                      </tr>
                    );

                    return href ? (
                      <tr key={i} className={`border-b border-slate-50 last:border-0 transition-colors ${isCurrent ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'} cursor-pointer group`}>
                        <td className={`px-4 py-2.5 font-medium ${isCurrent ? 'text-blue-600 font-semibold' : 'text-slate-600'} group-hover:text-blue-600`}>
                          <a href={href} className="block w-full">
                            {MONTHS[i]}{isCurrent && <span className="ml-1 text-[9px] text-blue-400">now</span>}
                          </a>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${m.income > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                          <a href={href} className="block">{m.income > 0 ? fmt(m.income) : '—'}</a>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${m.expenses > 0 ? 'text-slate-700' : 'text-slate-300'}`}>
                          <a href={href} className="block">{m.expenses > 0 ? fmt(m.expenses) : '—'}</a>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-medium ${
                          m.net > 0 ? 'text-emerald-600' : m.net < 0 ? 'text-red-500' : 'text-slate-300'
                        }`}>
                          <a href={href} className="block">{m.net !== 0 ? fmtSigned(m.net) : '—'}</a>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono font-semibold ${m.balance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                          <a href={href} className="block">{fmt(m.balance)}</a>
                        </td>
                      </tr>
                    ) : row;
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="px-4 py-3 font-semibold text-slate-500 uppercase tracking-wider">YTD</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600">
                      {account.ytdIncome > 0 ? fmt(account.ytdIncome) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">
                      {account.ytdExpenses > 0 ? fmt(account.ytdExpenses) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${
                      account.ytdNet > 0 ? 'text-emerald-600' : account.ytdNet < 0 ? 'text-red-500' : 'text-slate-400'
                    }`}>
                      {account.ytdNet !== 0 ? fmtSigned(account.ytdNet) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${account.endingBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                      {fmt(account.endingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

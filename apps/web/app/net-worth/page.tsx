export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import db from '@/lib/db';
import { computeCurrentNetWorth } from '@/lib/netWorth';
import NetWorthTrendChart, { type NetWorthTrendPoint } from '@/components/charts/NetWorthTrendChart';
import NetWorthBreakdown, { type BreakdownComponent } from '@/components/NetWorthBreakdown';
// The delta is the domain function's, bound locally as `ytdDelta` for readability at the call
// site, and never recomputed on this page.
import { comparableYtdDelta as ytdDelta, groupRealEstateEquity, type NetWorthComponent, type SnapshotPoint } from '@/lib/domain/netWorth';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => (n < 0 ? `−${fmt(Math.abs(n))}` : fmt(n));

// Presentation metadata per component, including where each one's detail actually lives — the
// point of the page is that a total is a poor place to stop.
const COMPONENTS: { key: NetWorthComponent; label: string; href: string; hint: string; accent: string }[] = [
  { key: 'operational', label: 'Operational', href: '/accounts?landscape=operational', hint: 'Day-to-day cash and cards', accent: 'bg-blue-500' },
  { key: 'capitalFinancial', label: 'Capital', href: '/accounts?landscape=capital', hint: 'Savings, brokerage, retirement', accent: 'bg-violet-500' },
  { key: 'realEstateEquity', label: 'Real estate', href: '/properties', hint: 'Property value less its mortgage', accent: 'bg-emerald-500' },
  { key: 'liabilities', label: 'Other debt', href: '/accounts', hint: 'Loans not tied to a property', accent: 'bg-red-500' },
];

// The recorded history, in one read, for two consumers: the trend chart's labelled points and the
// year-to-date delta's comparability test.
//
// The ISO date comes from Postgres's own rendering of the DATE column. Converting the Date
// object instead resolves in UTC, which is the PREVIOUS day in every negative-offset zone — a
// wrong label on every point, and potentially a different baseline selected for the delta.
async function getSnapshots(): Promise<{ points: NetWorthTrendPoint[]; history: SnapshotPoint[] }> {
  const result = await db.query<{
    snapshot_date: Date; iso_date: string; operational: string; capital_financial: string;
    real_estate_equity: string; total: string; liabilities_security_deposits: string | null;
  }>(
    `SELECT snapshot_date, snapshot_date::text AS iso_date, operational, capital_financial,
            real_estate_equity, total, liabilities_security_deposits
       FROM net_worth_snapshots ORDER BY snapshot_date`
  );
  return {
    points: result.rows.map((r) => ({
      iso: r.iso_date,
      operational: Number(r.operational),
      // Deposits held netted into Capital, as the cards show it — see the note in the page body.
      // NULL marks a snapshot from before deposits were counted at all, so it nets nothing.
      capitalFinancial: Number(r.capital_financial) + Number(r.liabilities_security_deposits ?? 0),
      realEstateEquity: Number(r.real_estate_equity),
      total: Number(r.total),
    })),
    history: result.rows.map((r) => ({
      date: r.iso_date,
      total: Number(r.total),
      // NULL means the row was written before P0-09a began subtracting tenant security deposits,
      // and is therefore not the same measurement as today's total. Only its nullness is read.
      liabilitiesSecurityDeposits:
        r.liabilities_security_deposits === null ? null : Number(r.liabilities_security_deposits),
    })),
  };
}

async function getLabels() {
  const [accounts, properties] = await Promise.all([
    db.query<{ id: string; name: string }>('SELECT id, name FROM accounts'),
    db.query<{ id: number; nickname: string }>('SELECT id, nickname FROM properties'),
  ]);
  return {
    accounts: new Map(accounts.rows.map((r) => [r.id, r.name])),
    properties: new Map(properties.rows.map((r) => [String(r.id), r.nickname])),
  };
}

export default async function NetWorthPage() {
  const [netWorth, snapshots, labels] = await Promise.all([
    computeCurrentNetWorth(), getSnapshots(), getLabels(),
  ]);

  // The year-to-date movement, measured within ONE definition of the figure it moves. NITS N2 lived
  // on the dashboard's version of this card, which took the earliest snapshot of the year whatever
  // era it was written in — understating growth by exactly the deposits held, with no symptom.
  // Null, never 0: a zero would assert that net worth did not move.
  const ytd = ytdDelta(netWorth.total, snapshots.history);

  // TENANT DEPOSITS ARE SHOWN UNDER CAPITAL, not as "Other debt" — the owner's call. The deposit
  // cash sits in each property's trust checking account, which is a Capital account, so the
  // domain function counts it there in full and books the obligation to repay it as a negative
  // liability. Correct, and it summed right, but it read as cash in one card and a mysterious
  // debt in another. Netting the obligation inside Capital puts the adjustment beside the money
  // it adjusts, and leaves "Other debt" for loans tied to no property — of which there may be none.
  //
  // PRESENTATION ONLY. `computeNetWorth` and the stored snapshots are untouched, so the total, the
  // year-to-date comparison and every snapshot keep the definition they were written under; the
  // move is `liabilitiesSecurityDeposits` added to one side and taken from the other.
  const deposits = netWorth.liabilitiesSecurityDeposits; // negative, or 0
  const amountOf = (k: NetWorthComponent) =>
    k === 'operational' ? netWorth.operational
      : k === 'capitalFinancial' ? netWorth.capitalFinancial + deposits
      : k === 'realEstateEquity' ? netWorth.realEstateEquity
      : netWorth.liabilities - deposits;

  // Contributions come from the domain function rather than being re-derived here, so this page
  // can never disagree with the dashboard about which account belongs to which component. The one
  // reassignment is the deposits above: a `property` line in `liabilities` is a deposit held.
  const isDeposit = (c: (typeof netWorth.contributions)[number]) => c.component === 'liabilities' && c.kind === 'property';
  const byComponent = new Map<NetWorthComponent, typeof netWorth.contributions>();
  for (const c of netWorth.contributions) {
    const component = isDeposit(c) ? 'capitalFinancial' : c.component;
    if (!byComponent.has(component)) byComponent.set(component, []);
    byComponent.get(component)!.push(isDeposit(c) ? { ...c, component } : c);
  }

  const unvaluedNames = netWorth.unvaluedPropertyIds.map((id) => labels.properties.get(String(id)) ?? `Property ${id}`);

  // Real estate is the one component where an asset and its financing are split across two
  // separate contributions (the property's value, its mortgage's balance) — everywhere else a
  // contribution already IS the whole line. groupRealEstateEquity() merges each property's
  // pair into one net-equity line, so "Rental A" shows once, at its equity, not as a value line
  // and a mortgage line a reader has to net in their head.
  const realEstateLines = groupRealEstateEquity(netWorth.contributions).map((l) => ({
    kind: 'property' as const,
    id: String(l.propertyId),
    value: l.value,
    name: labels.properties.get(String(l.propertyId)) ?? `Property ${l.propertyId}`,
    href: `/properties/${l.propertyId}`,
  }));

  // Names/hrefs resolved here, server-side, so NetWorthBreakdown stays a small client
  // component with no need for the accounts/properties label maps of its own.
  const breakdownComponents: BreakdownComponent[] = COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    accent: c.accent,
    amount: amountOf(c.key),
    lines: c.key === 'realEstateEquity'
      ? realEstateLines
      : (byComponent.get(c.key) ?? []).map((l) => ({
          kind: l.kind,
          id: l.id,
          value: l.value,
          // A property line outside real estate is a deposit held, so it says so.
          name: l.kind === 'property'
            ? `Tenant deposit · ${labels.properties.get(l.id) ?? `Property ${l.id}`}`
            : labels.accounts.get(l.id) ?? l.id,
          href: l.kind === 'property' ? `/properties/${l.id}` : `/accounts/${l.id}`,
        })),
  }));

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Net Worth</h1>
      </div>

      <div className="bg-slate-900 rounded-2xl shadow-sm p-8 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total</p>
        <p className={`text-5xl font-bold mt-2 font-mono ${netWorth.total < 0 ? 'text-red-400' : 'text-white'}`}>
          {fmt(netWorth.total)}
        </p>
        <div data-testid="ytd-delta" className="flex items-center gap-2 mt-3 text-sm">
          {ytd !== null ? (
            <>
              <span className={`font-mono font-medium ${ytd.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ytd.delta >= 0 ? '+' : ''}{fmt(ytd.delta)}
              </span>
              <span className="text-slate-500">
                since {ytd.sinceDate}
                {/* The window is disclosed rather than assumed: "since March" and "since January"
                    are different claims about the same dollar figure, and the older rows were
                    skipped for a stated reason. */}
                {ytd.excludedPreCutoverCount > 0 && (
                  <> · {ytd.excludedPreCutoverCount} earlier{' '}
                    {ytd.excludedPreCutoverCount === 1 ? 'reading' : 'readings'} predate the deposit
                    decomposition and are not comparable</>
                )}
              </span>
            </>
          ) : (
            <span className="text-slate-500">First recorded reading — a trend appears once more are collected</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Ledger balances, recorded valuations, and real-estate equity — the parts below sum to this exactly.
        </p>
      </div>

      {unvaluedNames.length > 0 && (
        <div className="flex items-start gap-2.5 border border-amber-200 bg-amber-50 rounded-2xl p-4 mb-6">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <span className="font-semibold">{unvaluedNames.join(', ')}</span>{' '}
            {unvaluedNames.length === 1 ? 'has' : 'have'} no recorded valuation, so {unvaluedNames.length === 1 ? 'it is' : 'they are'} excluded
            entirely — along with any mortgage against {unvaluedNames.length === 1 ? 'it' : 'them'}. Counting the debt without the
            asset would understate net worth badly, so neither side is counted.{' '}
            <Link href="/properties" className="underline">Add a valuation</Link>.
          </p>
        </div>
      )}

      {/* STACKED ON A PHONE, the accounts page's summary-card shape: one line per part, label and
          hint left, figure right. Four columns at every width gave each card about 80px at 390,
          and a six-figure balance overflowed it while the hint wrapped a word per line. Two across
          from `sm:`, four from `lg:`, where the original layout fits. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6">
        {COMPONENTS.map((c) => {
          const amount = amountOf(c.key);
          const lines = byComponent.get(c.key) ?? [];
          if (c.key === 'liabilities' && amount === 0 && lines.length === 0) return null;
          return (
            <Link
              key={c.key}
              href={c.href}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 sm:p-5 flex items-center justify-between gap-3 sm:block hover:border-slate-200 hover:shadow transition-all"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 sm:mb-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.accent}`} />
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.label}</p>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 sm:hidden">{c.hint}</p>
              </div>
              <p className={`text-lg sm:text-xl font-mono font-semibold shrink-0 ${amount < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {signed(amount)}
              </p>
              <p className="hidden sm:block text-[10px] text-slate-400 mt-1.5">{c.hint}</p>
            </Link>
          );
        })}
      </div>

      <div className="mb-6">
        <NetWorthTrendChart data={snapshots.points} />
      </div>

      <NetWorthBreakdown components={breakdownComponents} />
    </div>
  );
}

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import db from '@/lib/db';
import PropertyEditForm from '@/components/PropertyEditForm';
import PropertyValuationHistory, { type ValuationRow } from '@/components/PropertyValuationHistory';
import PropertyValueChart, { type PropertyValuePoint } from '@/components/charts/PropertyValueChart';
import PropertyLinkedAccounts, { type LinkableAccount } from '@/components/PropertyLinkedAccounts';
import PropertyPnlCard from '@/components/PropertyPnlCard';
import { computePropertyPnl, type PnlTransaction } from '@/lib/domain/propertyPnl';
import { toDateInputValue, valueAsOf } from '@/lib/domain/property';
import type { Property, PropertyType } from '@/shared/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

interface Series { value: number; valuedAt: string }

// The shapes node-postgres actually returns, which differ from the Property interface: NUMERIC
// arrives as a string (the driver refuses to risk float precision loss) and DATE/TIMESTAMPTZ as
// a Date. Mapping here rather than casting keeps Property honest for every consumer downstream.
interface PropertyRow {
  id: number;
  nickname: string;
  address: string | null;
  type: PropertyType;
  purchase_price: string | null;
  purchase_date: Date | null;
  cost_basis: string | null;
}

const numeric = (v: string | null): number | null => (v === null ? null : Number(v));

async function getProperty(id: string): Promise<Property | null> {
  const result = await db.query<PropertyRow>(
    `SELECT id, nickname, address, type, purchase_price, purchase_date, cost_basis
       FROM properties WHERE id = $1`,
    [id]
  );
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    nickname: r.nickname,
    address: r.address,
    type: r.type,
    purchase_price: numeric(r.purchase_price),
    purchase_date: r.purchase_date === null ? null : toDateInputValue(r.purchase_date),
    cost_basis: numeric(r.cost_basis),
  };
}

async function getValuations(id: string): Promise<ValuationRow[]> {
  const result = await db.query<{ id: number; value: string; valued_at: Date }>(
    'SELECT id, value, valued_at FROM property_valuations WHERE property_id = $1 ORDER BY valued_at DESC',
    [id]
  );
  // Serialized to ISO here so the client component receives the string its prop type promises.
  return result.rows.map((r) => ({ id: r.id, value: Number(r.value), valuedAt: r.valued_at.toISOString() }));
}

// Every account eligible to be this property's mortgage: valuation-mode liabilities that are
// either unlinked or already linked here. Scoping lives in the query rather than the DB — see
// the note on PATCH /api/accounts/[id]'s property_id handling.
// Balance is resolved per account's own regime: a valuation-mode account (a mortgage) reports
// its latest recorded valuation, a ledger one its opening balance plus this year's transactions
// — the same two-regime rule computeNetWorthBreakdown() applies, so the figures shown here
// cannot disagree with the ones on /net-worth.
async function getLinkableAccounts(propertyId: string, year: number) {
  const result = await db.query<{
    id: string; name: string; is_liability: boolean; property_id: number | null;
    valuation_mode: string; balance: string | null;
  }>(
    `SELECT a.id, a.name, a.is_liability, a.property_id, a.valuation_mode,
            CASE WHEN a.valuation_mode = 'valuation'
                 THEN (SELECT v.value FROM account_valuations v
                        WHERE v.account_id = a.id ORDER BY v.valued_at DESC LIMIT 1)
                 ELSE COALESCE((SELECT b.beginning_balance FROM account_balances b
                                 WHERE b.account_id = a.id AND b.year = $2), 0)
                    + COALESCE((SELECT SUM(-t.amount) FROM transactions t
                                 WHERE t.account_id = a.id AND EXTRACT(YEAR FROM t.date) = $2), 0)
            END AS balance
       FROM accounts a
      WHERE a.property_id IS NULL OR a.property_id = $1
      ORDER BY a.is_liability DESC, a.name`,
    [propertyId, year]
  );
  return result.rows;
}

// Transactions attributed to this property: everything in its linked accounts for the year.
// Debt service is flagged from the account rather than the category so a mortgage payment is
// kept out of operating expenses even when it is categorized generically.
async function getPnlTransactions(propertyId: string, year: number): Promise<PnlTransaction[]> {
  const result = await db.query<{ mapped_category: string | null; amount: string; is_liability: boolean }>(
    `SELECT t.mapped_category, t.amount, a.is_liability
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.property_id = $1 AND EXTRACT(YEAR FROM t.date) = $2 AND t.hidden = FALSE`,
    [propertyId, year]
  );
  return result.rows.map((r) => ({
    category: r.mapped_category,
    amount: Number(r.amount),
    isDebtService: r.is_liability,
  }));
}

async function getMortgageBalances(accountId: string): Promise<Series[]> {
  const result = await db.query<{ value: string; valued_at: Date }>(
    'SELECT value, valued_at FROM account_valuations WHERE account_id = $1 ORDER BY valued_at',
    [accountId]
  );
  return result.rows.map((r) => ({ value: Number(r.value), valuedAt: r.valued_at.toISOString() }));
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const year = new Date().getFullYear();

  const [property, valuations, linkableAccounts, pnlTransactions] = await Promise.all([
    getProperty(id), getValuations(id), getLinkableAccounts(id, year), getPnlTransactions(id, year),
  ]);

  if (!property) notFound();

  // The mortgage drives the equity chart; any linked liability account counts as one.
  const linked = linkableAccounts.find((a) => a.property_id !== null && a.is_liability) ?? null;
  const mortgageBalances = linked ? await getMortgageBalances(linked.id) : [];

  const accountsForLinking: LinkableAccount[] = linkableAccounts.map((a) => ({
    id: a.id, name: a.name, isLiability: a.is_liability, linked: a.property_id !== null,
    balance: a.balance === null ? null : Number(a.balance),
  }));

  // Operating cash: the linked non-liability accounts. Reported alongside equity rather than
  // folded into it — cash is liquid and equity is not, and adding them would make "equity" stop
  // meaning what you would net on a sale, which the P&L's total-return math depends on.
  const operatingCash = linkableAccounts
    .filter((a) => a.property_id !== null && !a.is_liability && a.balance !== null)
    .reduce((sum, a) => sum + Number(a.balance), 0);
  const hasOperatingCash = linkableAccounts.some((a) => a.property_id !== null && !a.is_liability);

  // Appreciation is measured between the first and last valuation recorded *within the year*,
  // so it reflects this year's movement rather than the whole history. One reading gives no
  // movement to measure, which computePropertyPnl reports as unknown rather than zero.
  const thisYear = valuations
    .filter((v) => new Date(v.valuedAt).getFullYear() === year)
    .sort((a, b) => new Date(a.valuedAt).getTime() - new Date(b.valuedAt).getTime());
  const pnl = computePropertyPnl(
    pnlTransactions,
    thisYear.length >= 2 ? thisYear[0].value : null,
    thisYear.length >= 2 ? thisYear[thisYear.length - 1].value : null
  );

  // Oldest-first for the chart; the history list below stays newest-first, which is the more
  // useful order for spotting and correcting a bad entry.
  const chartData: PropertyValuePoint[] = [...valuations]
    .sort((a, b) => new Date(a.valuedAt).getTime() - new Date(b.valuedAt).getTime())
    .map((v) => {
      const mortgage = mortgageBalances.length > 0 ? valueAsOf(mortgageBalances, v.valuedAt) : null;
      return {
        date: new Date(v.valuedAt).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        value: v.value,
        mortgage,
        equity: mortgage === null ? null : v.value - mortgage,
      };
    });

  const latest = chartData.at(-1) ?? null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/properties" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-4 transition-colors">
        <ArrowLeft size={13} />
        Properties
      </Link>

      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{property.nickname}</h1>
          <p className="text-sm text-slate-500 mt-1">{property.address || 'No address'}</p>
        </div>
        {latest && (
          <div className="flex items-center gap-6 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Value</p>
              <p className="text-lg font-mono font-semibold text-slate-800">{fmt(latest.value)}</p>
            </div>
            {latest.mortgage !== null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Mortgage</p>
                <p className="text-lg font-mono font-semibold text-red-500">−{fmt(latest.mortgage)}</p>
              </div>
            )}
            {latest.equity !== null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Equity</p>
                <p className="text-lg font-mono font-semibold text-violet-600">{fmt(latest.equity)}</p>
              </div>
            )}
            {hasOperatingCash && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Operating cash</p>
                <p className="text-lg font-mono font-semibold text-slate-600">{fmt(operatingCash)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <PropertyValueChart data={chartData} />
      </div>

      <div className="grid grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <PropertyEditForm property={property} />
          <PropertyLinkedAccounts propertyId={property.id} accounts={accountsForLinking} />
        </div>
        <div className="space-y-6">
          <PropertyPnlCard pnl={pnl} year={year} />
          <PropertyValuationHistory propertyId={property.id} rows={valuations} />
        </div>
      </div>
    </div>
  );
}

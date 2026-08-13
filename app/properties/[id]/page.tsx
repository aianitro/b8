export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import db from '@/lib/db';
import PropertyEditModal from '@/components/PropertyEditModal';
import { type ValuationRow } from '@/components/PropertyValuationHistory';
import { type PropertyValuePoint } from '@/components/charts/PropertyValueChart';
import PropertyValueCard from '@/components/PropertyValueCard';
import PropertyLinkedAccounts, { type LinkableAccount } from '@/components/PropertyLinkedAccounts';
import PropertyPnlCard from '@/components/PropertyPnlCard';
import PropertyLedgerCard from '@/components/PropertyLedgerCard';
import { computePropertyPnl, toPnlTransaction, type PnlTransaction } from '@/lib/domain/propertyPnl';
import { buildPropertyLedger, type LedgerInput } from '@/lib/domain/propertyLedger';
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

// Transactions attributed to this property: everything in its linked accounts for the year,
// plus anything tagged to it directly. COALESCE(t.property_id, a.property_id) makes the
// explicit tag win and the account supply the default — so a payment made from an account that
// belongs to a different property (or none) still reaches the right statement. See the
// property-transaction-attribution migration for why the account alone was not enough.
//
// Debt service resolves from the account OR the category — a Plaid-linked mortgage puts its
// payments on an is_liability account, a manual one puts them on the rental's operating account
// where only the category can identify them. See PnlTransaction.isDebtService.
//
// Transfers are excluded via exclude_from_budget, the same convention the dashboard uses: moving
// money from savings into the rental's operating account is not rental income, and counting it
// as such inflated Gastonia's gross income by the size of whatever float was moved that year.
//
// Both category lookups are EXISTS rather than a JOIN on purpose. mapped_category is not an FK
// and budget_categories is UNIQUE(name, landscape), so a name living in both landscapes would
// match twice and a JOIN would silently duplicate the transaction row — double-counting it in
// the totals. EXISTS asks the yes/no question without multiplying rows. Matching on name alone
// (not name + landscape) is deliberate too: "Transfer" is defined only in the operational
// landscape but is applied to capital accounts, so landscape-scoping it would stop excluding
// exactly the transfers this is meant to drop.
async function getPnlTransactions(propertyId: string, year: number): Promise<PnlTransaction[]> {
  const result = await db.query<{
    mapped_category: string | null; amount: string;
    on_liability_account: boolean; in_debt_service_category: boolean;
  }>(
    `SELECT t.mapped_category, t.amount,
            a.is_liability AS on_liability_account,
            EXISTS (SELECT 1 FROM budget_categories bc
                     WHERE bc.name = t.mapped_category AND bc.is_debt_service)
              AS in_debt_service_category
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE COALESCE(t.property_id, a.property_id) = $1
        AND EXTRACT(YEAR FROM t.date) = $2 AND t.hidden = FALSE
        AND NOT EXISTS (SELECT 1 FROM budget_categories bc
                         WHERE bc.name = t.mapped_category AND bc.exclude_from_budget)`,
    [propertyId, year]
  );
  // Both signals go to the domain layer rather than being resolved in SQL, because the account
  // also determines the amount's sign convention — the two decisions are one decision.
  return result.rows.map((r) =>
    toPnlTransaction({
      category: r.mapped_category,
      amount: Number(r.amount),
      onLiabilityAccount: r.on_liability_account,
      inDebtServiceCategory: r.in_debt_service_category,
    })
  );
}

// The ledger's row set is deliberately WIDER than the P&L's: it keeps transfers, which the P&L
// drops. Moving $3,120 from savings into the rental's new checking account is not income and
// must never reach the P&L — but it is unquestionably a movement of this property's cash, and
// a ledger that hid it would fail to reconcile against the bank, which is its only job.
async function getLedgerTransactions(propertyId: string, year: number): Promise<LedgerInput[]> {
  const result = await db.query<{
    id: number; date: Date; name: string | null; merchant_name: string | null;
    mapped_category: string | null; amount: string; account_name: string; tagged_directly: boolean;
  }>(
    `SELECT t.id, t.date, t.name, t.merchant_name, t.mapped_category, t.amount,
            a.name AS account_name,
            (t.property_id IS NOT NULL) AS tagged_directly
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE COALESCE(t.property_id, a.property_id) = $1
        AND EXTRACT(YEAR FROM t.date) = $2 AND t.hidden = FALSE
      ORDER BY t.date, t.id`,
    [propertyId, year]
  );
  return result.rows.map((r) => ({
    id: r.id,
    date: toDateInputValue(r.date),
    description: r.merchant_name || r.name || '—',
    category: r.mapped_category,
    amount: Number(r.amount),
    accountName: r.account_name,
    taggedDirectly: r.tagged_directly,
  }));
}

async function getBeginningBalance(propertyId: string, year: number): Promise<number> {
  const result = await db.query<{ beginning_balance: string }>(
    'SELECT beginning_balance FROM property_balances WHERE property_id = $1 AND year = $2',
    [propertyId, year]
  );
  return result.rows.length > 0 ? Number(result.rows[0].beginning_balance) : 0;
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

  const [property, valuations, linkableAccounts, pnlTransactions, ledgerTransactions, beginningBalance] =
    await Promise.all([
      getProperty(id), getValuations(id), getLinkableAccounts(id, year), getPnlTransactions(id, year),
      getLedgerTransactions(id, year), getBeginningBalance(id, year),
    ]);

  if (!property) notFound();

  // The mortgage drives the equity chart; any linked liability account counts as one.
  const linked = linkableAccounts.find((a) => a.property_id !== null && a.is_liability) ?? null;
  const mortgageBalances = linked ? await getMortgageBalances(linked.id) : [];

  const accountsForLinking: LinkableAccount[] = linkableAccounts.map((a) => ({
    id: a.id, name: a.name, isLiability: a.is_liability, linked: a.property_id !== null,
    balance: a.balance === null ? null : Number(a.balance),
  }));


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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{property.nickname}</h1>
            <PropertyEditModal property={property} />
          </div>
          <p className="text-sm text-slate-500 mt-1">{property.address || 'No address'}</p>
        </div>
        {/* One figure, not four. Value and Mortgage are the *inputs* to equity, not its peers —
            given equal weight they read as four unrelated facts to reconcile. Equity leads;
            its derivation sits underneath in small text where it explains rather than competes.
            A mortgage-free property skips the derivation entirely and simply reports its value,
            since "$1,551,992 less $0 mortgage" is noise. Operating cash moved to the linked
            accounts card, which already lists the very accounts it totals. */}
        {latest && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {latest.mortgage !== null ? 'Equity' : 'Value'}
            </p>
            <p className="text-3xl font-mono font-semibold text-slate-900 leading-tight">
              {fmt(latest.mortgage !== null ? (latest.equity ?? 0) : latest.value)}
            </p>
            {latest.mortgage !== null && (
              <p className="text-[11px] text-slate-400 mt-1">
                {fmt(latest.value)} value − {fmt(latest.mortgage)} mortgage
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <PropertyValueCard propertyId={property.id} chartData={chartData} rows={valuations} />
      </div>

      <div className="grid grid-cols-2 gap-6 items-start">
        <PropertyPnlCard pnl={pnl} year={year} />
        <PropertyLinkedAccounts propertyId={property.id} accounts={accountsForLinking} />
      </div>

      {/* Below the P&L, not beside it: the P&L is the summary and this is its evidence, so the
          reading order is conclusion first, then the rows it was drawn from. Full width because
          a ledger with a wrapped description column is unreadable. */}
      <div className="mt-6">
        <PropertyLedgerCard
          propertyId={property.id}
          year={year}
          ledger={buildPropertyLedger(beginningBalance, ledgerTransactions)}
        />
      </div>
    </div>
  );
}

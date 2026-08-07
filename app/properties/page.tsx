export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import AddPropertyForm from '@/components/AddPropertyForm';
import PropertyValuationEdit from '@/components/PropertyValuationEdit';
import PropertyMortgageLink from '@/components/PropertyMortgageLink';
import { computePropertyEquity, latestValuationByProperty } from '@/lib/domain/property';
import { latestValuationByAccount } from '@/lib/domain/valuation';
import type { Property } from '@/shared/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

interface MortgageAccount { id: string; name: string; propertyId: number | null; }

async function getProperties(): Promise<Property[]> {
  const result = await db.query<Property>(
    `SELECT id, nickname, address, type, purchase_price, purchase_date, cost_basis
       FROM properties ORDER BY type, nickname`
  );
  return result.rows;
}

// Liability, valuation-mode accounts are the only ones a mortgage link makes sense for — see
// the note on PATCH /api/accounts/[id]'s property_id handling for why that scoping lives here
// rather than as a DB constraint (step 9's per-property P&L will want other account types
// linked too, via the same nullable FK).
async function getMortgageAccounts(): Promise<MortgageAccount[]> {
  const result = await db.query<{ id: string; name: string; property_id: number | null }>(
    `SELECT id, name, property_id FROM accounts
      WHERE valuation_mode = 'valuation' AND is_liability = TRUE
      ORDER BY name`
  );
  return result.rows.map((r) => ({ id: r.id, name: r.name, propertyId: r.property_id }));
}

async function getLatestPropertyValuations(): Promise<Map<number, number>> {
  const result = await db.query<{ property_id: number; value: string; valued_at: string }>(
    'SELECT property_id, value, valued_at FROM property_valuations'
  );
  return latestValuationByProperty(
    result.rows.map((r) => ({ propertyId: r.property_id, value: Number(r.value), valuedAt: r.valued_at }))
  );
}

// Mortgage balances come from account_valuations (a mortgage is an ordinary valuation-mode
// liability account, not part of the properties schema) — same "latest wins" reducer the
// dashboard uses for every other valuation-mode account.
async function getLatestMortgageBalances(accountIds: string[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const result = await db.query<{ account_id: string; value: string; valued_at: string }>(
    'SELECT account_id, value, valued_at FROM account_valuations WHERE account_id = ANY($1)',
    [accountIds]
  );
  return latestValuationByAccount(
    result.rows.map((r) => ({ accountId: r.account_id, value: Number(r.value), valuedAt: r.valued_at }))
  );
}

export default async function PropertiesPage() {
  const [properties, mortgageAccounts] = await Promise.all([getProperties(), getMortgageAccounts()]);

  const [latestPropertyValuations, mortgageBalanceByAccount] = await Promise.all([
    getLatestPropertyValuations(),
    getLatestMortgageBalances(mortgageAccounts.map((a) => a.id)),
  ]);

  const mortgageByProperty = new Map(mortgageAccounts.filter((a) => a.propertyId !== null).map((a) => [a.propertyId as number, a]));
  const unlinkedMortgages = mortgageAccounts.filter((a) => a.propertyId === null);

  const mortgageBalanceByProperty = new Map(
    [...mortgageByProperty].map(([propertyId, acct]) => [propertyId, mortgageBalanceByAccount.get(acct.id) ?? 0])
  );

  const equity = computePropertyEquity(
    properties.map((p) => ({ id: p.id, nickname: p.nickname })),
    latestPropertyValuations,
    mortgageBalanceByProperty
  );
  const equityByProperty = new Map(equity.map((e) => [e.propertyId, e]));

  const totalEquity = equity.reduce((sum, e) => sum + (e.equity ?? 0), 0);
  const unvaluedCount = equity.filter((e) => e.value === null).length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Properties</h1>
          <p className="text-sm text-slate-500 mt-1">
            {properties.length === 0
              ? 'No properties yet'
              : `${fmt(totalEquity)} total equity${unvaluedCount > 0 ? ` · ${unvaluedCount} unvalued` : ''}`}
          </p>
        </div>
        <AddPropertyForm />
      </div>

      {properties.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-slate-400 text-sm">No properties yet. Add your primary residence or a rental.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {properties.map((p, i) => {
            const e = equityByProperty.get(p.id);
            const linkedAccount = mortgageByProperty.get(p.id) ?? null;
            return (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-4 px-6 py-4 ${i < properties.length - 1 ? 'border-b border-slate-50' : ''}`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-1 h-8 rounded-full shrink-0 bg-violet-500" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-slate-800 truncate">{p.nickname}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        p.type === 'primary' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'
                      }`}>
                        {p.type}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {p.address || 'No address'}
                      {p.purchase_price !== null && ` · purchased ${fmt(p.purchase_price)}`}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Value</p>
                  <PropertyValuationEdit propertyId={p.id} current={e?.value ?? null} />
                </div>

                {linkedAccount && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Mortgage</p>
                    <span className="text-xs font-mono text-red-500">−{fmt(e?.mortgageBalance ?? 0)}</span>
                  </div>
                )}

                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Equity</p>
                  <span className="text-xs font-mono font-semibold text-slate-700">
                    {e?.equity !== null && e?.equity !== undefined ? fmt(e.equity) : '—'}
                  </span>
                </div>

                <PropertyMortgageLink
                  propertyId={p.id}
                  linkedAccount={linkedAccount}
                  unlinkedCandidates={unlinkedMortgages}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

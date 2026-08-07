export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import db from '@/lib/db';
import PropertyEditForm from '@/components/PropertyEditForm';
import PropertyValuationHistory, { type ValuationRow } from '@/components/PropertyValuationHistory';
import PropertyValueChart, { type PropertyValuePoint } from '@/components/charts/PropertyValueChart';
import { valueAsOf } from '@/lib/domain/property';
import type { Property } from '@/shared/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

interface Series { value: number; valuedAt: string }

async function getProperty(id: string): Promise<Property | null> {
  const result = await db.query<Property>(
    `SELECT id, nickname, address, type, purchase_price, purchase_date, cost_basis
       FROM properties WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function getValuations(id: string): Promise<ValuationRow[]> {
  const result = await db.query<{ id: number; value: string; valued_at: string }>(
    'SELECT id, value, valued_at FROM property_valuations WHERE property_id = $1 ORDER BY valued_at DESC',
    [id]
  );
  return result.rows.map((r) => ({ id: r.id, value: Number(r.value), valuedAt: r.valued_at }));
}

// Every account eligible to be this property's mortgage: valuation-mode liabilities that are
// either unlinked or already linked here. Scoping lives in the query rather than the DB — see
// the note on PATCH /api/accounts/[id]'s property_id handling.
async function getMortgageOptions(propertyId: string) {
  const result = await db.query<{ id: string; name: string; property_id: number | null }>(
    `SELECT id, name, property_id FROM accounts
      WHERE valuation_mode = 'valuation' AND is_liability = TRUE
        AND (property_id IS NULL OR property_id = $1)
      ORDER BY name`,
    [propertyId]
  );
  return result.rows;
}

async function getMortgageBalances(accountId: string): Promise<Series[]> {
  const result = await db.query<{ value: string; valued_at: string }>(
    'SELECT value, valued_at FROM account_valuations WHERE account_id = $1 ORDER BY valued_at',
    [accountId]
  );
  return result.rows.map((r) => ({ value: Number(r.value), valuedAt: r.valued_at }));
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [property, valuations, mortgageOptions] = await Promise.all([
    getProperty(id), getValuations(id), getMortgageOptions(id),
  ]);

  if (!property) notFound();

  const linked = mortgageOptions.find((m) => m.property_id !== null) ?? null;
  const mortgageBalances = linked ? await getMortgageBalances(linked.id) : [];

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
          </div>
        )}
      </div>

      <div className="mb-6">
        <PropertyValueChart data={chartData} />
      </div>

      <div className="grid grid-cols-2 gap-6 items-start">
        <PropertyEditForm
          property={property}
          mortgageOptions={mortgageOptions.map((m) => ({ id: m.id, name: m.name }))}
          linkedMortgageId={linked?.id ?? null}
        />
        <PropertyValuationHistory propertyId={property.id} rows={valuations} />
      </div>
    </div>
  );
}

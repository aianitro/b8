import db from './db';
import { createLogger } from './logger';
import { latestValuationByAccount } from './domain/valuation';
import { latestValuationByProperty, latestTenantFundByProperty } from './domain/property';
import {
  computeNetWorthBreakdown,
  type NetWorthAccount,
  type NetWorthBreakdown,
} from './domain/netWorth';
import type { TenantFundKind } from '../shared/types';

const log = createLogger('netWorth');

// I/O shell around domain/netWorth.ts — gathers the inputs the pure function needs, in one
// place, so the dashboard and the scheduler's snapshot writer can never drift apart on how net
// worth is defined. Same pure-core/I/O-shell split as plaidMatch/plaidReconcile.

export interface NetWorthResult extends NetWorthBreakdown {
  /** Latest ledger balance per account, reused by the dashboard's per-landscape series. */
  ledgerBalances: Map<string, number>;
}

export async function computeCurrentNetWorth(): Promise<NetWorthResult> {
  const year = new Date().getFullYear();

  const [accountsRes, netRes, balancesRes, acctValRes, propValRes, propsRes, tenantFundsRes] = await Promise.all([
    // Valuation-mode accounts count even when untracked: track_transactions governs whether an
    // account's *transactions* reach budgets, which says nothing about a balance that doesn't
    // come from transactions in the first place.
    db.query<{ id: string; landscape: string; valuation_mode: string; is_liability: boolean; property_id: number | null }>(
      `SELECT id, landscape, valuation_mode, is_liability, property_id FROM accounts
        WHERE track_transactions = TRUE OR valuation_mode = 'valuation'`
    ),
    db.query<{ account_id: string; net: string }>(`
      SELECT t.account_id,
             (COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
              - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0))::text AS net
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
       WHERE EXTRACT(YEAR FROM t.date) = $1
       GROUP BY t.account_id
    `, [year]),
    db.query<{ account_id: string; beginning_balance: string }>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1', [year]
    ),
    db.query<{ account_id: string; value: string; valued_at: Date }>(
      'SELECT account_id, value, valued_at FROM account_valuations'
    ),
    db.query<{ property_id: number; value: string; valued_at: Date }>(
      'SELECT property_id, value, valued_at FROM property_valuations'
    ),
    db.query<{ id: number }>('SELECT id FROM properties'),
    // No ORDER BY, exactly like the two valuation queries above: "currently held" is resolved by
    // latestTenantFundByProperty comparing valued_at, never by trusting the row order a query
    // happens to return today. Both kinds are fetched in one pass and separated by kind in the
    // reduction, so a new kind cannot silently start counting as a deposit.
    db.query<{ property_id: number; kind: string; value: string; valued_at: Date }>(
      'SELECT property_id, kind, value, valued_at FROM property_tenant_funds'
    ),
  ]);

  const netByAccount = new Map(netRes.rows.map((r) => [r.account_id, Number(r.net)]));
  const beginningByAccount = new Map(balancesRes.rows.map((r) => [r.account_id, Number(r.beginning_balance)]));

  const ledgerBalances = new Map<string, number>();
  for (const a of accountsRes.rows) {
    ledgerBalances.set(a.id, (beginningByAccount.get(a.id) ?? 0) + (netByAccount.get(a.id) ?? 0));
  }

  const accounts: NetWorthAccount[] = accountsRes.rows.map((a) => ({
    id: a.id,
    landscape: a.landscape as 'operational' | 'capital',
    valuationMode: a.valuation_mode as 'ledger' | 'valuation',
    isLiability: a.is_liability,
    propertyId: a.property_id,
  }));

  const latestAccountValuations = latestValuationByAccount(
    acctValRes.rows.map((r) => ({ accountId: r.account_id, value: Number(r.value), valuedAt: r.valued_at }))
  );
  const latestPropertyValues = latestValuationByProperty(
    propValRes.rows.map((r) => ({ propertyId: r.property_id, value: Number(r.value), valuedAt: r.valued_at }))
  );

  // Only 'security_deposit' reaches the breakdown. Last month's rent is read from the same table
  // for the property page's display, but is the owner's own money on a cash basis and must never
  // reach a net-worth component — the kind filter here is the boundary that enforces it.
  const securityDepositsByProperty = latestTenantFundByProperty(
    tenantFundsRes.rows.map((r) => ({
      propertyId: r.property_id,
      kind: r.kind as TenantFundKind,
      value: Number(r.value),
      valuedAt: r.valued_at,
    })),
    'security_deposit'
  );

  const breakdown = computeNetWorthBreakdown(
    accounts,
    ledgerBalances,
    latestAccountValuations,
    latestPropertyValues,
    propsRes.rows.map((r) => r.id),
    securityDepositsByProperty
  );

  return { ...breakdown, ledgerBalances };
}

/**
 * Upserts today's snapshot. Keyed on the date, so running twice in a day corrects the row
 * rather than adding a second one — the scheduler fires two sync phases daily, and a manual
 * run can land on top of either.
 */
export async function writeNetWorthSnapshot(): Promise<NetWorthBreakdown> {
  const r = await computeCurrentNetWorth();

  // liabilities_security_deposits is set on BOTH the INSERT and the ON CONFLICT branch, and
  // that is load-bearing rather than tidy: the column marks the boundary between the old
  // definition of `liabilities`/`total` (unlinked valuation-mode liability accounts only) and
  // the one that also nets out tenant deposits. Rows predating this feature are NULL, meaning
  // "written before deposits were modelled" — so a row written *now* and left NULL would claim
  // to be old-definition while carrying a deposit-adjusted total. A marker that lies is worse
  // than no marker, and the upsert path is the one that would go stale unnoticed, since it only
  // runs on the second write of a day. The value comes straight from the breakdown, which
  // accumulated it in the same loop that applied it — never re-derived here.
  await db.query(
    `INSERT INTO net_worth_snapshots
       (snapshot_date, operational, capital_financial, real_estate_equity, liabilities, total,
        liabilities_security_deposits)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (snapshot_date) DO UPDATE
       SET operational                   = EXCLUDED.operational,
           capital_financial             = EXCLUDED.capital_financial,
           real_estate_equity            = EXCLUDED.real_estate_equity,
           liabilities                   = EXCLUDED.liabilities,
           total                         = EXCLUDED.total,
           liabilities_security_deposits = EXCLUDED.liabilities_security_deposits`,
    [r.operational, r.capitalFinancial, r.realEstateEquity, r.liabilities, r.total,
     r.liabilitiesSecurityDeposits]
  );

  log.info('net worth snapshot written', {
    total: r.total,
    unvaluedProperties: r.unvaluedPropertyIds.length,
  });
  return r;
}

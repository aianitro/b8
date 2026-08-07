import db from './db';
import { createLogger } from './logger';
import { latestValuationByAccount } from './domain/valuation';
import { latestValuationByProperty } from './domain/property';
import {
  computeNetWorthBreakdown,
  type NetWorthAccount,
  type NetWorthBreakdown,
} from './domain/netWorth';

const log = createLogger('netWorth');

// I/O shell around domain/netWorth.ts — gathers the four inputs the pure function needs, in one
// place, so the dashboard and the scheduler's snapshot writer can never drift apart on how net
// worth is defined. Same pure-core/I/O-shell split as plaidMatch/plaidReconcile.

export interface NetWorthResult extends NetWorthBreakdown {
  /** Latest ledger balance per account, reused by the dashboard's per-landscape series. */
  ledgerBalances: Map<string, number>;
}

export async function computeCurrentNetWorth(): Promise<NetWorthResult> {
  const year = new Date().getFullYear();

  const [accountsRes, netRes, balancesRes, acctValRes, propValRes, propsRes] = await Promise.all([
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

  const breakdown = computeNetWorthBreakdown(
    accounts,
    ledgerBalances,
    latestAccountValuations,
    latestPropertyValues,
    propsRes.rows.map((r) => r.id)
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

  await db.query(
    `INSERT INTO net_worth_snapshots
       (snapshot_date, operational, capital_financial, real_estate_equity, liabilities, total)
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)
     ON CONFLICT (snapshot_date) DO UPDATE
       SET operational        = EXCLUDED.operational,
           capital_financial  = EXCLUDED.capital_financial,
           real_estate_equity = EXCLUDED.real_estate_equity,
           liabilities        = EXCLUDED.liabilities,
           total              = EXCLUDED.total`,
    [r.operational, r.capitalFinancial, r.realEstateEquity, r.liabilities, r.total]
  );

  log.info('net worth snapshot written', {
    total: r.total,
    unvaluedProperties: r.unvaluedPropertyIds.length,
  });
  return r;
}

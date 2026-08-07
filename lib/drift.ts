import db from './db';
import { detectDrift, type DriftFinding, type DriftInput } from './domain/drift';

// I/O shell around domain/drift.ts. Computed at read time rather than by a nightly job writing
// a table: the inputs (transactions, plaid_balance rows) are already persisted, so a stored
// result would only ever be a cache that can go stale between syncs. The roadmap's "nightly
// job" framing was about *when the comparison happens*, and recomputing on load is strictly
// fresher.

export async function findBalanceDrift(threshold = 1): Promise<DriftFinding[]> {
  const year = new Date().getFullYear();

  const [accountsRes, netRes, balancesRes, plaidRes] = await Promise.all([
    // Ledger-mode only. A valuation-mode account has no ledger balance to disagree with —
    // its balance IS the recorded valuation, so comparing it to Plaid would just restate the
    // same number.
    db.query<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM accounts
        WHERE valuation_mode = 'ledger' AND track_transactions = TRUE AND access_token IS NOT NULL`
    ),
    db.query<{ account_id: string; net: string }>(`
      SELECT t.account_id,
             (COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
              - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0))::text AS net
        FROM transactions t
       WHERE EXTRACT(YEAR FROM t.date) = $1
       GROUP BY t.account_id
    `, [year]),
    db.query<{ account_id: string; beginning_balance: string }>(
      'SELECT account_id, beginning_balance FROM account_balances WHERE year = $1', [year]
    ),
    // Latest Plaid-reported balance per account. plaid_balance rows are a change-log
    // (lib/plaidBalances.ts skips unchanged values), so "latest" is the current figure.
    db.query<{ account_id: string; value: string; valued_at: Date }>(`
      SELECT DISTINCT ON (account_id) account_id, value, valued_at
        FROM account_valuations
       WHERE source = 'plaid_balance'
       ORDER BY account_id, valued_at DESC
    `),
  ]);

  const netByAccount = new Map(netRes.rows.map((r) => [r.account_id, Number(r.net)]));
  const beginningByAccount = new Map(balancesRes.rows.map((r) => [r.account_id, Number(r.beginning_balance)]));
  const plaidByAccount = new Map(plaidRes.rows.map((r) => [r.account_id, r]));

  const inputs: DriftInput[] = accountsRes.rows.map((a) => {
    const plaid = plaidByAccount.get(a.id);
    return {
      accountId: a.id,
      name: a.name,
      type: a.type,
      ledgerBalance: (beginningByAccount.get(a.id) ?? 0) + (netByAccount.get(a.id) ?? 0),
      plaidBalance: plaid ? Number(plaid.value) : null,
      observedAt: plaid ? plaid.valued_at.toISOString() : null,
    };
  });

  return detectDrift(inputs, threshold);
}

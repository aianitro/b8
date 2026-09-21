import db from './db';
import { balancesToRecord, type ObservedBalance } from './domain/valuation';
import { createLogger } from './logger';

const log = createLogger('plaidBalances');

// Persists the balances Plaid reports for linked accounts as `plaid_balance` rows in
// account_valuations (ROADMAP.md Phase 0 step 3). The I/O shell around
// domain/valuation.ts's pure balancesToRecord(), same split as plaidReconcile/plaidMatch.
//
// Recorded for EVERY linked account, not just capital/valuation-mode ones as the roadmap
// item's wording suggests. Two consumers want them and they disagree about which accounts
// matter: valuation-mode accounts (brokerages, once seeded) read their balance from here,
// while drift detection (§1g) compares Plaid's reported balance against the ledger-computed
// one specifically for the ledger-mode accounts. Recording both costs nothing extra — the
// balances arrive in the accountsGet response the reconcile step already makes — and storing
// only capital accounts would leave drift detection with nothing to compare against.

/** Returns how many rows were actually appended (unchanged balances are skipped). */
export async function recordPlaidBalances(observed: ObservedBalance[]): Promise<number> {
  if (observed.length === 0) return 0;

  const accountIds = observed.map((o) => o.accountId);

  const [knownRes, lastRes] = await Promise.all([
    // Plaid can report accounts we have no row for (a newly-opened account at the bank that
    // reconciliation flagged as unmatchedLive). Inserting those would violate the FK.
    db.query<{ id: string }>('SELECT id FROM accounts WHERE id = ANY($1)', [accountIds]),
    db.query<{ account_id: string; value: string }>(
      `SELECT DISTINCT ON (account_id) account_id, value
         FROM account_valuations
        WHERE source = 'plaid_balance' AND account_id = ANY($1)
        ORDER BY account_id, valued_at DESC`,
      [accountIds]
    ),
  ]);

  const known = new Set(knownRes.rows.map((r) => r.id));
  const lastRecorded = new Map(lastRes.rows.map((r) => [r.account_id, Number(r.value)]));

  const toRecord = balancesToRecord(observed.filter((o) => known.has(o.accountId)), lastRecorded);
  if (toRecord.length === 0) return 0;

  for (const { accountId, value } of toRecord) {
    await db.query(
      `INSERT INTO account_valuations (account_id, value, source) VALUES ($1, $2, 'plaid_balance')`,
      [accountId, value]
    );
  }

  log.info('recorded plaid balances', { recorded: toRecord.length, observed: observed.length });
  return toRecord.length;
}

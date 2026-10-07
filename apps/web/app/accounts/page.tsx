// Live data, so never prerendered. Its siblings all carry this line; these three did not, and
// the gap was invisible until `next build` ran without a database and tried to statically
// generate them. Nothing about the page was wrong — the missing declaration was.
export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import AddAccountForm from '@/components/AddAccountForm';
import AccountsList from '@/components/AccountsList';
import SyncControls from '@/components/SyncControls';
import SyncHealthCard from '@/components/SyncHealthCard';
import type { Account } from '@b8/contracts/types';

async function getAccounts(): Promise<Account[]> {
  const result = await db.query<Account>(
    `SELECT id, name, type, subtype, landscape, track_transactions, bank,
            (access_token IS NULL) AS is_manual,
            last_synced_at, valuation_mode, is_liability
     FROM accounts ORDER BY landscape, sort_order, created_at`
  );
  return result.rows;
}

// Latest valuation per account, for the inline value shown on valuation-mode rows. Mirrors
// lib/domain/valuation.ts's "latest wins" rule, pushed into SQL since the page only needs the
// current number rather than the whole history.
async function getLatestValuations(): Promise<Map<string, number>> {
  const result = await db.query<{ account_id: string; value: string }>(
    `SELECT DISTINCT ON (account_id) account_id, value
       FROM account_valuations
      ORDER BY account_id, valued_at DESC`
  );
  return new Map(result.rows.map((r) => [r.account_id, Number(r.value)]));
}

async function getTxnCounts(): Promise<Map<string, number>> {
  const result = await db.query<{ account_id: string; cnt: string }>(
    'SELECT account_id, COUNT(*)::text AS cnt FROM transactions GROUP BY account_id'
  );
  return new Map(result.rows.map((r) => [r.account_id, Number(r.cnt)]));
}

export default async function AccountsPage() {
  const [accounts, txnCounts, latestValuations] = await Promise.all([
    getAccounts(), getTxnCounts(), getLatestValuations(),
  ]);
  const operational = accounts.filter((a) => a.landscape === 'operational');
  const capital     = accounts.filter((a) => a.landscape === 'capital');
  const plaidCount  = accounts.filter((a) => !a.is_manual).length;
  const manualCount = accounts.filter((a) => a.is_manual).length;
  const txnCountsObj = Object.fromEntries(txnCounts);

  const subtitle = [
    plaidCount > 0 && `${plaidCount} via Plaid`,
    manualCount > 0 && `${manualCount} manual`,
  ].filter(Boolean).join(', ') || 'No accounts yet';

  return (
    // max-w-5xl, not the max-w-3xl the design doc lists for this page: that predates the
    // balance-mode and valuation columns, and five controls plus an account name genuinely do
    // not fit in 768px — cramming them there is what caused the overlapping row content.
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      {/* WRAPS ON A PHONE, one line from `sm:` up. The three controls come to 311px together and
          the title needs the rest; on an iPhone 15 Pro that is 62px more than the 361px inside the
          page's gutters, and the row simply ran off the screen. Nothing here can be made narrower
          without taking a word off a button, so the row is allowed a second line instead.

          `justify-between` still applies per line, so the controls sit at the start of their own
          line rather than being pushed to the right edge under the title. */}
      <div className="flex flex-wrap items-center justify-between gap-y-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddAccountForm />
          <PlaidLinkButton />
          {plaidCount > 0 && <SyncControls />}
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-slate-400 text-sm">No accounts yet. Connect via Plaid or add one manually.</p>
        </div>
      ) : (
        <AccountsList
          operational={operational}
          capital={capital}
          txnCounts={txnCountsObj}
          valuations={Object.fromEntries(latestValuations)}
        />
      )}

      {plaidCount > 0 && <SyncHealthCard />}
    </div>
  );
}

import db from '@/lib/db';
import PlaidLinkButton from '@/components/PlaidLinkButton';
import AddAccountForm from '@/components/AddAccountForm';
import AccountsList from '@/components/AccountsList';
import SyncControls from '@/components/SyncControls';
import type { Account } from '@/shared/types';

async function getAccounts(): Promise<Account[]> {
  const result = await db.query<Account>(
    `SELECT id, name, type, subtype, landscape, track_transactions, bank,
            (access_token IS NULL) AS is_manual,
            last_synced_at
     FROM accounts ORDER BY landscape, sort_order, created_at`
  );
  return result.rows;
}

async function getTxnCounts(): Promise<Map<string, number>> {
  const result = await db.query<{ account_id: string; cnt: string }>(
    'SELECT account_id, COUNT(*)::text AS cnt FROM transactions GROUP BY account_id'
  );
  return new Map(result.rows.map((r) => [r.account_id, Number(r.cnt)]));
}

export default async function AccountsPage() {
  const [accounts, txnCounts] = await Promise.all([getAccounts(), getTxnCounts()]);
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
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
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
        <AccountsList operational={operational} capital={capital} txnCounts={txnCountsObj} />
      )}
    </div>
  );
}

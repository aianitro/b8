import db from '@/lib/db';
import CsvImporter from '@/components/CsvImporter';

async function getAccounts() {
  const res = await db.query<{ id: string; name: string; landscape: string }>(
    "SELECT id, name, landscape FROM accounts ORDER BY landscape, name"
  );
  return res.rows;
}

export default async function ImportPage() {
  const accounts = await getAccounts();

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Import CSV</h1>
        <p className="text-sm text-slate-500 mt-1">Import transactions from a Chase CSV export</p>
      </div>
      <CsvImporter accounts={accounts} />
    </div>
  );
}

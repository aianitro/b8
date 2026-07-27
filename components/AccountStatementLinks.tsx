import db from '@/lib/db';
import Link from 'next/link';

type AccountRow = { id: string; name: string; landscape: string };

export default async function AccountStatementLinks({ landscape }: { landscape: string }) {
  const result = await db.query<AccountRow>(
    'SELECT id, name, landscape FROM accounts WHERE track_transactions = TRUE AND landscape = $1 ORDER BY name',
    [landscape]
  );
  if (result.rows.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap mb-6">
      <span className="text-xs text-slate-400 font-medium shrink-0">Statements:</span>
      {result.rows.map((a) => (
        <Link
          key={a.id}
          href={`/accounts/${a.id}`}
          className="text-xs px-3 py-1 rounded-full border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-colors font-medium"
        >
          {a.name} →
        </Link>
      ))}
    </div>
  );
}

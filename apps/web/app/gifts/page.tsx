// Gifts (P7-41b) — the one new page. The signed-in person's own gifts, as giver, and the form that
// marks a new one. Somebody who has marked none sees the form and an empty list, which is also
// exactly what the recipient of every gift sees: this page never reads a gift its viewer did not
// give (`listGifts` is scoped to the giver), so it cannot hint that one exists.
export const dynamic = 'force-dynamic';

import db from '@/lib/db';
import { listGifts } from '@/lib/giftStore';
import { pageViewer } from '@/lib/giftViewer';
import GiftForm from '@/components/GiftForm';
import GiftList from '@/components/GiftList';

export default async function GiftsPage() {
  const viewer = await pageViewer('/gifts');
  const [gifts, accounts] = await Promise.all([
    listGifts(viewer),
    // Only accounts the bank sync updates: a gift on a hand-kept account could never match, and the
    // route refuses one. Names only — no balances, no figures.
    db.query<{ id: string; name: string }>(
      'SELECT id, name FROM accounts WHERE access_token IS NOT NULL ORDER BY name'
    ).then((r) => r.rows),
  ]);

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Gifts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Mark a purchase in advance. When it arrives it shows only as “Gift” to everyone else until the reveal date.
        </p>
      </div>
      <GiftForm accounts={accounts} />
      <GiftList gifts={gifts} />
    </div>
  );
}

// Receipts photographed before their charge exists: the camera button, and every capture with
// where it stands. Only the viewer's own — `listCaptures` is scoped to the photographer — and any
// linked charge is read through the read path, so a gift-held row shows as Gift.
export const dynamic = 'force-dynamic';

import { pageViewer } from '@/lib/giftViewer';
import { listCaptures } from '@/lib/receiptCaptureStore';
import ReceiptSnap from '@/components/ReceiptSnap';
import ReceiptCaptureCard from '@/components/ReceiptCaptureCard';

export default async function ReceiptsPage() {
  const captures = await listCaptures(await pageViewer('/receipts'));
  const open = captures.filter((c) => c.state !== 'matched' && c.state !== 'closed');
  const settled = captures.filter((c) => c.state === 'matched' || c.state === 'closed');

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Receipts</h1>
        <p className="text-sm text-gray-400 mt-1">
          Photograph a receipt when you pay. When the charge posts, it is matched to the receipt, and you are told if the amount is different.
        </p>
      </div>
      <div className="mb-8"><ReceiptSnap /></div>

      {captures.length === 0 && <p className="text-sm text-gray-400">No receipts yet.</p>}
      {open.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">Open</h2>
          <div className="space-y-3">{open.map((c) => <ReceiptCaptureCard key={c.id} capture={c} />)}</div>
        </section>
      )}
      {settled.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">Settled</h2>
          <div className="space-y-3">{settled.map((c) => <ReceiptCaptureCard key={c.id} capture={c} />)}</div>
        </section>
      )}
    </div>
  );
}

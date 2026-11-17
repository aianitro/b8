import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import type { CaptureView } from '@/lib/receiptCaptureStore';
import { money, shortDate } from '@/lib/receiptCaptureClient';

/**
 * Photographed receipts that need the owner: a charge that differs from the receipt, or no charge a
 * week later. In the bell rather than on the page, like every other alert, and linking to the
 * Receipts page where each is settled. The viewer's own only. Silent when there are none.
 */
export default function ReceiptAlertCard({ alerts }: { alerts: CaptureView[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <ReceiptText size={14} className="text-amber-600" />
        {alerts.length === 1 ? 'A receipt needs a look' : `${alerts.length} receipts need a look`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {alerts.map((a) => (
          <li key={a.id}>
            <Link href="/receipts" className="flex items-baseline justify-between gap-3 text-sm hover:underline">
              <span className="min-w-0 truncate text-slate-800">{a.merchant ?? 'Receipt'} · {shortDate(a.capturedOn)}</span>
              {a.state === 'mismatch' && a.charged !== null && <span className="shrink-0 font-mono text-amber-700">{money(a.charged)}</span>}
            </Link>
            <p className="text-[11px] text-amber-700/80">
              {a.state === 'mismatch' && a.expected !== null
                ? `Charged differently from the ${money(a.expected)} on the receipt`
                : 'No charge has arrived a week after the meal'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

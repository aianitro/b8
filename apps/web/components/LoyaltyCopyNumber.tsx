'use client';

// Loyalty (P8-42a) — the copy action beside a masked member number, and the ONLY file on the page
// that names the full-number route.
//
// FETCHED ON TAP, NEVER ON LOAD. The page's props, its HTML and its flight payload carry the mask
// alone; the full number is requested only inside the click handler below, for one membership, and
// goes straight to the clipboard. It is never put in state, rendered, or logged, so it does not
// outlive the tap. The route answers a browser session only — a script's bearer token gets 403.

import { useState } from 'react';
import { Copy } from 'lucide-react';

export default function LoyaltyCopyNumber({ membershipId }: { membershipId: number }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');

  async function copyNumber() {
    setStatus('busy');
    try {
      const res = await fetch(`/api/v1/loyalty/memberships/${membershipId}/member-number`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      const value: unknown = body?.success === true ? body.data?.memberNumber : null;
      if (typeof value !== 'string') { setStatus('failed'); return; }
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <button
      type="button"
      onClick={copyNumber}
      disabled={status === 'busy'}
      aria-label="Copy the member number"
      className="inline-flex items-center gap-1 min-h-8 px-2 rounded text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
    >
      <Copy size={14} className="shrink-0" />
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Not copied' : 'Copy'}
    </button>
  );
}

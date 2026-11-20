'use client';

// Loyalty (P8-42a) — the one way the /travel components call the loyalty routes for a WRITE. Not a
// component: a helper that lives beside them (the scope of this change keeps loyalty client code in
// `components/Loyalty*`), so every edit on the page sends, reads and reports a refusal the same way.
//
// ONLY CALLED FROM EVENT HANDLERS. Nothing on the page fetches at render or in an effect: the page's
// data arrives as server props, and after a write `router.refresh()` re-reads it on the server. The
// copy action's full-number request is deliberately NOT routed through here — it lives in
// `LoyaltyCopyNumber.tsx` alone, so exactly one file in the page mentions that path.

export type SendResult = { ok: true } | { ok: false; message: string };

/** A JSON write to a loyalty route. The server's refusal message, never the submitted values. */
export async function send(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (data?.success === true) return { ok: true };
    return { ok: false, message: data?.error?.message ?? 'That did not work. Try again.' };
  } catch {
    return { ok: false, message: 'The server could not be reached. Try again.' };
  }
}

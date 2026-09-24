// The one shape of a transaction edit, and the one way to send it.
//
// `PATCH /api/v1/transactions/:id` takes a body naming ONLY the columns to change: the route
// distinguishes absent from null on purpose, so `{ note }` leaves the flag alone and `{ watched }`
// leaves the note alone. That is the decoupling the phone's editor is built on — a note is a note,
// watching is a flag, and neither implies the other — and it is easy to lose at a call site that
// sends both out of habit. Naming the three edits as three functions is what keeps it.
//
// Extracted because there were three hand-rolled `fetch` calls with three slightly different error
// stories: one ignored the response entirely, one read `data.error.message`, one assumed success.
// The route answers failures with a stated reason (a note over the limit says how long it was) and
// only one of the three was showing it.

/** What the route answers with when it refuses, already unwrapped. */
export class TransactionEditError extends Error {}

async function patch(id: number, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) {
    throw new TransactionEditError(data?.error?.message ?? 'That did not work. Try again.');
  }
}

/** Refile it, or clear the category with `null`. */
export const setCategory = (id: number, category: string | null) =>
  patch(id, { mapped_category: category });

/**
 * Write or clear the note, SAYING NOTHING ABOUT THE FLAG.
 *
 * The web UI used to send `{ watched: true, note }` from its only note field, so writing a comment
 * put the row on the watchlist — the same fusion the schema enforced until `watch_note` became
 * `note`. The phone was fixed at the time and this was not, because the flag modal was the only
 * way in and flagging was what it was for.
 */
export const setNote = (id: number, note: string | null) => patch(id, { note });

/** Flag or unflag it, SAYING NOTHING ABOUT THE NOTE. */
export const setWatched = (id: number, watched: boolean) => patch(id, { watched });

export interface CategoryOption {
  name: string;
  landscape: string;
  exclude_from_budget: boolean;
}

/**
 * The picker's three groups, in the order a `<select>` should show them.
 *
 * `isPayment` floats transfer categories to the top for a row whose description says "payment",
 * which is the one case where the alphabetical answer is reliably the wrong one — a card payment
 * is a transfer roughly always, and it is otherwise eleven categories down the list.
 */
export function groupCategories(categories: CategoryOption[], isPayment = false) {
  const sorted = categories.slice().sort((a, b) => {
    if (!isPayment) return a.name.localeCompare(b.name);
    const aT = a.name.toLowerCase().includes('transfer');
    const bT = b.name.toLowerCase().includes('transfer');
    if (aT !== bT) return aT ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    operational: sorted.filter((c) => !c.exclude_from_budget && c.landscape === 'operational'),
    capital: sorted.filter((c) => !c.exclude_from_budget && c.landscape === 'capital'),
    excluded: sorted.filter((c) => c.exclude_from_budget),
  };
}

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
 * Names that mean "this row moved money between your own accounts", on either side of the picker.
 *
 * Matched against the TRANSACTION's description to decide whether to suggest anything, and against
 * the CATEGORY's name to decide what to suggest. One pattern for both, because the question is the
 * same question: a row called "Online Transfer to CHK" and a category called "Transfer" are a match
 * precisely because they share the word.
 *
 * `autopay` is here because this ledger's own feed writes "CHASE CREDIT CRD AUTOPAY" — the rule
 * used to be `/payment/i` alone and missed two of the three transfer-shaped rows in a six-row
 * backlog. Widened from what the data actually says rather than from what a card payment is
 * usually called.
 */
const TRANSFERISH = /transfer|autopay|payment|xfer/i;

/**
 * The picker's groups, in the order a `<select>` should show them.
 *
 * ─── WHY A LEADING "SUGGESTED" GROUP, AND NOT JUST A SORT ─────────────────────────────────────
 *
 * This took a `isPayment: boolean` and floated transfer categories to the top of the SORT. That
 * never helped, and the owner reported the consequence as "Transfer is not available": the sort
 * runs before the split into groups, so a floated category still lands in whichever group its
 * flags put it — and `Transfer` is `exclude_from_budget`, which is the LAST group. It was option
 * 37 of 37, at the bottom of an iOS picker wheel, which is unreachable in every sense that counts.
 *
 * A match now leaves its group and leads the list. Nothing is duplicated — a suggested category is
 * removed from the group it would otherwise have sat in, so the reader never meets the same name
 * twice and the counts still add up.
 *
 * Taking the DESCRIPTION rather than a boolean is the same lesson this repo keeps relearning: a
 * derived boolean puts the rule at the call site, where two call sites eventually disagree about
 * what a payment looks like. The pattern lives here now and both pickers share it.
 */
export function groupCategories(categories: CategoryOption[], description?: string | null) {
  const sorted = categories.slice().sort((a, b) => a.name.localeCompare(b.name));
  const suggested = TRANSFERISH.test(description ?? '')
    ? sorted.filter((c) => TRANSFERISH.test(c.name))
    : [];
  const promoted = new Set(suggested.map((c) => c.name));
  const rest = sorted.filter((c) => !promoted.has(c.name));
  const operational = rest.filter((c) => !c.exclude_from_budget && c.landscape === 'operational');
  const capital = rest.filter((c) => !c.exclude_from_budget && c.landscape === 'capital');
  // THE LAST GROUP IS A REMAINDER, NOT A FILTER, and that is the whole point of writing it this
  // way. As three filters, a category whose landscape is neither 'operational' nor 'capital'
  // matched none of them and vanished from the picker with nothing raised — a category the owner
  // could not choose and could not see was missing. `landscape` is a typed enum in the contract
  // and widened to `string` here, so the types do not catch it; a test does, and so does this.
  //
  // Such a row lands under "Excluded from budget", where the label may not be strictly true of it.
  // That is the trade: a slightly wrong heading is recoverable by reading, a disappeared category
  // is not.
  const placed = new Set([...suggested, ...operational, ...capital].map((c) => c.name));
  return {
    suggested,
    operational,
    capital,
    excluded: rest.filter((c) => !placed.has(c.name)),
  };
}

/**
 * What each group is called in the picker.
 *
 * "Excluded from budget", never "Other" — which is what the last group used to say, while this
 * ledger ALSO has a category literally named `Other`. A reader hunting for a name in a group whose
 * header is that same name has no way to tell a heading from an item. The new label is also the
 * one that says what choosing it does: the row stops counting toward any budget.
 */
export const GROUP_LABELS = {
  suggested: 'Suggested',
  operational: 'Operational',
  capital: 'Capital',
  excluded: 'Excluded from budget',
} as const;

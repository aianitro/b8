// Recognizing an already-stored transaction that Plaid has re-issued under a new id.
//
// transaction_id is scoped to the Plaid Item. Re-authorizing a bank creates a new Item, so the
// very same real transactions come back with brand-new ids — and an upsert keyed on
// plaid_transaction_id sees no conflict and inserts a second copy of history. That is how a
// single Chase re-auth duplicated 491 transactions here.
//
// The matching is deliberately one-to-one and claim-based, the same shape as plaidMatch.ts uses
// for accounts, because the dangerous failure is the opposite of the obvious one: two genuinely
// separate $5 coffees at the same shop on the same day are NOT duplicates, and collapsing them
// would silently delete a real transaction. Claiming means two incoming rows can only ever
// match two distinct stored rows — never the same one twice — so multiplicity is preserved.

export interface IncomingTxn {
  plaidTransactionId: string;
  accountId: string;
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
  name: string | null;
}

export interface ExistingTxn {
  id: number;
  plaidTransactionId: string;
  accountId: string;
  date: string;
  amount: number;
  name: string | null;
}

export interface ReidentifiedTxn {
  /** The stored row to keep — with its category, hidden flag and transfer group intact. */
  existingId: number;
  /** The id Plaid now uses for it. */
  newPlaidTransactionId: string;
}

export interface TxnMatchResult {
  /** Same real transaction, new Plaid id: update in place rather than insert a duplicate. */
  reidentify: ReidentifiedTxn[];
  /** Genuinely new to this app. */
  insert: IncomingTxn[];
}

const key = (t: { accountId: string; date: string; amount: number; name: string | null }) =>
  `${t.accountId}|${t.date}|${t.amount.toFixed(2)}|${(t.name ?? '').trim().toLowerCase()}`;

/**
 * `existing` should be the stored rows that could plausibly match — same accounts, same date
 * range as the incoming batch. Rows whose plaid id already appears in `incoming` are never
 * re-identified: Plaid still knows that id, so it is a live transaction in its own right, and
 * anything matching it naturally is a separate one.
 */
export function matchReissuedTransactions(
  incoming: IncomingTxn[],
  existing: ExistingTxn[]
): TxnMatchResult {
  const incomingIds = new Set(incoming.map((t) => t.plaidTransactionId));

  // Only rows Plaid no longer refers to by id are re-identification candidates.
  const candidates = new Map<string, ExistingTxn[]>();
  for (const e of existing) {
    if (incomingIds.has(e.plaidTransactionId)) continue;
    const k = key(e);
    if (!candidates.has(k)) candidates.set(k, []);
    candidates.get(k)!.push(e);
  }
  // Stable claim order so the same input always produces the same pairing.
  for (const list of candidates.values()) list.sort((a, b) => a.id - b.id);

  const reidentify: ReidentifiedTxn[] = [];
  const insert: IncomingTxn[] = [];

  for (const t of incoming) {
    // Already stored under this exact id — the ordinary upsert path owns it.
    if (existing.some((e) => e.plaidTransactionId === t.plaidTransactionId)) continue;

    const pool = candidates.get(key(t));
    const claimed = pool?.shift(); // shift = claim; a row can be claimed only once
    if (claimed) {
      reidentify.push({ existingId: claimed.id, newPlaidTransactionId: t.plaidTransactionId });
    } else {
      insert.push(t);
    }
  }

  return { reidentify, insert };
}

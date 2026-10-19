// Gifts (P7-41b) — WHAT A MASKED ROW IS. The one table that says, column by column, what a viewer
// who is not the giver may see of a ledger row a gift holds before its reveal date, and the pure
// functions that apply it.
//
// ─── ONE TABLE, TWO APPLICATIONS ──────────────────────────────────────────────────────────────
//
// `TRANSACTION_COLUMN_MASK` is read twice. `lib/giftReadPath.ts` builds the SQL every viewer-facing
// read goes through from it, so Postgres masks a row in the same statement that reads it; and
// `maskedProjection` below applies it to a row already in hand, which is what the transaction detail
// route does as a second line after the SQL, and what the unit tests pin. Because both come from
// the same table, adding a column to `transactions` without classifying it here is a type error in
// this file (the record is keyed on the column list), not a leak discovered later.
//
// ─── THE ALLOWLIST (SPEC.md "Masked projection") ──────────────────────────────────────────────
//
// A masked row may carry only: its id, date, amount, the account (id, name, landscape), the label
// `Gift`, its category (the gift category's current name), `hidden` as stored, `created_at`,
// `rule_applied` false, and the effective property the account gives it. Everything else — the
// raw name, the merchant, the bank description, both Plaid categories and the confidence, the
// payment channel, the merchant entity, logo, website, authorized date, every location field, the
// retained raw Plaid object (which carries counterparties and the street address), the note, the
// watch flag, the Plaid id and any transfer-group peers — is absent or null.
//
// THE LABEL IS EXACTLY `Gift`. Every surface in this app labels a row `merchant ?? name ?? <fallback>`
// with fallbacks of `Unnamed`, `Transaction` or `—`. Nulling both would therefore print a fallback,
// which is wrong twice: it is not what SPEC.md says the recipient sees, and `Unnamed` beside a real
// amount is the kind of oddity that invites a closer look. So a masked row's `name` IS the label —
// `Gift` — and its merchant is null, which makes every existing fallback chain produce `Gift`
// without a single renderer having to know a gift exists.
//
// ─── WHO SEES WHAT ────────────────────────────────────────────────────────────────────────────
//
// The giver sees the real row. Every other viewer — the recipient, a third user, and a viewer the
// request could not identify (`null`) — sees the masked one until the reveal date, inclusive, and
// the real one from then on. The rule is `isMaskedFor`; Postgres states the same rule in SQL
// (`giftMaskedSql` in `lib/giftReadPath.ts`, from the migration), evaluated on its own calendar.

import { cents, fromCents } from './giftMatch';

/** The label a masked row carries, on every surface. Never a fallback, never empty. */
export const GIFT_LABEL = 'Gift';

/**
 * Who is looking: a `users.id`, or `null` when the request could not be tied to a person. `null` is
 * a NON-GIVER — never the owner, never the giver — so an unresolved viewer sees the masked row.
 */
export type GiftViewer = number | null;

/** What a gift says about one row it holds: whose secret it is, and until when. */
export interface GiftHold {
  giverUserId: number;
  /** `YYYY-MM-DD`; the row is revealed from this day on. */
  revealDate: string;
}

/**
 * Every column of `transactions`, and what a masked row carries in it.
 *
 *   `keep`  — the stored value (the allowlist).
 *   `null`  — nothing.
 *   `label` — the label `Gift` (the raw name only; see the file header).
 *   `false` — `false` (`rule_applied`: a held row is never a rule's to re-file, and saying so is
 *             not a fact about the merchant).
 */
export const TRANSACTION_COLUMN_MASK = {
  id: 'keep',
  account_id: 'keep',
  date: 'keep',
  amount: 'keep',
  mapped_category: 'keep',
  hidden: 'keep',
  created_at: 'keep',
  // Kept so that every figure attributed to a property is the same sum for every viewer. A
  // property's ledger and P/L add up this column; masking it would move the giver's tagged row out
  // of the recipient's figures, and a total that differs by viewer is the one thing masking may
  // never do. It names a property, which says nothing about the merchant.
  property_id: 'keep',
  rule_applied: 'false',
  name: 'label',
  merchant_name: 'null',
  plaid_transaction_id: 'null',
  plaid_category: 'null',
  plaid_category_detailed: 'null',
  plaid_category_confidence: 'null',
  authorized_date: 'null',
  payment_channel: 'null',
  merchant_entity_id: 'null',
  logo_url: 'null',
  website: 'null',
  location_city: 'null',
  location_region: 'null',
  location_country: 'null',
  plaid_raw: 'null',
  note: 'null',
  watched_at: 'null',
  // A held row cannot be linked into a transfer (the routes refuse it), so this is null in practice;
  // nulling it anyway means no peer list can ever be built from a masked row.
  transfer_group_id: 'null',
} as const satisfies Record<string, 'keep' | 'null' | 'label' | 'false'>;

export type TransactionColumn = keyof typeof TRANSACTION_COLUMN_MASK;

/** The keys a masked row carries, and no others — SPEC.md's allowlist as an object shape. */
export const MASKED_ROW_KEYS = [
  'id', 'date', 'amount', 'account_id', 'account_name', 'account_landscape',
  'label', 'category', 'hidden', 'created_at', 'rule_applied', 'effective_property',
] as const;

/** A row as a full reader holds it: the columns, the account it sits on, and anything joined. */
export interface FullTransactionRow {
  id: number;
  date: string;
  amount: string;
  account_id: string;
  account_name: string;
  account_landscape: string;
  mapped_category: string | null;
  hidden: boolean;
  created_at: string;
  rule_applied: boolean;
  /** The property the row lands on — its own tag, else its account's. */
  effective_property: string | null;
  [other: string]: unknown;
}

/** The masked row. Exactly `MASKED_ROW_KEYS`. */
export interface MaskedTransactionRow {
  id: number;
  date: string;
  amount: string;
  account_id: string;
  account_name: string;
  account_landscape: string;
  label: typeof GIFT_LABEL;
  category: string | null;
  hidden: boolean;
  created_at: string;
  rule_applied: false;
  effective_property: string | null;
}

/**
 * Whether `viewer` sees the row masked. Not held: never. Held: until the reveal date, for everyone
 * but the giver — `null` and `undefined` included, because a viewer nobody identified is a viewer
 * nobody may assume is the giver.
 */
export function isMaskedFor(hold: GiftHold | null, viewer: GiftViewer | undefined, today: string): boolean {
  if (hold === null) return false;
  if (hold.revealDate <= today) return false;
  return viewer === null || viewer === undefined || viewer !== hold.giverUserId;
}

/**
 * The masked projection of a full row: the allowlist and nothing else. Built by NAMING what is kept,
 * never by deleting what is secret, so a field added to the reader tomorrow is absent here by
 * construction.
 */
export function maskedProjection(row: FullTransactionRow): MaskedTransactionRow {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    account_id: row.account_id,
    account_name: row.account_name,
    account_landscape: row.account_landscape,
    label: GIFT_LABEL,
    category: row.mapped_category,
    hidden: row.hidden,
    created_at: row.created_at,
    rule_applied: false,
    effective_property: row.effective_property,
  };
}

/** The row `viewer` may see: the input itself, or its masked projection. */
export function viewRow(
  row: FullTransactionRow,
  hold: GiftHold | null,
  viewer: GiftViewer | undefined,
  today: string,
): FullTransactionRow | MaskedTransactionRow {
  return isMaskedFor(hold, viewer, today) ? maskedProjection(row) : row;
}

/** One merchant bucket, as a "top merchants" list shows it. `total` is exact decimal text. */
export interface MerchantBucket {
  merchant: string;
  count: number;
  total: string;
}

/**
 * Rows grouped by merchant as `viewer` may see them.
 *
 * A masked row's merchant is the label, so every masked row of a non-giver falls into ONE `Gift`
 * bucket whose total is exactly the sum of those rows — the grouping changes what is shown, never
 * what is summed. The giver's grouping is the real one. Sums are taken in whole cents.
 */
export function merchantBuckets(
  rows: readonly { merchant: string | null; name: string | null; amount: string; hold: GiftHold | null }[],
  viewer: GiftViewer | undefined,
  today: string,
): MerchantBucket[] {
  const buckets = new Map<string, { count: number; total: bigint }>();
  for (const r of rows) {
    const label = isMaskedFor(r.hold, viewer, today) ? GIFT_LABEL : (r.merchant ?? r.name ?? 'Unnamed');
    const b = buckets.get(label) ?? { count: 0, total: BigInt(0) };
    b.count += 1;
    const c = cents(r.amount);
    if (c === null) throw new RangeError('merchantBuckets: an amount is not a two-decimal figure');
    b.total += c;
    buckets.set(label, b);
  }
  return [...buckets.entries()]
    .sort(([ma, a], [mb, b]) => (a.total === b.total ? (ma < mb ? -1 : 1) : (b.total > a.total ? 1 : -1)))
    .map(([merchant, b]) => ({ merchant, count: b.count, total: fromCents(b.total) }));
}

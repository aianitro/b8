// What sync keeps of a Plaid transaction beyond the seven fields it always stored (P6-40b).
//
// ONE MAPPING, CALLED FROM EVERY PLACE SYNC WRITES A PLAID ROW. `lib/sync.ts` writes through two
// upserts — the `added` loop's and the `modified` loop's — and a row re-identified after a re-auth
// is refreshed by the first of those, keyed on the id the re-identification just gave it. If each
// loop derived the columns itself, the first fix made to one (a new blank-string rule, a date
// guard) would be the first time the two disagreed about what Plaid said, and nothing would notice
// until a row's logo depended on which event last touched it. Pure, so it is tested without a
// database in `plaidEnrichment.test.ts`; the integration file proves the SQL around it.
//
// NULL MEANS "PLAID DID NOT SAY", AND THAT IS DECIDED HERE, ONCE. A key Plaid omitted, sent as
// null, or sent as an empty or whitespace-only string becomes null — never '', never 0, never the
// string 'null'. The blank-string case is the one that matters in practice: '' and NULL read the
// same on a screen but not to `IS NULL`, and a column that holds both has two spellings of
// "unknown" that every later reader must remember to fold together. A non-blank value is stored
// VERBATIM, not trimmed or normalised: `in store` stays `in store`, because these are Plaid's
// vocabularies and a cleaned-up spelling is one Plaid never sent. The single exception is a code
// unit Postgres cannot store at all — U+0000, or half of a surrogate pair — which becomes U+FFFD in
// the columns and throughout `plaid_raw` alike (`storableText`); every other character is kept.
//
// NOTHING HERE READS MONEY. `amount` passes through to `plaid_raw` as the number Plaid sent; the
// ledger's `amount` column, written by sync from `txn.amount` directly, stays the only figure.

import type { Transaction } from 'plaid';

/** The eleven enrichment values for one transaction, in the order `lib/sync.ts` binds them. */
export interface PlaidEnrichment {
  plaidCategoryDetailed: string | null;
  plaidCategoryConfidence: string | null;
  /** `YYYY-MM-DD` exactly as Plaid sent it, or null. Never a Date: see `calendarDate`. */
  authorizedDate: string | null;
  paymentChannel: string | null;
  merchantEntityId: string | null;
  logoUrl: string | null;
  website: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  /**
   * `plaid_raw`, already serialised. A STRING ON PURPOSE, bound as `$n::jsonb`: Postgres parses
   * the text once into an object. Handing node-postgres the object would also work today, but it
   * serialises arrays as Postgres array literals rather than JSON, and passing a string that was
   * itself already a JSON string is how a column ends up holding a quoted blob where
   * `plaid_raw->>'amount'` returns NULL. Serialising exactly once, here, leaves one way to do it.
   */
  plaidRaw: string;
}

/**
 * The two kinds of UTF-16 code unit Postgres will not store, matched one code unit at a time (no
 * `u` flag, deliberately): U+0000, which neither `text` nor `jsonb` accepts, and a surrogate with no
 * partner — a high one not followed by a low one, or a low one not preceded by a high one — which
 * `jsonb` rejects as `invalid input syntax` once `JSON.stringify` has written it as a `\ud800`
 * escape. A correctly paired surrogate (an emoji) matches neither branch and is left alone.
 */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * `s` with each unstorable code unit replaced by U+FFFD, and nothing else changed (G3 amendment).
 *
 * WHY REPLACE RATHER THAN DROP OR REFUSE. Refusing is what Postgres already does, and that is the
 * defect: one such transaction fails its upsert, `syncItem` throws before the cursor UPDATE, and
 * the next sync fetches the same page and fails on it again — the institution's feed stops for good
 * over one field nobody reads. Dropping the code unit would silently join the text either side of
 * it; U+FFFD is Unicode's own mark for "a character was here and could not be represented", so the
 * stored value still shows that Plaid sent something at that position.
 *
 * Only the enrichment goes through this. The base `name` / `merchant_name` columns share the U+0000
 * exposure but are not this task's to change (QUEUE hold H6).
 */
export function storableText(s: string): string {
  return s.replace(UNSTORABLE, '\uFFFD');
}

/**
 * `value` with `storableText` applied to every string in it — object keys as well as values, at
 * any depth, inside arrays too — and every number, boolean and null passed through untouched.
 * Builds new arrays and objects rather than editing the ones it is given, for the same reason the
 * redaction below does. Applied to `plaid_raw` as a whole because the bad code unit can be in any
 * of the thirty-odd string fields the object carries, not only the ones that became columns.
 */
export function storableJson(value: unknown): unknown {
  if (typeof value === 'string') return storableText(value);
  if (Array.isArray(value)) return value.map(storableJson);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[storableText(k)] = storableJson(v);
    return out;
  }
  return value;
}

/**
 * A Plaid text field as a column value: non-blank strings verbatim apart from `storableText`,
 * everything else null.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? storableText(value) : null;
}

/**
 * Plaid's `authorized_date` as a column value — the STRING, checked, never converted.
 *
 * The repo's known DATE trap runs the other way on the read side (`toDateInputValue`), and on the
 * write side it is `new Date('2026-03-02')`: that parses as UTC midnight, and node-postgres then
 * serialises it in the process's LOCAL zone, which west of Greenwich is the evening before. Passing
 * the zone-less string straight to a `::date` cast has no zone anywhere for a shift to come from.
 *
 * Checked rather than trusted because the cast is inside the upsert, and a value Postgres refuses
 * (`2026-02-30`, or a datetime where a date was promised) would fail the statement, and with it the
 * whole item's sync, over one malformed field. The value stays in `plaid_raw` either way, so a
 * null here loses nothing that a later reader could not recover. The calendar check is done with
 * `Date.UTC` on the parsed parts, so it involves no local zone either.
 */
function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? value : null;
}

/**
 * The transaction object for `plaid_raw`: as received, minus `counterparties[*].account_numbers`.
 *
 * EXACTLY THAT ONE KEY, and by name rather than by a deep scrub for anything that looks like an
 * account number. `account_numbers` (BACS sort code and account, IBAN and BIC) is the only part of
 * the object that identifies a THIRD PARTY's bank account (BUILD.md §10.3). A pattern-based scrub
 * would also take `payment_meta.reference_number` or `ppd_id` the first time one looked numeric,
 * and those are deliberately kept (G0 decision recorded in the spec). Every other key — null-valued
 * ones included — is kept, and nothing is added: no `mapped_category`, no `id`, nothing the app
 * derived. A counterparty that has no `account_numbers` key comes out unchanged.
 *
 * NEW OBJECTS, NEVER AN EDIT IN PLACE. The same `txn` is still read after this — for its amount,
 * date and name in the upsert's own parameters, and by anything later added to the loop — and a
 * `delete` on the response would make what those see depend on whether the mapping had run yet. The
 * top level and each counterparty are shallow-copied; nothing nested is shared and then altered.
 *
 * Null-safe on shape, because one odd transaction must not fail the batch: `counterparties` absent
 * or not an array is passed through as received, and a non-object element is kept as it is.
 */
export function redactedPlaidTransaction(txn: Transaction): Record<string, unknown> {
  const source = txn as unknown as Record<string, unknown>;
  const counterparties = source.counterparties;
  if (!Array.isArray(counterparties)) return { ...source };
  return {
    ...source,
    counterparties: counterparties.map((c: unknown) => {
      if (c === null || typeof c !== 'object' || Array.isArray(c)) return c;
      const { account_numbers: _removed, ...kept } = c as Record<string, unknown>;
      return kept;
    }),
  };
}

/**
 * The eleven enrichment values Plaid's latest statement of `txn` makes. Every field is read
 * null-safely: `personal_finance_category: null`, a `location` that is missing outright, or a
 * key the SDK marks optional and Plaid leaves out all yield null for that column, not a throw.
 */
export function plaidEnrichment(txn: Transaction): PlaidEnrichment {
  // Optional chaining on the objects the SDK types as always present, deliberately: the type
  // describes Plaid's documentation, and a sync that throws on the first transaction whose
  // `location` is absent loses the whole item for a field this table can live without.
  const pfc = txn.personal_finance_category ?? null;
  const loc = (txn.location ?? null) as Partial<Transaction['location']> | null;
  return {
    plaidCategoryDetailed: text(pfc?.detailed),
    plaidCategoryConfidence: text(pfc?.confidence_level),
    authorizedDate: calendarDate(txn.authorized_date),
    paymentChannel: text(txn.payment_channel),
    merchantEntityId: text(txn.merchant_entity_id),
    logoUrl: text(txn.logo_url),
    website: text(txn.website),
    locationCity: text(loc?.city),
    locationRegion: text(loc?.region),
    locationCountry: text(loc?.country),
    // Redacted first, then made storable: the redaction decides which keys exist, and the
    // sanitiser only ever rewrites characters inside the strings that remain.
    plaidRaw: JSON.stringify(storableJson(redactedPlaidTransaction(txn))),
  };
}

/**
 * The enrichment as the positional parameters `$10`–`$20` of sync's upserts, in column order:
 * plaid_category_detailed, plaid_category_confidence, authorized_date, payment_channel,
 * merchant_entity_id, logo_url, website, location_city, location_region, location_country,
 * plaid_raw. Both statements take the same list from here, so their columns cannot drift apart
 * in order or in count without both changing.
 */
export function enrichmentParams(e: PlaidEnrichment): (string | null)[] {
  return [
    e.plaidCategoryDetailed, e.plaidCategoryConfidence, e.authorizedDate, e.paymentChannel,
    e.merchantEntityId, e.logoUrl, e.website, e.locationCity, e.locationRegion, e.locationCountry,
    e.plaidRaw,
  ];
}

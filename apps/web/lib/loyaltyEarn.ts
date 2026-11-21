// Loyalty (P8-42b2) — a linked card's earn description, and the two figures derived from it on every
// read: what the card's spend should have earned since the current reading (`earnEstimate`), and how
// the last such estimate compared with what the program then reported (`earnComparison`).
//
// ─── CONFIGURATION IS STORED, FIGURES ARE NOT ─────────────────────────────────────────────────
//
// The base rate (`loyalty_memberships.earn_base_rate`) and the ordered bonus rules
// (`loyalty_earn_rules`) are what a person typed, so they are stored, and `replaceEarn` is their one
// writer. Nothing derived from them is: no estimate, comparison, spend figure, period or "worth a
// look" mark exists in any table. Each would go stale on the next sync, the next reading or the next
// rule edit, and a stored copy beside a derived one is two answers that can disagree. So editing a
// rate changes the figures for past windows too, on the next read (SPEC.md Open question 15).
//
// ─── THE LEDGER IS READ ONCE, THROUGH THE GIFT READ PATH, AS NOBODY ────────────────────────────
//
// The card's rows come from `visibleTransactions(null)` with every `gift_masked` row dropped, exactly
// as the fee watch reads them (`loyaltyStore.ts`). Reading as the signed-in person would let the
// giver, who sees a held row's real name, get a merchant-rule price the recipient does not: a figure
// that differs by viewer, which the gift rules forbid. Read as `null`, a held row is no spend for
// anybody, and it enters on its reveal date. The cost — a brief underestimate while a purchase is
// held — is covered by the word "estimated" (SPEC.md Open question 6).
//
// ─── EVERY FIGURE IS POSTGRES'S ───────────────────────────────────────────────────────────────
//
// Amounts are NUMERIC(12,2) and rates NUMERIC(7,4), so each product is exact; they are summed in
// NUMERIC and rounded ONCE, by `round(numeric, scale)` (halves away from zero), to the unit's scale.
// Rounding per row or per rule would disagree with that in the half cases, and a JS number cannot
// hold most two-decimal amounts exactly to begin with, so no amount, rate or product ever reaches
// JavaScript: only the rounded total leaves the database, as text. The comparison's percentage is
// rounded once too, from the two figures as emitted. Dates are compared with CURRENT_DATE inside the
// same statement and leave as `::text`; no JS clock is consulted, so the server's zone cannot move a
// window by a day.
//
// ─── "CURRENT" AND "PREVIOUS" ARE THE SHARED REDUCER'S ────────────────────────────────────────
//
// The estimate starts after the current reading, which the store already picks with the repo's one
// newest-wins reducer. The comparison also needs the reading before it: the newest reading on an
// EARLIER date. That is the same reducer run over the readings whose as-of differs from the current
// one's — every reading is on or before the current date, so "differs" is "earlier" — which keeps a
// typed correction on the current date from becoming its own "previous" (a zero-day window), and an
// older-dated reading entered late from moving anything. No date is compared here to find it.

import type { PoolClient } from 'pg';
import { visibleTransactions } from './giftReadPath';
import { currentObservationByMembership } from './domain/loyalty';
import type { ObservationRow, Queryable } from './loyaltyStore';
import {
  LOYALTY_EARN_FALLBACK_DAYS,
  isEarnMiss,
  type LoyaltyEarn,
  type LoyaltyEarnComparison,
  type LoyaltyEarnEstimate,
  type LoyaltyEarnInput,
  type LoyaltyEarnMatchKind,
  type LoyaltyEarnUnit,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';

// ─── The description ───────────────────────────────────────────────────────────────────────────

/**
 * The stored earn descriptions of the given memberships (all of them when `ids` is null), by id. A
 * membership with no base rate has no description and is absent. Rates leave the database as the
 * column's `::text` — exactly four decimals — and the rules in stored (match) order.
 */
export async function earnDescriptionsOf(q: Queryable, ids: number[] | null): Promise<Map<number, LoyaltyEarn>> {
  const [bases, rules] = await Promise.all([
    q.query<{ id: number; base: string }>(
      `SELECT id, earn_base_rate::text AS base FROM loyalty_memberships
        WHERE earn_base_rate IS NOT NULL AND ($1::int[] IS NULL OR id = ANY($1::int[]))`,
      [ids]
    ),
    q.query<{ membershipId: number; kind: LoyaltyEarnMatchKind; match: string; rate: string }>(
      `SELECT membership_id AS "membershipId", match_kind AS kind, match_text AS match, rate::text AS rate
         FROM loyalty_earn_rules
        WHERE $1::int[] IS NULL OR membership_id = ANY($1::int[])
        ORDER BY membership_id, position`,
      [ids]
    ),
  ]);
  const out = new Map<number, LoyaltyEarn>(bases.rows.map((b) => [b.id, { baseRate: b.base, rules: [] }]));
  // A rule row without a base rate cannot be written through the route (one transaction sets both);
  // if one existed it would describe nothing, so it is not shown as a half description.
  for (const r of rules.rows) out.get(r.membershipId)?.rules.push({ kind: r.kind, match: r.match, rate: r.rate });
  return out;
}

/**
 * Replaces a membership's whole earn description inside the caller's transaction: the base rate and
 * every rule, or — for `null` — no base rate and no rules. The rules are written at positions one
 * to n in the submitted order, which is the match order. Match text is stored trimmed (the table's
 * CHECK refuses anything else). A constraint failure throws, and the caller's ROLLBACK leaves the old
 * description exactly as it was: never half replaced.
 */
export async function replaceEarn(client: PoolClient, id: number, earn: LoyaltyEarnInput | null): Promise<void> {
  await client.query('UPDATE loyalty_memberships SET earn_base_rate = $2::numeric WHERE id = $1', [id, earn?.baseRate ?? null]);
  await client.query('DELETE FROM loyalty_earn_rules WHERE membership_id = $1', [id]);
  if (earn === null || earn.rules.length === 0) return;
  await client.query(
    `INSERT INTO loyalty_earn_rules (membership_id, position, match_kind, match_text, rate)
     SELECT $1, r.ord, r.kind, r.match, r.rate
       FROM unnest($2::text[], $3::text[], $4::numeric[]) WITH ORDINALITY AS r(kind, match, rate, ord)`,
    [id, earn.rules.map((r) => r.kind), earn.rules.map((r) => r.match.trim()), earn.rules.map((r) => r.rate)]
  );
}

// ─── The spend rule ────────────────────────────────────────────────────────────────────────────
//
// THE RULE (SPEC.md Conventions, "Spend rule"), stated once, in SQL. A row of the linked card counts
// only if it is not held by a gift, not in a transfer group, not in a transfer-shaped category (the
// case-folded substring test `isTransferCategory` makes, so a half-paired transfer filed `Transfer`
// with no group yet is out), and not exactly zero; and then:
//
//   A PURCHASE (amount > 0, money out on a card) counts unless its name holds an annual-fee phrase as
//   whole words — every such debit, refunded or not, latest or not. No other word removes a purchase:
//   a charge whose name says "payment" is real spend.
//
//   A CREDIT (amount < 0) counts as a refund only when it carries a category, that category is not an
//   income category (an EXISTS on the name, never a JOIN, which a name present in two landscapes
//   would double), its name holds none of the payment, transfer, loan, deposit, interest, reward and
//   fee words, and it is not the refund of an annual fee: refund-worded, equal to the negated amount
//   of an annual-fee debit on the same card dated on or before it (NUMERIC equality). The sign alone
//   would make a card payment, an income credit or a loan disbursement look like a giant refund.
//
// Only `name` is read for the word tests, folded to lower case with every run of whitespace collapsed
// to one space. The Plaid categories and the raw Plaid object never decide anything, so a card with
// no Plaid feed behaves exactly like one with. `hidden`, `exclude_from_budget`, the landscape and the
// account's `is_liability` are not consulted: a hidden purchase still earned.
//
// "Whole words" means bounded by the ends of the text or by a character that is neither a letter nor
// a digit. POSIX classes, no backslashes, as the fee watch writes them.

const fold = (expr: string) => `regexp_replace(lower(coalesce(${expr}, '')), '[[:space:]]+', ' ', 'g')`;
const wholeWords = (alternatives: string) => `'(^|[^[:alnum:]])(${alternatives})($|[^[:alnum:]])'`;

const FEE_WORDS = wholeWords('annual (membership )?fee');
const NOT_A_REFUND_WORDS = wholeWords(
  'payments?|autopay|thank you|transfer|xfer|payoff|disbursement|loan|deposit|interest|rewards?|redemption|cashback|cash back|statement credit|annual (membership )?fee'
);
const REFUND_WORDS = wholeWords('refund|reversal|reversed');

/**
 * A merchant rule's text as a pattern that matches it LITERALLY, as a whole-word phrase: folded like
 * the row's name, then every character that is not a letter or a digit is backslash-escaped, which in
 * a Postgres ARE makes it stand for itself. So a `%`, `.`, `(` or `+` in the text — which the request
 * schema refuses anyway — could never act as a pattern character, and a pattern character in the
 * ROW's name is only ever the subject. String.raw keeps the replacement's backslashes as Postgres
 * must see them.
 */
const literalPhrase = (expr: string) =>
  String.raw`'(^|[^[:alnum:]])' || regexp_replace(${fold(expr)}, '([^[:alnum:]])', '\\\1', 'g') || '($|[^[:alnum:]])'`;

/**
 * First match wins, in stored order (ascending `position`, unique per membership, so there is no
 * tie). A category rule is exact equality after trimming and case-folding — never a prefix, a
 * substring or a pattern, so a `%` in it is a percent sign. A merchant rule is the literal phrase in
 * the row's name OR its merchant name; a null merchant name never matches. No rule: the base rate.
 */
const MATCHED_RATE = `COALESCE(
    (SELECT r.rate FROM loyalty_earn_rules r
      WHERE r.membership_id = w.membership_id
        AND ((r.match_kind = 'category' AND s.mapped_category IS NOT NULL
              AND lower(btrim(s.mapped_category)) = lower(btrim(r.match_text)))
          OR (r.match_kind = 'merchant'
              AND (s.folded ~ (${literalPhrase('r.match_text')})
                   OR (s.merchant_name IS NOT NULL AND ${fold('s.merchant_name')} ~ (${literalPhrase('r.match_text')})))))
      ORDER BY r.position LIMIT 1),
    m.earn_base_rate)`;

/**
 * One row per window. A window is a membership, its card, the exclusive start `since` (null: the
 * no-reading fallback, CURRENT_DATE minus the fallback-days parameter), the inclusive end `until`
 * (null: CURRENT_DATE; never later than CURRENT_DATE either way), the unit's scale, and — for a
 * comparison window — the two readings' balances. It answers the start as text, the priced sum rounded once, and for a
 * comparison the actual change and the percentage, both exact NUMERIC until their own single round.
 */
const EARN_SQL = `
  WITH w AS (
    SELECT x.k, x.membership_id, x.account_id,
           COALESCE(x.since, CURRENT_DATE - $7::int) AS since,
           LEAST(COALESCE(x.until, CURRENT_DATE), CURRENT_DATE) AS until,
           x.scale, x.cur, x.prev
      FROM unnest($1::int[], $2::int[], $3::text[], $4::date[], $5::date[], $6::int[], $8::numeric[], $9::numeric[])
           AS x(k, membership_id, account_id, since, until, scale, cur, prev)
  ),
  card_rows AS (
    SELECT t.id, t.account_id, t.date, t.amount, t.mapped_category, t.merchant_name, t.transfer_group_id,
           ${fold('t.name')} AS folded
      FROM ${visibleTransactions(null)} t
     WHERE t.account_id IN (SELECT account_id FROM w) AND NOT t.gift_masked
  ),
  fee_debits AS (
    SELECT account_id, date, amount FROM card_rows WHERE amount > 0 AND folded ~ ${FEE_WORDS}
  ),
  spend AS (
    SELECT c.account_id, c.date, c.amount, c.mapped_category, c.merchant_name, c.folded
      FROM card_rows c
     WHERE c.transfer_group_id IS NULL
       AND position('transfer' IN lower(coalesce(c.mapped_category, ''))) = 0
       AND c.amount <> 0
       AND ((c.amount > 0 AND NOT c.folded ~ ${FEE_WORDS})
         OR (c.amount < 0
             AND c.mapped_category IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM budget_categories bc WHERE bc.name = c.mapped_category AND bc.is_income)
             AND NOT c.folded ~ ${NOT_A_REFUND_WORDS}
             AND NOT (c.folded ~ ${REFUND_WORDS}
                      AND EXISTS (SELECT 1 FROM fee_debits f
                                   WHERE f.account_id = c.account_id AND f.amount = -c.amount AND f.date <= c.date))))
  ),
  priced AS (
    SELECT w.k, s.amount * ${MATCHED_RATE} AS term
      FROM w
      JOIN loyalty_memberships m ON m.id = w.membership_id
      JOIN spend s ON s.account_id = w.account_id AND s.date > w.since AND s.date <= w.until
  )
  SELECT w.k, w.since::text AS since, e.figure::text AS figure,
         (w.cur - w.prev)::text AS actual,
         CASE WHEN e.figure = 0 THEN NULL
              ELSE round(100 * ((w.cur - w.prev) - e.figure) / abs(e.figure), 1)::text END AS percent
    FROM w
    CROSS JOIN LATERAL (
      SELECT round(COALESCE((SELECT sum(p.term) FROM priced p WHERE p.k = w.k), 0), w.scale) AS figure
    ) e`;

// ─── The figures ───────────────────────────────────────────────────────────────────────────────

/** What the figures need to know about one membership. */
export interface EarnSubject {
  id: number;
  cardAccountId: string | null;
  programDefaultUnit: LoyaltyUnit;
}

export interface EarnFigures {
  earnEstimate: LoyaltyEarnEstimate | null;
  earnComparison: LoyaltyEarnComparison | null;
}

const NO_FIGURES: EarnFigures = { earnEstimate: null, earnComparison: null };

/** `nights` has no per-currency earn: no figure at all, never a zero. */
const earnUnit = (unit: LoyaltyUnit): LoyaltyEarnUnit | null => (unit === 'nights' ? null : unit);
const scaleOf = (unit: LoyaltyEarnUnit) => (unit === 'usd' ? 2 : 0);

/**
 * The previous reading of every membership that has one: the shared reducer's newest among the
 * readings NOT on the current reading's date (see the header).
 */
function previousReadings(readings: readonly ObservationRow[], current: Map<number, ObservationRow>): Map<number, ObservationRow> {
  return currentObservationByMembership(readings.filter((r) => r.asOf !== current.get(r.membershipId)?.asOf));
}

/**
 * The derived figures of every subject, by id, in ONE statement however many there are. A subject
 * with no card or no stored description gets two nulls; so does one whose unit is `nights`. The
 * comparison also needs a previous reading in the same unit. Writes nothing.
 */
export async function earnFiguresOf(
  q: Queryable,
  subjects: readonly EarnSubject[],
  descriptions: Map<number, LoyaltyEarn>,
  readings: readonly ObservationRow[]
): Promise<Map<number, EarnFigures>> {
  const current = currentObservationByMembership(readings);
  const previous = previousReadings(readings, current);

  type Window = { membershipId: number; card: string; since: string | null; until: string | null; unit: LoyaltyEarnUnit; cur: string | null; prev: string | null };
  const windows: Window[] = [];
  const plan = new Map<number, { estimate: number; comparison: number | null; basis: LoyaltyEarnEstimate['basis'] }>();
  for (const s of subjects) {
    if (s.cardAccountId === null || !descriptions.has(s.id)) continue;
    const now = current.get(s.id);
    const unit = earnUnit(now?.unit ?? s.programDefaultUnit);
    if (unit === null) continue;
    const estimate = windows.push({ membershipId: s.id, card: s.cardAccountId, since: now?.asOf ?? null, until: null, unit, cur: null, prev: null }) - 1;
    const before = previous.get(s.id);
    const comparison = now !== undefined && before !== undefined && before.unit === now.unit
      ? windows.push({ membershipId: s.id, card: s.cardAccountId, since: before.asOf, until: now.asOf, unit, cur: now.balance, prev: before.balance }) - 1
      : null;
    plan.set(s.id, { estimate, comparison, basis: now === undefined ? 'last_30_days' : 'reading' });
  }

  const out = new Map<number, EarnFigures>(subjects.map((s) => [s.id, NO_FIGURES]));
  if (windows.length === 0) return out;
  const r = await q.query<{ k: number; since: string; figure: string; actual: string | null; percent: string | null }>(EARN_SQL, [
    windows.map((_, i) => i),
    windows.map((x) => x.membershipId),
    windows.map((x) => x.card),
    windows.map((x) => x.since),
    windows.map((x) => x.until),
    windows.map((x) => scaleOf(x.unit)),
    LOYALTY_EARN_FALLBACK_DAYS,
    windows.map((x) => x.cur),
    windows.map((x) => x.prev),
  ]);
  const row = new Map(r.rows.map((x) => [x.k, x]));
  for (const [id, p] of plan) {
    const e = row.get(p.estimate);
    const unit = windows[p.estimate].unit;
    if (e === undefined) continue;
    const c = p.comparison === null ? undefined : row.get(p.comparison);
    const w = p.comparison === null ? undefined : windows[p.comparison];
    out.set(id, {
      earnEstimate: { since: e.since, basis: p.basis, unit, amount: e.figure },
      earnComparison: c === undefined || w === undefined || c.actual === null ? null : {
        from: w.since as string,
        to: w.until as string,
        unit,
        estimated: c.figure,
        actual: c.actual,
        differencePercent: c.percent,
        // Decided on the emitted figures by the contract's own exact rule, never on the rounded percentage.
        worthALook: isEarnMiss(c.figure, c.actual),
      },
    });
  }
  return out;
}

// Gifts (P7-41b) — THE READ PATH. The one module through which every viewer-facing read of a ledger
// row's text passes, and the only one in the application allowed to read that text from
// `transactions` directly.
//
// ─── WHY A ROW SOURCE AND NOT A FILTER ────────────────────────────────────────────────────────
//
// There are some thirty readers of a transaction's name, merchant, note or enrichment in this app —
// pages, routes, the digest, the chat tools, the suggester, the forecast — each with its own SQL,
// written over three years for its own reasons. A masking rule applied reader by reader is thirty
// chances to forget a column, and the one forgotten is the one that leaks. So the rule is applied
// one level down instead: `visibleTransactions(viewer)` is a drop-in for `transactions` in a FROM
// clause. It has every column the table has, under the same names, with the secret ones already
// masked by Postgres for this viewer, plus one more (`gift_masked`). A reader converted to it keeps
// its WHERE, its ORDER BY and its label chain unchanged, and cannot select a real merchant for the
// recipient because the relation it reads does not contain one.
//
// `lib/giftSurfaceWiring.test.ts` (W1) enforces the other half: no file outside this one and the
// registered exemptions reads a protected column from `transactions` itself. Figures that sum or
// count — budgets, P/L, net worth, balances — keep reading `transactions`: they select no protected
// column, so masking cannot reach them, which is how totals stay identical across viewers.
//
// ─── THE PREDICATE IS THE MIGRATION'S, VERBATIM ───────────────────────────────────────────────
//
// `migrations/1792400000000_gifts.sql` writes the masking predicate down once; `giftMaskedSql` is
// that text with the alias and viewer filled in. Evaluated by Postgres, on its own calendar, in the
// statement that reads the row — never a JS clock, never a stored flag. `IS DISTINCT FROM` makes a
// NULL viewer a non-giver with no special case.
//
// ─── THE VIEWER IS INLINED AS A LITERAL, AND THAT IS SAFE HERE ────────────────────────────────
//
// A placeholder would make every caller renumber its `$n` arguments, in queries that build their
// argument lists dynamically — a refactor whose failure mode is a silently shifted parameter. The
// viewer is instead written into the SQL as an integer literal, which is safe for exactly one
// reason: `viewerLiteral` emits only the digits of a positive safe integer, or `NULL`. Anything else
// — `NaN`, a negative, a fraction, a value smuggled past the type — becomes `NULL`, which is the
// fail-closed answer: a viewer that is not a well-formed user id is a non-giver.

import { GIFT_LABEL, TRANSACTION_COLUMN_MASK, type GiftViewer } from './domain/giftMask';

export type { GiftViewer } from './domain/giftMask';

/** `viewer` as SQL: the digits of a user id, or `NULL`. Never anything a string could inject. */
function viewerLiteral(viewer: GiftViewer): string {
  return typeof viewer === 'number' && Number.isSafeInteger(viewer) && viewer > 0 ? String(viewer) : 'NULL';
}

/** A SQL identifier this module will interpolate: letters, digits and underscores only. */
function alias(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('giftReadPath: invalid alias');
  return name;
}

/**
 * THE MASKING PREDICATE — true when the row `a` is masked for `viewer`. The migration's text.
 * A predicate helper: it returns a boolean expression, not rows.
 */
export function giftMaskedSql(a: string, viewer: GiftViewer): string {
  return `EXISTS (SELECT 1 FROM gift_transactions gt JOIN gifts g ON g.id = gt.gift_id
                   WHERE gt.transaction_id = ${alias(a)}.id
                     AND g.reveal_date > CURRENT_DATE
                     AND g.giver_user_id IS DISTINCT FROM ${viewerLiteral(viewer)}::int)`;
}

/**
 * True when the row `a` is held by a gift that is not yet revealed, WHOEVER is looking — the
 * predicate with no viewer conjunct. What locks a row against edits, and what keeps a gift row out
 * of the lists that group by merchant for everyone (recurring charges, the overdraft forecast, the
 * category suggester's history). A predicate helper, not a row source.
 */
export function giftHeldSql(a: string): string {
  return `EXISTS (SELECT 1 FROM gift_transactions gt JOIN gifts g ON g.id = gt.gift_id
                   WHERE gt.transaction_id = ${alias(a)}.id
                     AND g.reveal_date > CURRENT_DATE)`;
}

/**
 * True when the row `a` is linked to any gift at all, revealed or not. Rule writes skip these rows
 * outright: a gift's category is the gift's, and a rule re-filing it — before the reveal or after —
 * would move a row the giver filed by marking it. A predicate helper, not a row source.
 */
export function giftLinkedSql(a: string): string {
  return `EXISTS (SELECT 1 FROM gift_transactions gt WHERE gt.transaction_id = ${alias(a)}.id)`;
}

/** One column of the row source, as `TRANSACTION_COLUMN_MASK` says to project it. */
function projected(column: string, treatment: 'keep' | 'null' | 'label' | 'false'): string {
  switch (treatment) {
    case 'keep': return `tx.${column}`;
    case 'label': return `CASE WHEN gm.masked THEN '${GIFT_LABEL}' ELSE tx.${column} END AS ${column}`;
    case 'false': return `CASE WHEN gm.masked THEN FALSE ELSE tx.${column} END AS ${column}`;
    case 'null': return `CASE WHEN gm.masked THEN NULL ELSE tx.${column} END AS ${column}`;
  }
}

/**
 * `transactions` as `viewer` may see it — a parenthesised subquery to use in place of the table:
 *
 *     FROM ${visibleTransactions(viewer)} t JOIN accounts a ON a.id = t.account_id
 *
 * Every column of `transactions`, same names and types, masked per `TRANSACTION_COLUMN_MASK` for a
 * row this viewer may not see yet; plus `gift_masked`, true on exactly those rows, so a reader that
 * must treat them differently (no edit controls, no merchant-rule offer) can say so without asking
 * a second question.
 *
 * `viewer` is not optional, and `null` is a legal value that means "nobody we can name": the
 * digest, the suggester and the forecast read as `null`, which masks every unrevealed gift.
 */
export function visibleTransactions(viewer: GiftViewer): string {
  const columns = Object.entries(TRANSACTION_COLUMN_MASK).map(([column, treatment]) => projected(column, treatment));
  return `(SELECT ${columns.join(', ')}, gm.masked AS gift_masked
             FROM transactions tx
             CROSS JOIN LATERAL (SELECT ${giftMaskedSql('tx', viewer)} AS masked) gm)`;
}

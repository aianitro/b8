// The rules page's TOTAL and UNCATEGORIZED columns, and the one predicate that separates them.
//
// ─── WHY THIS ASSERTS AGAINST QUERY SOURCE RATHER THAN CALLING A PURE FUNCTION ─────────────────
//
// Both figures are computed by a GROUP BY inside `app/rules/page.tsx`, over the whole ledger. There
// is no pure aggregator to call: moving the tally into JS would mean selecting every transaction
// into the server component to count it, so the counting has to stay in SQL, and a pure helper
// mirroring it would be a second spelling that the page does not use — the thing that drifts.
//
// `lib/domain/monthOutlook.test.ts` hit the same wall for that module's positive-amount filter and
// settled it this way, with the same reasoning written out at its own coverage-query assertions.
// This follows that precedent deliberately rather than inventing a third convention.
//
// NO FIXTURES AND NO DATABASE. The assertions are about which rows each column admits, which is a
// statement about the query text; whether Postgres then counts correctly is not in doubt.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE_SOURCE = readFileSync(new URL('../app/rules/page.tsx', import.meta.url), 'utf8');

/**
 * The category-table query, sliced out of the page so an assertion cannot match one of the three
 * sibling queries beside it — the payee counts and `pendingApply` both mention `hidden` and
 * `mapped_category` too, and a whole-file `toContain` would pass on either of them.
 *
 * Slicing on the template-literal delimiters doubles as a guard on this repo's standing hazard: a
 * backtick used to quote a SQL identifier in here would close the JS string, and this slice would
 * end early and take the assertions with it.
 */
function categoryQuerySql(): string {
  const at = PAGE_SOURCE.indexOf('db.query<RuleRow>(');
  if (at === -1) throw new Error('the RuleRow query is no longer in app/rules/page.tsx');
  const open = PAGE_SOURCE.indexOf('`', at);
  const close = PAGE_SOURCE.indexOf('`', open + 1);
  // SQL line comments dropped, so every assertion below is about a predicate the database will
  // actually apply. The query is heavily commented and those comments name the same columns and
  // predicates they explain — counting `hidden` across the raw slice measures the prose, and an
  // assertion a comment can satisfy is an assertion that passes after the predicate is deleted.
  return PAGE_SOURCE.slice(open + 1, close).replace(/--[^\n]*/g, '');
}

describe('the rules table counts, where the population is decided', () => {
  it('scopes UNCATEGORIZED to rows that can actually be filed, matching every other unfiled figure in the app', () => {
    const sql = categoryQuerySql();
    const filter = sql.slice(sql.indexOf('FILTER ('), sql.indexOf('AS uncategorized'));

    // The whole fix. A hidden row is excluded from budget and dashboard calcs (db/schema.sql says
    // so on the column), so an amber "needs filing" badge that counts one reports work the owner
    // cannot clear: filing it moves no figure anywhere. Without this predicate the column read
    // higher than the dashboard's Uncategorized card and higher than the list behind the ledger's
    // own uncategorized filter, both of which spell the population this same way.
    expect(filter).toContain('t.mapped_category IS NULL');
    expect(filter).toContain('t.hidden = FALSE');
  });

  it('leaves TOTAL unfiltered, because that column describes the list a reader can open', () => {
    const sql = categoryQuerySql();

    // Asserted as an unfiltered aggregate rather than by the absence of a word: a hidden row is
    // "still visible (grayed out) on /transactions", and the ledger's own total counts it, so
    // copying the uncategorized predicate up here would make this column disagree with the page it
    // describes. That is a real temptation — the two columns sit side by side — so the asymmetry is
    // pinned rather than left to a reader's judgement.
    expect(sql).toContain('COUNT(t.id)::int AS count,');

    // Exactly one mention of `hidden` in the query: the uncategorized filter and nowhere else.
    expect(sql.match(/hidden/g)).toHaveLength(1);
  });

  it('keeps both columns scoped to tracked accounts, which is the regression this area already had once', () => {
    const sql = categoryQuerySql();

    // A count that outran the list it described, because one side filtered untracked accounts and
    // the other did not. Both columns are computed from this one join, so the scope is asserted on
    // the join rather than per column.
    expect(sql).toContain('JOIN accounts a ON a.id = t.account_id AND a.track_transactions');
  });

  it('still restricts the table to rows that have a Plaid category', () => {
    // The backlog note that sent anyone here guessed at a missing `plaid_category` filter. It is
    // present and always was; this pins it so the guess stays answered rather than re-asked.
    expect(categoryQuerySql()).toContain('WHERE t.plaid_category IS NOT NULL');
  });
});

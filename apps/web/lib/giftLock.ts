// Gifts (P7-41b) — WHICH EDITS A HELD ROW REFUSES (SPEC.md Open question 5).
//
// While a gift holds a row and its reveal date has not come, the row is locked:
//
//   * NOBODY may change its category, delete it, or link it into a transfer (an ordinary transfer
//     pair or a cash transfer). Any of those would move it out of the gift category or out of the
//     ledger, which either unmasks it by accident or changes a total the giver chose — and, for a
//     delete, writes a tombstone that loses the gift for good. The giver's release is `cancel`.
//   * A NON-GIVER also may not hide it, or edit its note, watch flag or property. Those are edits to
//     a row they cannot see, and each answer the edit could produce (a note field that says
//     something, a flag that was already set) is a question about content that is not theirs yet.
//   * The giver may still do those four: they are the giver's own bookkeeping on a row they can see.
//
// ONE REFUSAL, WORD FOR WORD, WHATEVER WAS ASKED. Every locked write answers the same status, code
// and message, so the refusal itself says nothing about which field mattered or what the row holds.
// It never carries row text.
//
// CHECKED BEFORE THE WRITE AND AGAIN INSIDE IT. `lockedFor` answers the question for the response;
// the writers also put `NOT (lockSql)` in their own WHERE, so a gift that linked the row between the
// two statements still cannot be written through.

import db from './db';
import { giftHeldSql, giftMaskedSql, type GiftViewer } from './giftReadPath';
import type { Queryable } from './giftStore';

/** What a write would change. */
export type GiftLockedEdit = 'category' | 'delete' | 'transfer' | 'hidden' | 'note' | 'watch' | 'property';

/** The edits refused even to the giver. */
const LOCKED_FOR_EVERYONE: ReadonlySet<GiftLockedEdit> = new Set(['category', 'delete', 'transfer']);

/** The refusal, as an API envelope. Identical for every edit and every viewer. */
export const GIFT_LOCKED_ERROR = {
  code: 'GIFT_LOCKED',
  message: 'This transaction cannot be changed until its reveal date.',
} as const;

/** HTTP status of the refusal — the same as the gift routes' other state conflicts. */
export const GIFT_LOCKED_STATUS = 409;

/**
 * The SQL condition under which `edit` is refused for `viewer` on the row aliased `a` — for a
 * writer's own WHERE clause, as `AND NOT (${giftLockSql(...)})`.
 */
export function giftLockSql(a: string, edit: GiftLockedEdit, viewer: GiftViewer): string {
  return LOCKED_FOR_EVERYONE.has(edit) ? giftHeldSql(a) : giftMaskedSql(a, viewer);
}

/** Whether `edit` is refused for `viewer` on any of `ids`. */
export async function lockedFor(
  ids: readonly number[],
  edit: GiftLockedEdit,
  viewer: GiftViewer,
  q: Queryable = db,
): Promise<boolean> {
  const clean = ids.filter((id) => Number.isSafeInteger(id));
  if (clean.length === 0) return false;
  const { rows } = await q.query<{ locked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM transactions t
                     WHERE t.id = ANY($1::int[]) AND ${giftLockSql('t', edit, viewer)}) AS locked`,
    [clean],
  );
  return rows[0]?.locked === true;
}

/** The refusal as a route answers it. */
export function giftLockedResponse(): Response {
  return Response.json({ success: false, error: GIFT_LOCKED_ERROR }, { status: GIFT_LOCKED_STATUS });
}

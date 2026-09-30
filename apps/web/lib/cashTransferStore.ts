/**
 * Recording cash arriving somewhere — the leg no feed will ever produce.
 *
 * ─── WHY THIS EXISTS WHEN `POST /api/v1/transfers` ALREADY GROUPS TRANSFERS ───────────────────
 *
 * That endpoint links transactions that already exist. Every transfer it has ever handled had both
 * sides on a feed: money left one bank and arrived at another, and two rows turned up to be paired.
 *
 * Cash has no feed on the receiving side. An ATM withdrawal produces exactly one row, forever, and
 * the wallet it funded produces none — so there is nothing to pair with and the existing endpoint
 * cannot help. Left alone the money leaves a tracked balance and lands nowhere, until the next count
 * finds it and reports it as `found`: money from nowhere, which is both wrong and unhelpful.
 *
 * So the missing capability is narrow. Create the row that will never arrive on its own, then hand
 * the pair to the rules that already decide what a transfer is. Those rules are NOT restated here —
 * `validateTransferRows` is imported and run against the rows as written, so the sum-to-zero
 * invariant is enforced by the same code the ledger's own multi-select uses. Constructing the mirror
 * makes the sum zero by arithmetic; checking it anyway is what catches the day the arithmetic stops
 * being true.
 */
import { randomUUID } from 'node:crypto';
import db from '@/lib/db';
import { validateTransferRows } from '@/lib/transferValidation';
import { roundCents } from '@/lib/budgetMath';

export type CashTransferArgs =
  /** An existing transaction — a withdrawal — put cash into a wallet. */
  | { kind: 'fund'; anchorTransactionId: number; toAccountId: string }
  /** Cash moved from one wallet to another, with no bank involved at either end. */
  | { kind: 'move'; fromAccountId: string; toAccountId: string; amount: number; date: string };

export type CashTransferResult =
  | { ok: true; groupId: number; createdTransactionIds: number[] }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'NOT_COUNTABLE' | 'ALREADY_GROUPED' | 'INVALID' | 'UNBALANCED';
      message: string;
    };

/** Money out is positive, money in is negative — the convention the whole ledger uses. */
const OUT = (n: number) => roundCents(Math.abs(n));
const IN = (n: number) => roundCents(-Math.abs(n));

async function isCountable(client: { query: typeof db.query }, accountId: string): Promise<boolean | null> {
  const r = await client.query<{ countable: boolean }>(
    'SELECT countable FROM accounts WHERE id = $1',
    [accountId]
  );
  return r.rows.length === 0 ? null : r.rows[0].countable;
}

export async function recordCashTransfer(args: CashTransferArgs): Promise<CashTransferResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const rowsToCreate: { accountId: string; amount: number; date: string; name: string }[] = [];
    let anchorId: number | null = null;

    if (args.kind === 'fund') {
      const anchor = await client.query<{ id: number; amount: string; date: string; transfer_group_id: number | null }>(
        `SELECT id, amount, to_char(date, 'YYYY-MM-DD') AS date, transfer_group_id
           FROM transactions WHERE id = $1 FOR UPDATE`,
        [args.anchorTransactionId]
      );
      if (anchor.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'NOT_FOUND', message: 'No such transaction.' };
      }
      const a = anchor.rows[0];
      if (a.transfer_group_id !== null) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          code: 'ALREADY_GROUPED',
          message: 'That transaction is already part of a transfer — unlink it first.',
        };
      }
      const countable = await isCountable(client, args.toAccountId);
      if (countable === null) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'NOT_FOUND', message: 'No such account.' };
      }
      if (!countable) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'NOT_COUNTABLE', message: 'Cash can only be received into a wallet.' };
      }

      anchorId = a.id;
      // The MIRROR of the anchor, not a fresh figure: whatever left the bank is what arrived, so the
      // amount is negated rather than re-entered. A typed amount here would let the two sides
      // disagree and the group would then fail its own sum-to-zero rule for no reason the owner
      // could see.
      rowsToCreate.push({
        accountId: args.toAccountId,
        amount: roundCents(-Number(a.amount)),
        date: a.date,
        name: 'Cash received',
      });
    } else {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || roundCents(amount) <= 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'INVALID', message: 'Enter an amount greater than zero.' };
      }
      if (args.fromAccountId === args.toAccountId) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'INVALID', message: 'Choose two different wallets.' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'INVALID', message: 'A date is required.' };
      }
      for (const id of [args.fromAccountId, args.toAccountId]) {
        const countable = await isCountable(client, id);
        if (countable === null) {
          await client.query('ROLLBACK');
          return { ok: false, code: 'NOT_FOUND', message: 'No such account.' };
        }
        if (!countable) {
          await client.query('ROLLBACK');
          return { ok: false, code: 'NOT_COUNTABLE', message: 'Both sides of a cash move must be wallets.' };
        }
      }
      rowsToCreate.push(
        { accountId: args.fromAccountId, amount: OUT(amount), date: args.date, name: 'Cash moved out' },
        { accountId: args.toAccountId, amount: IN(amount), date: args.date, name: 'Cash moved in' }
      );
    }

    const createdIds: number[] = [];
    for (const r of rowsToCreate) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category)
         VALUES ($1, $2, $3, $4, $5, 'Transfer') RETURNING id`,
        [`manual_${randomUUID()}`, r.accountId, r.date, r.amount, r.name]
      );
      createdIds.push(inserted.rows[0].id);
    }

    const memberIds = anchorId === null ? createdIds : [anchorId, ...createdIds];

    // The same validator the ledger's multi-select runs, against the rows as they now stand. The
    // mirror makes the sum zero by construction; this is what notices if it ever stops doing so.
    const members = await client.query<{ id: number; amount: string; transfer_group_id: number | null }>(
      'SELECT id, amount, transfer_group_id FROM transactions WHERE id = ANY($1)',
      [memberIds]
    );
    const invalid = validateTransferRows(memberIds, members.rows);
    if (invalid) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: invalid.code === 'UNBALANCED' ? 'UNBALANCED' : 'INVALID',
        message: invalid.message,
      };
    }

    const group = await client.query<{ id: number }>('INSERT INTO transfer_groups DEFAULT VALUES RETURNING id');
    const groupId = group.rows[0].id;
    await client.query(
      `UPDATE transactions SET transfer_group_id = $1, mapped_category = 'Transfer' WHERE id = ANY($2)`,
      [groupId, memberIds]
    );

    await client.query('COMMIT');
    return { ok: true, groupId, createdTransactionIds: createdIds };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

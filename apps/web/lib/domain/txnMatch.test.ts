import { describe, it, expect } from 'vitest';
import { matchReissuedTransactions, type ExistingTxn, type IncomingTxn } from './txnMatch';

const inc = (id: string, over: Partial<IncomingTxn> = {}): IncomingTxn => ({
  plaidTransactionId: id, accountId: 'acc', date: '2026-08-05', amount: 2.55, name: 'WEBOX', ...over,
});
const ex = (rowId: number, plaidId: string, over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id: rowId, plaidTransactionId: plaidId, accountId: 'acc', date: '2026-08-05', amount: 2.55, name: 'WEBOX', ...over,
});

describe('matchReissuedTransactions', () => {
  it('re-identifies a stored transaction that came back under a new id', () => {
    // The Chase re-auth case: same date, amount and description, new Plaid id.
    const r = matchReissuedTransactions([inc('NEW_ID')], [ex(1, 'OLD_ID')]);
    expect(r.reidentify).toEqual([{ existingId: 1, newPlaidTransactionId: 'NEW_ID' }]);
    expect(r.insert).toEqual([]);
  });

  it('inserts a transaction with no stored counterpart', () => {
    const r = matchReissuedTransactions([inc('NEW_ID', { amount: 99 })], [ex(1, 'OLD_ID')]);
    expect(r.reidentify).toEqual([]);
    expect(r.insert.map((t) => t.plaidTransactionId)).toEqual(['NEW_ID']);
  });

  it('leaves an unchanged id alone for the ordinary upsert path', () => {
    const r = matchReissuedTransactions([inc('SAME')], [ex(1, 'SAME')]);
    expect(r).toEqual({ reidentify: [], insert: [] });
  });

  it('does NOT collapse two genuinely separate identical purchases', () => {
    // Two $2.55 WEBOX charges on the same day are two transactions, not a duplicate. Claiming
    // is one-to-one, so two incoming rows consume two distinct stored rows.
    const r = matchReissuedTransactions([inc('N1'), inc('N2')], [ex(1, 'O1'), ex(2, 'O2')]);
    expect(r.reidentify).toEqual([
      { existingId: 1, newPlaidTransactionId: 'N1' },
      { existingId: 2, newPlaidTransactionId: 'N2' },
    ]);
    expect(r.insert).toEqual([]);
  });

  it('inserts only the surplus when Plaid reports more than are stored', () => {
    // One stored, two incoming: one is the same transaction re-identified, one is genuinely new.
    const r = matchReissuedTransactions([inc('N1'), inc('N2')], [ex(1, 'O1')]);
    expect(r.reidentify).toEqual([{ existingId: 1, newPlaidTransactionId: 'N1' }]);
    expect(r.insert.map((t) => t.plaidTransactionId)).toEqual(['N2']);
  });

  it('never re-identifies a row whose id Plaid still uses', () => {
    // O1 is present in the batch under its own id, so it is a live transaction. The separate
    // NEW_ID must insert rather than steal O1's row.
    const r = matchReissuedTransactions([inc('O1'), inc('NEW_ID')], [ex(1, 'O1')]);
    expect(r.reidentify).toEqual([]);
    expect(r.insert.map((t) => t.plaidTransactionId)).toEqual(['NEW_ID']);
  });

  it('does not match across accounts', () => {
    const r = matchReissuedTransactions([inc('N1', { accountId: 'other' })], [ex(1, 'O1')]);
    expect(r.reidentify).toEqual([]);
    expect(r.insert).toHaveLength(1);
  });

  it('does not match a different date or amount', () => {
    expect(matchReissuedTransactions([inc('N', { date: '2026-08-06' })], [ex(1, 'O')]).insert).toHaveLength(1);
    expect(matchReissuedTransactions([inc('N', { amount: 2.56 })], [ex(1, 'O')]).insert).toHaveLength(1);
  });

  it('matches names case- and whitespace-insensitively', () => {
    const r = matchReissuedTransactions([inc('N', { name: '  webox ' })], [ex(1, 'O', { name: 'WEBOX' })]);
    expect(r.reidentify).toHaveLength(1);
  });

  it('treats a null name as its own key rather than matching anything', () => {
    expect(matchReissuedTransactions([inc('N', { name: null })], [ex(1, 'O', { name: 'WEBOX' })]).insert).toHaveLength(1);
    expect(matchReissuedTransactions([inc('N', { name: null })], [ex(1, 'O', { name: null })]).reidentify).toHaveLength(1);
  });

  it('is stable — the same input always pairs the same way', () => {
    const a = matchReissuedTransactions([inc('N1'), inc('N2')], [ex(9, 'O9'), ex(3, 'O3')]);
    const b = matchReissuedTransactions([inc('N1'), inc('N2')], [ex(3, 'O3'), ex(9, 'O9')]);
    expect(a.reidentify).toEqual(b.reidentify);
    expect(a.reidentify[0].existingId).toBe(3); // lowest stored id claimed first
  });

  it('handles empty inputs', () => {
    expect(matchReissuedTransactions([], [])).toEqual({ reidentify: [], insert: [] });
    expect(matchReissuedTransactions([], [ex(1, 'O')])).toEqual({ reidentify: [], insert: [] });
  });
});

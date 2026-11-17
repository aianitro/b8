import { describe, expect, it } from 'vitest';
import {
  cleanReading, daysBetween, inWindow, isOverdue, judgeReceipt, merchantAgreement, merchantWords, proposedCharge,
  verdictForLink, type ChargeCandidate, type WaitingReceipt,
} from './receiptMatch';

// Every figure here is fabricated.
const receipt = (over: Partial<WaitingReceipt> = {}): WaitingReceipt => ({
  id: 1, capturedOn: '2026-03-10', expected: 50, merchant: 'Oak Street Bistro', rejectedIds: [], ...over,
});
const charge = (over: Partial<ChargeCandidate> = {}): ChargeCandidate => ({
  id: 100, date: '2026-03-12', amount: 50, merchantName: null, name: 'TST* OAK STREET BIST', ...over,
});

describe('the window', () => {
  it('runs from the day before the meal to seven days after it', () => {
    expect(inWindow('2026-03-10', '2026-03-09')).toBe(true);
    expect(inWindow('2026-03-10', '2026-03-08')).toBe(false);
    expect(inWindow('2026-03-10', '2026-03-17')).toBe(true);
    expect(inWindow('2026-03-10', '2026-03-18')).toBe(false);
  });

  it('is overdue only after the seventh day', () => {
    expect(isOverdue('2026-03-10', '2026-03-17')).toBe(false);
    expect(isOverdue('2026-03-10', '2026-03-18')).toBe(true);
  });

  it('counts days across a month end', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
  });
});

describe('merchant agreement', () => {
  it('ignores processor tags, business forms and digits', () => {
    expect(merchantWords('TST* 4021 The Oak Street Bistro LLC')).toEqual(['oak', 'street', 'bistro']);
    expect(merchantWords('SQ *BLUE DOOR CAFE')).toEqual(['blue', 'door', 'cafe']);
  });

  it('agrees with truncated bank text', () => {
    expect(merchantAgreement('Oak Street Bistro', charge())).toBeGreaterThan(0);
  });

  it('agrees when the bank runs the words together', () => {
    expect(merchantAgreement('Blue Door', charge({ name: 'BLUEDOOR SF' }))).toBeGreaterThan(0);
  });

  it('does not agree just because both paid through the same processor', () => {
    expect(merchantAgreement('SQ* Blue Door', charge({ name: 'SQ *GREEN LEAF' }))).toBe(0);
  });

  it('says nothing for a receipt with no merchant', () => {
    expect(merchantAgreement(null, charge())).toBe(0);
  });
});

describe('judging a receipt', () => {
  it('links an exact charge, whatever the bank calls it', () => {
    expect(judgeReceipt(receipt(), [charge({ name: 'UNRECOGNISABLE 0042' })]))
      .toEqual({ kind: 'matched', transactionId: 100, charged: 50 });
  });

  it('compares to the cent, so a single cent is a mismatch', () => {
    expect(judgeReceipt(receipt(), [charge({ amount: 50.01 })]))
      .toEqual({ kind: 'mismatch', transactionId: 100, charged: 50.01 });
  });

  it('takes the merchant\'s charge for a different amount as the mismatch', () => {
    expect(judgeReceipt(receipt(), [charge({ amount: 58 }), charge({ id: 101, amount: 51, name: 'GAS STATION' })]))
      .toEqual({ kind: 'mismatch', transactionId: 100, charged: 58 });
  });

  it('claims nothing when no exact charge and no agreeing merchant exist', () => {
    expect(judgeReceipt(receipt(), [charge({ amount: 58, name: 'GAS STATION' })])).toEqual({ kind: 'none' });
  });

  it('prefers the exact charge with the agreeing name, then the nearer day', () => {
    const verdict = judgeReceipt(receipt(), [
      charge({ id: 101, name: 'SOMEWHERE ELSE', date: '2026-03-10' }),
      charge({ id: 102, date: '2026-03-15' }),
      charge({ id: 103, date: '2026-03-11' }),
    ]);
    expect(verdict).toEqual({ kind: 'matched', transactionId: 103, charged: 50 });
  });

  it('skips charges outside the window, refunds, and ones the owner rejected', () => {
    expect(judgeReceipt(receipt({ rejectedIds: [100] }), [
      charge(),
      charge({ id: 101, date: '2026-03-20' }),
      charge({ id: 102, amount: -50 }),
    ])).toEqual({ kind: 'none' });
  });

  it('judges a hand-made link by the same exact-cents rule', () => {
    expect(verdictForLink(50, 50)).toBe('matched');
    expect(verdictForLink(50, 49.99)).toBe('mismatch');
  });
});

describe('what the model read', () => {
  it('proposes the total when one was read', () => {
    expect(proposedCharge({ merchant: null, subtotal: 40, tax: 4, tip: 8, total: 52 })).toBe(52);
  });

  it('adds the parts when no total was read', () => {
    expect(proposedCharge({ merchant: null, subtotal: 40, tax: 3.5, tip: null, total: null })).toBe(43.5);
  });

  it('proposes nothing without a subtotal or a total', () => {
    expect(proposedCharge({ merchant: null, subtotal: null, tax: 3.5, tip: 8, total: null })).toBeNull();
  });

  it('drops anything that is not a sane positive number or a string', () => {
    expect(cleanReading({ merchant: '  Oak   Bistro ', subtotal: '40', tax: -1, tip: Infinity, total: 52.004 }))
      .toEqual({ merchant: 'Oak Bistro', subtotal: null, tax: null, tip: null, total: 52 });
    expect(cleanReading(null)).toEqual({ merchant: null, subtotal: null, tax: null, tip: null, total: null });
  });
});

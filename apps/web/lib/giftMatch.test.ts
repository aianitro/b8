// P7-41b — which row is a gift, and when something is due: `lib/domain/giftMatch.ts`, pure.
//
// Scenarios M1–M12 and L1–L3 of plan/tasks/P7-41b-gifts/SPEC.md, one `it` each, titled by id.
// Every value is fabricated; merchants are invented names. The date scenarios run unchanged under
// any process time zone (acceptance #4 runs this file under three): nothing here reads a clock, and
// every `today` is a string the test hands in.

import { describe, expect, it } from 'vitest';
import {
  addDays,
  assignCandidates,
  isCandidate,
  isRevealed,
  merchantMatches,
  noticeDue,
  outcomeFor,
  sameAmount,
  stateAfterClaim,
  sweepDecision,
  validateGiftRequest,
  type CandidateRow,
  type GiftCriteria,
  type SweepGift,
} from './domain/giftMatch';

const GIFT: GiftCriteria = {
  id: 1,
  createdAt: '2026-10-01T09:00:00.000000',
  state: 'awaiting',
  amount: '48.15',
  merchant: 'quillfeather',
  accountId: null,
  windowStart: '2026-11-01',
  windowEnd: '2026-11-10',
};

const ROW: CandidateRow = {
  id: 100,
  plaidTransactionId: 'plaid-zq41b-1',
  accountId: 'acct-zq41b-card',
  date: '2026-11-05',
  authorizedDate: null,
  amount: '48.15',
  name: 'QUILLFEATHER GOODS 0042',
  merchantName: 'Quillfeather Goods',
  pending: false,
  linked: false,
};

const row = (patch: Partial<CandidateRow>): CandidateRow => ({ ...ROW, ...patch });
const gift = (patch: Partial<GiftCriteria>): GiftCriteria => ({ ...GIFT, ...patch });

describe('matching a stored row to a gift (M)', () => {
  it('T41b-M1: a posted outflow inside the window, with the amount and the merchant, is a candidate', () => {
    expect(isCandidate(GIFT, ROW)).toBe(true);
    expect([...assignCandidates([GIFT], [ROW])]).toEqual([[1, [100]]]);
  });

  it('T41b-M2: a refund of the same magnitude and a zero row are never candidates', () => {
    expect(isCandidate(GIFT, row({ amount: '-48.15' }))).toBe(false);
    expect(isCandidate(gift({ amount: null }), row({ amount: '0.00' }))).toBe(false);
    expect(isCandidate(gift({ amount: null }), row({ amount: '-48.15' }))).toBe(false);
    expect(isCandidate(gift({ amount: null }), row({ amount: '0.01' }))).toBe(true);
  });

  it('T41b-M3: amounts compare by exact decimal equality, including cent values a binary float cannot hold', () => {
    for (const a of ['0.15', '19.35', '2.55', '1.57', '100.07', '48.15', '33.33']) {
      expect({ a, ok: isCandidate(gift({ amount: a }), row({ amount: a })) }).toEqual({ a, ok: true });
      const [whole, frac] = a.split('.');
      const up = `${whole}.${String(Number(frac) + 1).padStart(2, '0')}`;
      const down = `${whole}.${String(Number(frac) - 1).padStart(2, '0')}`;
      expect({ a, up: isCandidate(gift({ amount: a }), row({ amount: up })) }).toEqual({ a, up: false });
      expect({ a, down: isCandidate(gift({ amount: a }), row({ amount: down })) }).toEqual({ a, down: false });
    }
    // Spellings of one value are one value; a third decimal is not a cent value at all.
    expect(sameAmount('12.5', '12.50')).toBe(true);
    expect(sameAmount('12.50', '12.51')).toBe(false);
    expect(sameAmount('12.505', '12.50')).toBe(false);
  });

  it('T41b-M4: the window is inclusive at both ends, across a month end and a leap day', () => {
    expect(isCandidate(GIFT, row({ date: '2026-10-31' }))).toBe(false);
    expect(isCandidate(GIFT, row({ date: '2026-11-01' }))).toBe(true);
    expect(isCandidate(GIFT, row({ date: '2026-11-10' }))).toBe(true);
    expect(isCandidate(GIFT, row({ date: '2026-11-11' }))).toBe(false);
    const leap = gift({ windowStart: '2028-02-28', windowEnd: '2028-02-29' });
    expect(isCandidate(leap, row({ date: '2028-02-29' }))).toBe(true);
    expect(isCandidate(leap, row({ date: '2028-03-01' }))).toBe(false);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('T41b-M5: the merchant is a trimmed, case-insensitive substring of the merchant, or of the name when there is no merchant', () => {
    expect(merchantMatches('  QUILLfeather ', 'Quillfeather Goods', null)).toBe(true);
    expect(merchantMatches('quillfeather', null, 'POS QUILLFEATHER GOODS')).toBe(true);
    expect(merchantMatches('quillfeather', 'Brambleworth Supply', null)).toBe(false);
    expect(merchantMatches('   ', 'Quillfeather Goods', null)).toBe(false);
    expect(isCandidate(gift({ merchant: 'brambleworth' }), ROW)).toBe(false);
  });

  it('T41b-M6: criterion characters are literal — %, _, .* and ( match only themselves and never throw', () => {
    expect(merchantMatches('a_b', 'axb', null)).toBe(false);
    expect(merchantMatches('100%', '1000', null)).toBe(false);
    expect(merchantMatches('.*.', 'Quillfeather Goods', null)).toBe(false);
    expect(() => merchantMatches('(((', 'Quillfeather Goods', null)).not.toThrow();
    expect(merchantMatches('(((', 'Quillfeather Goods', null)).toBe(false);
    expect(merchantMatches('a_b', 'shop a_b here', null)).toBe(true);
    expect(merchantMatches('100%', 'Deal 100% off', null)).toBe(true);
  });

  it('T41b-M7: criteria are ANDed — amount alone, merchant alone, or both', () => {
    expect(isCandidate(GIFT, row({ merchantName: 'Brambleworth Supply', name: 'BRAMBLEWORTH' }))).toBe(false);
    expect(isCandidate(GIFT, row({ amount: '48.16' }))).toBe(false);
    expect(isCandidate(GIFT, ROW)).toBe(true);
    expect(isCandidate(gift({ merchant: null }), row({ merchantName: 'Brambleworth Supply' }))).toBe(true);
    expect(isCandidate(gift({ amount: null }), row({ amount: '9.99' }))).toBe(true);
  });

  it('T41b-M8: an account criterion excludes another account; a null criterion allows any', () => {
    expect(isCandidate(gift({ accountId: 'acct-zq41b-card' }), ROW)).toBe(true);
    expect(isCandidate(gift({ accountId: 'acct-zq41b-other' }), ROW)).toBe(false);
    expect(isCandidate(gift({ accountId: null }), row({ accountId: 'acct-anything' }))).toBe(true);
  });

  it('T41b-M9: zero candidates is none, one is a match, several wait for the giver in ascending order; a linked row is not a candidate', () => {
    expect(outcomeFor([])).toEqual({ kind: 'none' });
    expect(outcomeFor([7])).toEqual({ kind: 'match', transactionId: 7 });
    expect(outcomeFor([9, 3])).toEqual({ kind: 'choose', transactionIds: [3, 9] });
    const claims = assignCandidates([GIFT], [row({ id: 12 }), row({ id: 11 }), row({ id: 10, linked: true })]);
    expect(claims.get(1)).toEqual([11, 12]);
    expect(stateAfterClaim('awaiting', 0, 2)).toBe('choose');
    expect(stateAfterClaim('awaiting', 0, 1)).toBe('matched');
    expect(stateAfterClaim('choose', 2, 1)).toBe('choose');
    expect(stateAfterClaim('awaiting', 0, 0)).toBe('awaiting');
  });

  it('T41b-M10: two gifts on one row — the earlier-created gift wins whatever order they are passed in', () => {
    const older = gift({ id: 5, createdAt: '2026-10-01T09:00:00.000000' });
    const newer = gift({ id: 2, createdAt: '2026-10-02T09:00:00.000000' });
    for (const order of [[older, newer], [newer, older]]) {
      const claims = assignCandidates(order, [ROW]);
      expect([...claims]).toEqual([[5, [100]]]);
    }
    // Same instant: the lower id.
    const twinA = gift({ id: 8 });
    const twinB = gift({ id: 4 });
    expect([...assignCandidates([twinA, twinB], [ROW])]).toEqual([[4, [100]]]);
    // A matched gift is final and claims nothing.
    expect(assignCandidates([gift({ state: 'matched' })], [ROW]).size).toBe(0);
  });

  it('T41b-M11: pending rows and rows whose id starts manual_ or csv_ are never candidates', () => {
    expect(isCandidate(GIFT, row({ pending: true }))).toBe(false);
    expect(isCandidate(GIFT, row({ plaidTransactionId: 'manual_zq41b' }))).toBe(false);
    expect(isCandidate(GIFT, row({ plaidTransactionId: 'csv_zq41b' }))).toBe(false);
  });

  it('T41b-M12: creation validation — fourteen rejections and four acceptances, null never becoming 0 or empty', () => {
    const base = { amount: '25.00', merchant: 'quillfeather', windowStart: '2026-11-01', windowEnd: '2026-11-10', revealDate: '2026-12-01' };
    const rejected: [string, unknown][] = [
      ['neither amount nor merchant', { ...base, amount: null, merchant: null }],
      ['merchant of two characters', { ...base, merchant: 'ab' }],
      ['whitespace-only merchant', { ...base, merchant: '    ' }],
      ['amount 0', { ...base, amount: '0' }],
      ['amount 0.00', { ...base, amount: '0.00' }],
      ['negative amount', { ...base, amount: '-25.00' }],
      ['three decimals', { ...base, amount: '25.001' }],
      ['exponent', { ...base, amount: '1e3' }],
      ['empty amount', { ...base, amount: '' }],
      ['non-numeric amount', { ...base, amount: 'twenty' }],
      ['leading space', { ...base, amount: ' 25.00' }],
      ['window end before start', { ...base, windowEnd: '2026-10-31' }],
      ['reveal before window start', { ...base, revealDate: '2026-10-31' }],
      ['giver equals recipient', { ...base, recipientUserId: 7 }],
      ['a number, not a string', { ...base, amount: 25 }],
    ];
    expect(rejected.length).toBeGreaterThanOrEqual(14);
    for (const [why, body] of rejected) {
      const r = validateGiftRequest(body, 7);
      expect({ why, ok: r.ok }).toEqual({ why, ok: false });
      // The refusal never repeats the submitted criterion.
      if (!r.ok) expect(r.message.toLowerCase()).not.toContain('quillfeather');
    }
    const oneDay = validateGiftRequest({ ...base, windowEnd: '2026-11-01', revealDate: '2026-11-01' }, 7);
    expect(oneDay.ok).toBe(true);
    const amountOnly = validateGiftRequest({ ...base, merchant: null }, 7);
    expect(amountOnly).toEqual({ ok: true, value: expect.objectContaining({ amount: '25.00', merchant: null }) });
    const merchantOnly = validateGiftRequest({ ...base, amount: undefined, merchant: '  quillfeather  ' }, 7);
    expect(merchantOnly).toEqual({ ok: true, value: expect.objectContaining({ amount: null, merchant: 'quillfeather' }) });
    const named = validateGiftRequest({ ...base, recipientUserId: 8 }, 7);
    expect(named).toEqual({ ok: true, value: expect.objectContaining({ recipientUserId: 8 }) });
    // A null amount is "any", distinct from a zero amount (which is refused above).
    if (amountOnly.ok && merchantOnly.ok) {
      expect(merchantOnly.value.amount).toBeNull();
      expect(merchantOnly.value.amount).not.toBe('0.00');
    }
  });

  it('T41b-M13: the window takes the purchase (authorized) date or the posted date, so a card posting the day after still matches', () => {
    const oneDay = gift({ windowStart: '2026-10-19', windowEnd: '2026-10-19' });
    // Bought on the window's day, posted the next: the case that left a row unmasked.
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-19', date: '2026-10-20' }))).toBe(true);
    // Either date alone is enough, at both inclusive ends.
    expect(isCandidate(oneDay, row({ authorizedDate: null, date: '2026-10-19' }))).toBe(true);
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-18', date: '2026-10-19' }))).toBe(true);
    // Neither inside: not a candidate, whether the authorized date is missing, before or after.
    expect(isCandidate(oneDay, row({ authorizedDate: null, date: '2026-10-20' }))).toBe(false);
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-18', date: '2026-10-20' }))).toBe(false);
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-20', date: '2026-10-21' }))).toBe(false);
    // The authorized date widens only the window; every other criterion still applies.
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-19', date: '2026-10-20', amount: '48.16' }))).toBe(false);
    expect(isCandidate(oneDay, row({ authorizedDate: '2026-10-19', date: '2026-10-20', pending: true }))).toBe(false);
  });
});

describe('what the daily sweep does and when a gift is revealed (L)', () => {
  const sweep = (patch: Partial<SweepGift>): SweepGift => ({
    state: 'awaiting', windowEnd: '2026-11-10', revealDate: '2026-12-25', noticeAt: null, ...patch,
  });

  it('T41b-L1: the window-end notice is due from window end plus six days, once, for awaiting and choose gifts only', () => {
    expect(noticeDue(sweep({}), '2026-11-10')).toBe(false);
    expect(noticeDue(sweep({}), '2026-11-15')).toBe(false);
    expect(noticeDue(sweep({}), '2026-11-16')).toBe(true);
    expect(noticeDue(sweep({ state: 'choose' }), '2026-11-16')).toBe(true);
    expect(noticeDue(sweep({ state: 'matched' }), '2026-11-16')).toBe(false);
    expect(noticeDue(sweep({ state: 'cancelled' }), '2026-11-16')).toBe(false);
    expect(noticeDue(sweep({ noticeAt: '2026-11-16 06:00:00+00' }), '2026-11-17')).toBe(false);
    // Across a month end: window end on the 28th, due on the 6th of the next month.
    expect(noticeDue(sweep({ windowEnd: '2026-02-28' }), '2026-03-05')).toBe(false);
    expect(noticeDue(sweep({ windowEnd: '2026-02-28' }), '2026-03-06')).toBe(true);
    expect(sweepDecision(sweep({}), '2026-11-16')).toBe('notice');
    expect(sweepDecision(sweep({}), '2026-11-15')).toBe('none');
  });

  it('T41b-L2: a gift is revealed on its reveal date and after, not the day before, across a year end', () => {
    expect(isRevealed('2026-12-25', '2026-12-24')).toBe(false);
    expect(isRevealed('2026-12-25', '2026-12-25')).toBe(true);
    expect(isRevealed('2026-12-25', '2026-12-26')).toBe(true);
    expect(isRevealed('2027-01-01', '2026-12-31')).toBe(false);
    expect(isRevealed('2027-01-01', '2027-01-01')).toBe(true);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('T41b-L3: a gift still awaiting or choosing on or after its reveal date expires: candidates restored, giver told once', () => {
    expect(sweepDecision(sweep({ revealDate: '2026-11-08' }), '2026-11-08')).toBe('expire');
    expect(sweepDecision(sweep({ state: 'choose', revealDate: '2026-11-08' }), '2026-11-09')).toBe('expire');
    expect(sweepDecision(sweep({ state: 'choose', revealDate: '2026-11-08', noticeAt: 'x' }), '2026-11-09')).toBe('expire');
    expect(sweepDecision(sweep({ revealDate: '2026-11-08' }), '2026-11-07')).toBe('none');
    expect(sweepDecision(sweep({ state: 'matched', revealDate: '2026-11-08' }), '2026-11-09')).toBe('none');
  });
});

import { describe, it, expect } from 'vitest';
import { detectDrift, normalizePlaidBalance, type DriftInput } from './drift';

const row = (over: Partial<DriftInput> = {}): DriftInput => ({
  accountId: 'a', name: 'Checking', type: 'depository',
  ledgerBalance: 1000, plaidBalance: 1000, observedAt: '2026-08-07T00:00:00Z',
  ...over,
});

describe('normalizePlaidBalance', () => {
  it('leaves a depository balance alone', () => {
    expect(normalizePlaidBalance('depository', 2500)).toBe(2500);
  });

  it('negates credit and loan balances, which Plaid reports as amount owed', () => {
    // Without this every credit card would report ~2x its balance as drift.
    expect(normalizePlaidBalance('credit', 1500)).toBe(-1500);
    expect(normalizePlaidBalance('loan', 232465)).toBe(-232465);
  });

  it('is case-insensitive on the type', () => {
    expect(normalizePlaidBalance('Credit', 100)).toBe(-100);
  });

  it('treats investment as an asset, not a debt', () => {
    expect(normalizePlaidBalance('investment', 400000)).toBe(400000);
  });
});

describe('detectDrift', () => {
  it('reports nothing when the ledger matches Plaid', () => {
    expect(detectDrift([row()])).toEqual([]);
  });

  it('flags a ledger that is short of what Plaid reports', () => {
    const [f] = detectDrift([row({ ledgerBalance: 900, plaidBalance: 1000 })]);
    expect(f.drift).toBe(100);
    expect(f.expectedBalance).toBe(1000);
    expect(f.ledgerBalance).toBe(900);
  });

  it('flags a ledger that overshoots, with a negative drift', () => {
    const [f] = detectDrift([row({ ledgerBalance: 1100, plaidBalance: 1000 })]);
    expect(f.drift).toBe(-100);
  });

  it('compares credit cards in the ledger sign convention, not raw', () => {
    // Plaid says 1500 owed; the ledger correctly holds -1500. That is agreement, not drift.
    expect(detectDrift([row({ type: 'credit', ledgerBalance: -1500, plaidBalance: 1500 })])).toEqual([]);
  });

  it('still catches real drift on a credit card', () => {
    const [f] = detectDrift([row({ type: 'credit', ledgerBalance: -1400, plaidBalance: 1500 })]);
    expect(f.drift).toBe(-100); // expected -1500 vs ledger -1400
  });

  it('skips accounts Plaid has never reported a balance for', () => {
    // A manual account has no Plaid figure to disagree with; flagging it daily would train
    // the alert to be ignored.
    expect(detectDrift([row({ plaidBalance: null, ledgerBalance: 5000 })])).toEqual([]);
  });

  it('ignores sub-threshold rounding noise but catches the dollar above it', () => {
    expect(detectDrift([row({ ledgerBalance: 1000.5 })])).toEqual([]);
    expect(detectDrift([row({ ledgerBalance: 998.5 })])).toHaveLength(1);
  });

  it('honours a custom threshold', () => {
    expect(detectDrift([row({ ledgerBalance: 900 })], 500)).toEqual([]);
    expect(detectDrift([row({ ledgerBalance: 300 })], 500)).toHaveLength(1);
  });

  it('orders worst drift first regardless of input order', () => {
    const found = detectDrift([
      row({ accountId: 'small', name: 'Small', ledgerBalance: 990 }),
      row({ accountId: 'big', name: 'Big', ledgerBalance: 100 }),
      row({ accountId: 'mid', name: 'Mid', ledgerBalance: 800 }),
    ]);
    expect(found.map((f) => f.accountId)).toEqual(['big', 'mid', 'small']);
  });

  it('does not report float dust as drift', () => {
    // 0.1 + 0.2 style accumulation in the ledger sum must not surface as a finding.
    expect(detectDrift([row({ ledgerBalance: 1000.000000001 })])).toEqual([]);
  });
});

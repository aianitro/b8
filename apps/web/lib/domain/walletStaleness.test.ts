import { describe, expect, it } from 'vitest';
import { staleWallets, STALE_AFTER_DAYS, type WalletCountState } from './walletStaleness';

const NOW = new Date('2026-09-29T12:00:00Z');
const w = (over: Partial<WalletCountState> = {}): WalletCountState => ({
  accountId: 'w1', name: 'Cash Andrei', balance: 173, lastCountedAt: '2026-09-29T11:00:00Z', ...over,
});

describe('which wallets have stopped being trustworthy', () => {
  it('says nothing about a wallet counted recently', () => {
    expect(staleWallets([w({ lastCountedAt: '2026-09-20T12:00:00Z' })], NOW)).toEqual([]);
  });

  it('reports one counted longer ago than the threshold', () => {
    const [f] = staleWallets([w({ lastCountedAt: '2026-08-01T12:00:00Z' })], NOW);
    expect(f.reason).toBe('stale');
    expect(f.daysSinceCount).toBe(59);
  });

  it('treats the threshold as a closed bound', () => {
    const at = new Date(NOW.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
    const justUnder = new Date(NOW.getTime() - (STALE_AFTER_DAYS - 1) * 86_400_000).toISOString();
    expect(staleWallets([w({ lastCountedAt: at })], NOW)).toHaveLength(1);
    expect(staleWallets([w({ lastCountedAt: justUnder })], NOW)).toHaveLength(0);
  });

  it('reports a never-counted wallet that is asserting money', () => {
    const [f] = staleWallets([w({ lastCountedAt: null, balance: 269 })], NOW);
    expect(f.reason).toBe('never');
    expect(f.daysSinceCount).toBeNull();
  });

  it('says NOTHING about a never-counted wallet holding nothing', () => {
    // Reporting it would be reporting the absence of a problem: there is no figure on screen that
    // could be wrong, and nothing for the owner to do.
    expect(staleWallets([w({ lastCountedAt: null, balance: 0 })], NOW)).toEqual([]);
  });

  it('does not report float dust as money', () => {
    expect(staleWallets([w({ lastCountedAt: null, balance: 0.0001 })], NOW)).toEqual([]);
    expect(staleWallets([w({ lastCountedAt: null, balance: 0.01 })], NOW)).toHaveLength(1);
  });

  it('puts never-counted ahead of stale, then longest-uncounted first', () => {
    // The caller renders the head and a count of the rest, so the order is what decides which
    // wallet gets named.
    const found = staleWallets([
      w({ accountId: 'a', name: 'A', lastCountedAt: '2026-08-20T12:00:00Z' }),  // 40 days
      w({ accountId: 'b', name: 'B', lastCountedAt: null, balance: 5 }),        // never
      w({ accountId: 'c', name: 'C', lastCountedAt: '2026-07-01T12:00:00Z' }),  // 90 days
    ], NOW);
    expect(found.map((f) => f.accountId)).toEqual(['b', 'c', 'a']);
  });

  it('ignores an unparseable timestamp rather than reporting NaN days', () => {
    expect(staleWallets([w({ lastCountedAt: 'not a date' })], NOW)).toEqual([]);
  });

  it('does not go negative when a count is dated in the future', () => {
    expect(staleWallets([w({ lastCountedAt: '2026-12-01T12:00:00Z' })], NOW)).toEqual([]);
  });

  it('returns nothing for no wallets at all', () => {
    expect(staleWallets([], NOW)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { summarizeLandscape, type SummaryAccount, type SummaryInputs } from './accountsSummary';

// Fabricated figures throughout, as everywhere in this repo's tests.

const acct = (id: string, over: Partial<SummaryAccount> = {}): SummaryAccount => ({
  id, landscape: 'operational', valuationMode: 'ledger', isLiability: false, ...over,
});
const empty: SummaryInputs = { ledgerBalances: {}, beginningBalances: {}, latestValuations: {}, openingValuations: {}, firstValuations: {} };

describe('summarizeLandscape', () => {
  it('sums ledger accounts from their beginning balance to their ledger balance', () => {
    const s = summarizeLandscape([acct('a'), acct('b')], 'operational', {
      ...empty,
      ledgerBalances: { a: 120, b: -30 },
      beginningBalances: { a: 100, b: -10 },
    });
    expect(s).toEqual({ yearBegin: 90, current: 90, change: 0, counted: 2, noOpening: 0 });
  });

  it('treats a missing beginning balance as zero, as the ledger balance does', () => {
    const s = summarizeLandscape([acct('a')], 'operational', { ...empty, ledgerBalances: { a: 40 } });
    expect(s).toMatchObject({ yearBegin: 0, current: 40, change: 40 });
  });

  it('leaves out an untracked ledger account, which has no balance', () => {
    const s = summarizeLandscape([acct('a'), acct('u')], 'operational', {
      ...empty, ledgerBalances: { a: 5 }, beginningBalances: { u: 999 },
    });
    expect(s).toMatchObject({ yearBegin: 0, current: 5, counted: 1 });
  });

  it('values a valued account from its Jan 1 valuation to its latest, a liability negatively', () => {
    const accounts = [
      acct('inv', { landscape: 'capital', valuationMode: 'valuation' }),
      acct('loan', { landscape: 'capital', valuationMode: 'valuation', isLiability: true }),
    ];
    const s = summarizeLandscape(accounts, 'capital', {
      ...empty,
      // A valued account also appears in the net-worth ledger map; the valuation must win.
      ledgerBalances: { inv: 1, loan: 1 },
      latestValuations: { inv: 300, loan: 80 },
      openingValuations: { inv: 250, loan: 90 },
    });
    expect(s).toEqual({ yearBegin: 160, current: 220, change: 60, counted: 2, noOpening: 0 });
  });

  it('opens an account first valued after Jan 1 at that first valuation, and says so', () => {
    const s = summarizeLandscape([acct('v', { valuationMode: 'valuation', isLiability: true })], 'operational', {
      ...empty, latestValuations: { v: 50 }, firstValuations: { v: 60 },
    });
    expect(s).toEqual({ yearBegin: -60, current: -50, change: 10, counted: 1, noOpening: 1 });
  });

  it('prefers a true Jan 1 valuation over a later first one', () => {
    const s = summarizeLandscape([acct('v', { valuationMode: 'valuation' })], 'operational', {
      ...empty, latestValuations: { v: 50 }, openingValuations: { v: 40 }, firstValuations: { v: 45 },
    });
    expect(s).toMatchObject({ yearBegin: 40, change: 10, noOpening: 0 });
  });

  it('leaves out a valued account that was never valued', () => {
    const s = summarizeLandscape([acct('v', { valuationMode: 'valuation' })], 'operational', {
      ...empty, openingValuations: { v: 50 },
    });
    expect(s).toEqual({ yearBegin: 0, current: 0, change: 0, counted: 0, noOpening: 0 });
  });

  it('counts only the asked-for landscape', () => {
    const s = summarizeLandscape([acct('o'), acct('c', { landscape: 'capital' })], 'capital', {
      ...empty, ledgerBalances: { o: 10, c: 20 },
    });
    expect(s).toMatchObject({ current: 20, counted: 1 });
  });

  it('rounds to cents, so float drift never shows as a change', () => {
    const s = summarizeLandscape([acct('a'), acct('b')], 'operational', {
      ...empty,
      ledgerBalances: { a: 0.1, b: 0.2 },
      beginningBalances: { a: 0.1, b: 0.2 },
    });
    expect(s).toMatchObject({ current: 0.3, change: 0 });
  });
});

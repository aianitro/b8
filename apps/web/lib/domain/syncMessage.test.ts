import { describe, expect, it } from 'vitest';
import { partialFailureNote, syncHeadline, unmatchedAccountsNote } from './syncMessage';

describe('syncHeadline', () => {
  it('names the zero case as a result rather than saying nothing', () => {
    expect(syncHeadline(0)).toBe('No new transactions');
  });

  it('switches to the plural at two, not at one', () => {
    expect(syncHeadline(1)).toBe('1 new transaction');
    expect(syncHeadline(2)).toBe('2 new transactions');
  });

  it('groups a large count so it can be read at a glance', () => {
    expect(syncHeadline(1234)).toBe('1,234 new transactions');
  });

  // `synced` is a count and cannot go negative, but the toast must not print "-1 new transactions"
  // if it ever does: a nonsense figure beside a link is worse than the honest zero phrasing.
  it('treats a negative count as nothing rather than printing it', () => {
    expect(syncHeadline(-1)).toBe('No new transactions');
  });
});

describe('unmatchedAccountsNote', () => {
  it('says nothing when every account matched', () => {
    expect(unmatchedAccountsNote(0)).toBeNull();
    expect(unmatchedAccountsNote(-3)).toBeNull();
  });

  it('agrees its verb and its possessive with the count', () => {
    expect(unmatchedAccountsNote(1)).toContain('1 account at Plaid has no match');
    expect(unmatchedAccountsNote(1)).toContain('its transactions');
    expect(unmatchedAccountsNote(2)).toContain('2 accounts at Plaid have no match');
    expect(unmatchedAccountsNote(2)).toContain('their transactions');
  });
});

describe('partialFailureNote', () => {
  it('says nothing when every feed answered', () => {
    expect(partialFailureNote(0)).toBeNull();
    expect(partialFailureNote(-1)).toBeNull();
  });

  it('agrees its noun with the count', () => {
    expect(partialFailureNote(1)).toBe('1 feed could not be reached, so this count may be short.');
    expect(partialFailureNote(3)).toBe('3 feeds could not be reached, so this count may be short.');
  });

  // The point of the sentence is the SHORTFALL, not the failure — a reader who takes the headline
  // as complete is the outcome this exists to prevent.
  it('tells the reader the count is incomplete', () => {
    expect(partialFailureNote(2)).toContain('may be short');
  });
});

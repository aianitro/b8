import { describe, it, expect } from 'vitest';
import { matchAccounts, type DbAccountRow, type LiveAccount } from './plaidMatch';

const dbAccount = (o: Partial<DbAccountRow> & { id: string }): DbAccountRow => ({
  name: 'Account',
  mask: null,
  subtype: null,
  persistent_account_id: null,
  ...o,
});

const liveAccount = (o: Partial<LiveAccount> & { account_id: string }): LiveAccount => ({
  name: 'Account',
  mask: null,
  subtype: null,
  persistent_account_id: null,
  ...o,
});

describe('matchAccounts', () => {
  it('leaves untouched accounts whose ids still match', () => {
    const result = matchAccounts(
      [liveAccount({ account_id: 'a1', name: 'Checking', mask: '1234' })],
      [dbAccount({ id: 'a1', name: 'Checking', mask: '1234' })]
    );

    expect(result.remapped).toEqual([]);
    expect(result.backfills).toEqual([]);
    expect(result.unmatchedLive).toEqual([]);
    expect(result.unmatchedDb).toEqual([]);
  });

  it('backfills drifted identifiers on an account that still matches by id', () => {
    const result = matchAccounts(
      [liveAccount({ account_id: 'a1', mask: '1234', persistent_account_id: 'p1' })],
      [dbAccount({ id: 'a1', mask: null, persistent_account_id: null })]
    );

    expect(result.remapped).toEqual([]);
    expect(result.backfills).toEqual([{ id: 'a1', mask: '1234', persistentAccountId: 'p1' }]);
  });

  describe('matching strategies, in precedence order', () => {
    it('pass 1: matches on persistent_account_id', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Renamed', mask: '9999', persistent_account_id: 'p1' })],
        [dbAccount({ id: 'old', name: 'Original', mask: '1234', persistent_account_id: 'p1' })]
      );

      expect(result.remapped).toEqual([
        {
          oldId: 'old',
          newId: 'new',
          name: 'Original',
          matchedBy: 'persistent_account_id',
          mask: '9999',
          persistentAccountId: 'p1',
        },
      ]);
    });

    it('pass 2: matches on mask + subtype when the name changed', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Renamed', mask: '1234', subtype: 'checking' })],
        [dbAccount({ id: 'old', name: 'Original', mask: '1234', subtype: 'checking' })]
      );

      expect(result.remapped).toHaveLength(1);
      expect(result.remapped[0]).toMatchObject({ oldId: 'old', newId: 'new', matchedBy: 'mask' });
    });

    it('pass 2: does NOT match on the same mask across different subtypes', () => {
      // Two accounts at one bank can share a mask; the subtype is what disambiguates them.
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Renamed', mask: '1234', subtype: 'savings' })],
        [dbAccount({ id: 'old', name: 'Original', mask: '1234', subtype: 'checking' })]
      );

      expect(result.remapped.some((r) => r.matchedBy === 'mask')).toBe(false);
    });

    it('pass 3: matches on an exact name when no mask is available', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Joint Checking' })],
        [dbAccount({ id: 'old', name: 'Joint Checking' })]
      );

      expect(result.remapped[0]).toMatchObject({ matchedBy: 'name', oldId: 'old', newId: 'new' });
    });

    it('pass 4: matches a fuzzy name where one contains the other', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Trust Myrtle Beach (1503)' })],
        [dbAccount({ id: 'old', name: 'Trust Myrtle Beach' })]
      );

      expect(result.remapped[0]).toMatchObject({ matchedBy: 'fuzzy-name' });
    });

    it('pass 4: is case-insensitive', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'PLAID SAVINGS ACCOUNT' })],
        [dbAccount({ id: 'old', name: 'Plaid Savings' })]
      );

      expect(result.remapped[0]).toMatchObject({ matchedBy: 'fuzzy-name' });
    });

    it('pass 4: refuses a fuzzy name match across a known subtype mismatch', () => {
      // Extra unmatched rows on both sides keep pass 5 (elimination) out of the picture,
      // isolating pass 4's own guard — see the elimination-precedence test below.
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'new', name: 'Chase Savings', subtype: 'savings' }),
          liveAccount({ account_id: 'spare', name: 'Unrelated Live', mask: '7777' }),
        ],
        [
          dbAccount({ id: 'old', name: 'Chase', subtype: 'checking' }),
          dbAccount({ id: 'spareDb', name: 'Unrelated Db', mask: '8888' }),
        ]
      );

      expect(result.remapped).toEqual([]);
      expect(result.unmatchedLive).toHaveLength(2);
      expect(result.unmatchedDb).toHaveLength(2);
    });

    it('pass 5: matches by elimination when exactly one remains on each side', () => {
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'a1', name: 'Checking' }),
          liveAccount({ account_id: 'new', name: 'Completely Different', mask: '5555' }),
        ],
        [
          dbAccount({ id: 'a1', name: 'Checking' }),
          dbAccount({ id: 'old', name: 'Nothing Alike', mask: '1111' }),
        ]
      );

      expect(result.remapped).toHaveLength(1);
      expect(result.remapped[0]).toMatchObject({ oldId: 'old', newId: 'new', matchedBy: 'elimination' });
      expect(result.unmatchedLive).toEqual([]);
    });

    it('pass 5: overrides the earlier passes’ guards once only one pair is left', () => {
      // Documenting a real consequence of the design rather than asserting an ideal: the
      // subtype guard in pass 4 (and the mask/subtype guard in pass 2) only protect while
      // 2+ rows remain on a side. Down to one-on-one, elimination merges them regardless —
      // that is what "they must be the same account" means, but it does mean a genuinely
      // new account replacing a genuinely closed one in the same sync would be merged.
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Chase Savings', subtype: 'savings' })],
        [dbAccount({ id: 'old', name: 'Chase', subtype: 'checking' })]
      );

      expect(result.remapped).toHaveLength(1);
      expect(result.remapped[0]).toMatchObject({ matchedBy: 'elimination' });
    });

    it('pass 5: refuses to guess when 2+ remain unmatched on each side', () => {
      // The safety property that matters most: merging the wrong two accounts would
      // silently reassign real transaction history.
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'new1', name: 'Alpha', mask: '5555' }),
          liveAccount({ account_id: 'new2', name: 'Beta', mask: '6666' }),
        ],
        [
          dbAccount({ id: 'old1', name: 'Gamma', mask: '1111' }),
          dbAccount({ id: 'old2', name: 'Delta', mask: '2222' }),
        ]
      );

      expect(result.remapped).toEqual([]);
      expect(result.unmatchedLive).toHaveLength(2);
      expect(result.unmatchedDb).toHaveLength(2);
    });
  });

  describe('precedence and claim safety', () => {
    it('prefers persistent_account_id over a competing mask match', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'X', mask: '1234', persistent_account_id: 'p1' })],
        [
          dbAccount({ id: 'byMask', name: 'By Mask', mask: '1234' }),
          dbAccount({ id: 'byPersistent', name: 'By Persistent', persistent_account_id: 'p1' }),
        ]
      );

      expect(result.remapped).toHaveLength(1);
      expect(result.remapped[0]).toMatchObject({ oldId: 'byPersistent', matchedBy: 'persistent_account_id' });
      expect(result.unmatchedDb.map((d) => d.id)).toEqual(['byMask']);
    });

    it('never claims one db row for two live accounts', () => {
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'new1', name: 'Savings', persistent_account_id: 'p1' }),
          liveAccount({ account_id: 'new2', name: 'Savings' }),
        ],
        [dbAccount({ id: 'old', name: 'Savings', persistent_account_id: 'p1' })]
      );

      expect(result.remapped).toHaveLength(1);
      expect(result.remapped[0]).toMatchObject({ newId: 'new1' });
      expect(result.unmatchedLive.map((a) => a.id)).toEqual(['new2']);
    });

    it('does not treat a null persistent_account_id on both sides as a match', () => {
      // Guards the classic null-equality bug: every unmatched row has a null here.
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Alpha', mask: '5555' })],
        [dbAccount({ id: 'old', name: 'Beta', mask: '1111' })]
      );

      expect(result.remapped[0]?.matchedBy).not.toBe('persistent_account_id');
    });

    it('does not treat a null mask on both sides as a match', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'new', name: 'Alpha', mask: null, subtype: 'checking' })],
        [
          dbAccount({ id: 'old1', name: 'Beta', mask: null, subtype: 'checking' }),
          dbAccount({ id: 'old2', name: 'Gamma', mask: null, subtype: 'checking' }),
        ]
      );

      expect(result.remapped.some((r) => r.matchedBy === 'mask')).toBe(false);
    });
  });

  describe('real-world shapes', () => {
    it('handles a new account appearing at the institution', () => {
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'a1', name: 'Checking' }),
          liveAccount({ account_id: 'brandNew', name: 'New Credit Card', mask: '4321' }),
        ],
        [dbAccount({ id: 'a1', name: 'Checking' })]
      );

      expect(result.remapped).toEqual([]);
      expect(result.unmatchedLive.map((a) => a.id)).toEqual(['brandNew']);
      expect(result.unmatchedDb).toEqual([]);
    });

    it('handles a closed account disappearing from the institution', () => {
      const result = matchAccounts(
        [liveAccount({ account_id: 'a1', name: 'Checking' })],
        [dbAccount({ id: 'a1', name: 'Checking' }), dbAccount({ id: 'closed', name: 'Old Savings' })]
      );

      expect(result.remapped).toEqual([]);
      expect(result.unmatchedDb.map((d) => d.id)).toEqual(['closed']);
    });

    it('reissues ids for a whole item at once, matching each on its own strongest signal', () => {
      // The Chase-style case this module exists for: every account_id rotates in one event.
      const result = matchAccounts(
        [
          liveAccount({ account_id: 'n1', name: 'Chase Checking', mask: '1111', persistent_account_id: 'p1' }),
          liveAccount({ account_id: 'n2', name: 'Chase Savings Renamed', mask: '2222', subtype: 'savings' }),
          liveAccount({ account_id: 'n3', name: 'Chase Sapphire' }),
        ],
        [
          dbAccount({ id: 'o1', name: 'Chase Checking', mask: '1111', persistent_account_id: 'p1' }),
          dbAccount({ id: 'o2', name: 'Chase Savings', mask: '2222', subtype: 'savings' }),
          dbAccount({ id: 'o3', name: 'Chase Sapphire' }),
        ]
      );

      expect(result.remapped).toHaveLength(3);
      expect(result.unmatchedLive).toEqual([]);
      expect(result.unmatchedDb).toEqual([]);
      expect(Object.fromEntries(result.remapped.map((r) => [r.oldId, r.matchedBy]))).toEqual({
        o1: 'persistent_account_id',
        o2: 'mask',
        o3: 'name',
      });
    });

    it('returns empty results for an item with no accounts on either side', () => {
      const result = matchAccounts([], []);
      expect(result).toEqual({ remapped: [], backfills: [], unmatchedLive: [], unmatchedDb: [] });
    });
  });
});

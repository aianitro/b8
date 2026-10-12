import { describe, expect, it } from 'vitest';
import { stepEpisodes, watchedBalance } from './overdraft';

const on = (cushion = 0) => ({ watch: true, cushion });

describe('watchedBalance', () => {
  it('takes the lower of available and current, and copes with either missing', () => {
    expect(watchedBalance({ accountId: 'a', current: 20, available: -5 })).toBe(-5);
    expect(watchedBalance({ accountId: 'a', current: -5, available: 95 })).toBe(-5);
    expect(watchedBalance({ accountId: 'a', current: 10, available: null })).toBe(10);
    expect(watchedBalance({ accountId: 'a', current: null, available: null })).toBeNull();
  });
});

describe('stepEpisodes', () => {
  it('opens, updates and closes against the cushion', () => {
    const settings = new Map([['a', on()], ['b', on()], ['c', on(100)], ['d', on()]]);
    const steps = stepEpisodes([
      { accountId: 'a', current: 10, available: -1 },   // below zero, none open → open
      { accountId: 'b', current: -20, available: -20 }, // still below, open → update
      { accountId: 'c', current: 150, available: 150 }, // above its cushion, open → close
      { accountId: 'd', current: 0, available: 0 },     // exactly zero is not below → nothing
    ], settings, new Set(['b', 'c']));
    expect(steps).toEqual([
      { kind: 'open', accountId: 'a', balance: -1 },
      { kind: 'update', accountId: 'b', balance: -20 },
      { kind: 'close', accountId: 'c', balance: 150 },
    ]);
  });

  it('warns under a cushion above zero', () => {
    const steps = stepEpisodes([{ accountId: 'a', current: 99.99, available: null }], new Map([['a', on(100)]]), new Set());
    expect(steps).toEqual([{ kind: 'open', accountId: 'a', balance: 99.99 }]);
  });

  it('leaves an episode open, and opens none, while watching is switched off', () => {
    const off = new Map([['a', { watch: false, cushion: 0 }], ['b', { watch: false, cushion: 0 }]]);
    const steps = stepEpisodes([
      { accountId: 'a', current: 50, available: 50 },
      { accountId: 'b', current: -5, available: -5 },
    ], off, new Set(['a']));
    expect(steps).toEqual([]);
  });

  it('leaves alone an account with no settings row or no reported balance', () => {
    const steps = stepEpisodes([
      { accountId: 'unknown', current: -5, available: -5 },
      { accountId: 'a', current: null, available: null },
    ], new Map([['a', on()]]), new Set(['a']));
    expect(steps).toEqual([]);
  });
});

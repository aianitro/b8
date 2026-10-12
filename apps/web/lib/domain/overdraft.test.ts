import { describe, expect, it } from 'vitest';
import { stepEpisodes, stepForecasts, watchedBalance } from './overdraft';

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

describe('stepForecasts', () => {
  const p = (low: number) => ({ low, lowOn: '2026-10-15', charges: [{ label: 'Rent', amount: 50, on: '2026-10-15' }] });
  const settings = new Map([['a', on()], ['b', on()], ['c', on()], ['d', on()], ['e', on()]]);
  const seen = (id: string, bal = 30) => ({ accountId: id, current: bal, available: bal });

  it('opens below the cushion, refreshes, clears, and yields to an episode', () => {
    const steps = stepForecasts(
      [seen('a'), seen('b'), seen('c'), seen('d', -5), seen('e')],
      settings,
      new Set(['d']),               // d is overdrawn now
      new Set(['b', 'c', 'd']),
      new Map([['a', p(-20)], ['b', p(-10)], ['c', p(5)], ['e', p(0)]]),
    );
    expect(steps.map((s) => [s.kind, s.accountId, 'reason' in s ? s.reason : null])).toEqual([
      ['open', 'a', null],
      ['refresh', 'b', null],
      ['close', 'c', 'cleared'],
      ['close', 'd', 'episode'],
      // e: a low exactly at the cushion opens nothing.
    ]);
  });

  it('clears an open forecast when the account has no projection at all', () => {
    expect(stepForecasts([seen('a')], settings, new Set(), new Set(['a']), new Map()))
      .toEqual([{ kind: 'close', accountId: 'a', reason: 'cleared' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { accountFreshness, type FreshnessInput } from './accountFreshness';

const TZ = 'America/Los_Angeles';
const NOW = new Date('2026-11-02T14:30:00Z'); // 6:30 AM in TZ, a Monday

const at = (iso: string) => new Date(iso);

const input = (over: Partial<FreshnessInput> = {}): FreshnessInput => ({
  linked: true,
  valuationMode: 'valuation',
  lastSuccessfulUpdate: null,
  lastFailedUpdate: null,
  lastSyncedAt: null,
  latestObservationAt: null,
  ...over,
});

const read = (over: Partial<FreshnessInput> = {}) => accountFreshness(input(over), NOW, TZ);

describe('accountFreshness, a linked account', () => {
  // The weekend this module exists for: the feed succeeded this morning, and the newest recorded
  // value is Friday's close, because an unchanged balance records nothing.
  it('separates the sync that succeeded from the day the figure last moved', () => {
    expect(read({
      lastSuccessfulUpdate: at('2026-11-02T14:00:00Z'),
      lastSyncedAt: at('2026-11-02T14:01:00Z'),
      latestObservationAt: at('2026-10-31T13:00:00Z'),
    })).toEqual({
      tone: 'ok',
      text: 'Synced today at 6:00 AM · value last changed Oct 31',
      title: 'Last successful update Nov 2, 2026 at 6:00 AM. Value last recorded Oct 31, 2026 at 6:00 AM.',
    });
  });

  it('drops the second clause when the figure moved at the sync just named', () => {
    expect(read({
      lastSuccessfulUpdate: at('2026-11-02T14:00:00Z'),
      latestObservationAt: at('2026-11-02T14:00:01Z'),
    })?.text).toBe('Synced today at 6:00 AM');
  });

  it('drops it for a ledger account, whose chart is drawn from transactions', () => {
    expect(read({
      valuationMode: 'ledger',
      lastSuccessfulUpdate: at('2026-11-02T14:00:00Z'),
      latestObservationAt: at('2026-10-31T13:00:00Z'),
    })?.text).toBe('Synced today at 6:00 AM');
  });

  // last_synced_at is stamped by every run, successful or not, so it cannot stand in for Plaid's
  // own reading while that reading exists.
  it('prefers Plaid\'s successful update to the run our own job recorded', () => {
    expect(read({
      lastSuccessfulUpdate: at('2026-10-30T13:00:00Z'),
      lastSyncedAt: at('2026-11-02T14:01:00Z'),
    })?.text).toBe('Synced Oct 30');
  });

  it('falls back to our own run when Plaid reported no reading', () => {
    // 13:01 UTC is 5:01 AM on Nov 1, not 6:01 — the clocks went back that morning.
    expect(read({ lastSyncedAt: at('2026-11-01T13:01:00Z') })?.text).toBe('Synced yesterday at 5:01 AM');
  });

  it('warns while the newest attempt is a failure, and names the last good one', () => {
    expect(read({
      lastSuccessfulUpdate: at('2026-10-26T13:00:00Z'),
      lastFailedUpdate: at('2026-10-27T13:00:00Z'),
      lastSyncedAt: at('2026-11-02T14:01:00Z'),
    })).toEqual({
      tone: 'warn',
      text: 'Last sync failed Oct 27 · last good sync Oct 26',
      title: 'Last failed update Oct 27, 2026 at 6:00 AM. Last successful update Oct 26, 2026 at 6:00 AM.',
    });
  });

  // Self-Directed's actual shape on 2026-11-02: it failed on Oct 27 and has succeeded every day
  // since. Saying "last sync failed" here would raise an alarm about a problem that is over.
  it('says nothing of a failure the feed has already recovered from', () => {
    expect(read({
      lastSuccessfulUpdate: at('2026-11-02T14:00:00Z'),
      lastFailedUpdate: at('2026-10-27T13:00:00Z'),
      latestObservationAt: at('2026-10-31T13:00:00Z'),
    })).toEqual({
      tone: 'ok',
      text: 'Synced today at 6:00 AM · value last changed Oct 31',
      title: 'Last successful update Nov 2, 2026 at 6:00 AM. Value last recorded Oct 31, 2026 at 6:00 AM.',
    });
  });

  it('warns when a failure has no success behind it at all', () => {
    const r = read({ lastFailedUpdate: at('2026-10-27T13:00:00Z') });
    expect(r?.tone).toBe('warn');
    expect(r?.text).toBe('Last sync failed Oct 27 · never synced successfully');
  });

  it('warns when the account has never been walked', () => {
    expect(read()).toEqual({ tone: 'warn', text: 'Never synced', title: 'This account has not been synced yet.' });
  });
});

describe('accountFreshness, an account kept by hand', () => {
  it('dates a valued account from its newest recorded value', () => {
    expect(accountFreshness(
      input({ linked: false, latestObservationAt: at('2026-08-07T19:54:20Z') }), NOW, TZ
    )).toEqual({
      tone: 'ok',
      text: 'Last valued Aug 7',
      title: 'Value last recorded Aug 7, 2026 at 12:54 PM.',
    });
  });

  it('warns when it has never been valued', () => {
    expect(accountFreshness(input({ linked: false }), NOW, TZ)?.tone).toBe('warn');
  });

  // Nobody confirms a hand-kept ledger balance: it is the sum of the rows the owner imported,
  // and each row carries its own date.
  it('says nothing about a hand-kept ledger account', () => {
    expect(accountFreshness(
      input({ linked: false, valuationMode: 'ledger', latestObservationAt: at('2026-10-31T13:00:00Z') }), NOW, TZ
    )).toBeNull();
  });
});

describe('accountFreshness, dates read in the account holder\'s zone', () => {
  // 11 PM in Los Angeles is already tomorrow in UTC. Formatting in the zone keeps "today" the day
  // the reader is having, which is the whole reason the zone is passed in.
  it('calls a late-evening sync today, not tomorrow', () => {
    const late = new Date('2026-11-03T06:30:00Z'); // 10:30 PM Nov 2 in TZ
    expect(accountFreshness(
      input({ lastSuccessfulUpdate: new Date('2026-11-03T05:00:00Z') }), late, TZ
    )?.text).toBe('Synced today at 9:00 PM');
  });

  // Nov 1 2026 is the fall-back day in this zone: 25 hours long. "Yesterday" has to be a calendar
  // step, not a subtraction of 24 hours.
  it('steps back a calendar day across a daylight-saving change', () => {
    const now = new Date('2026-11-02T18:00:00Z'); // 10 AM Nov 2 in TZ
    expect(accountFreshness(
      input({ lastSuccessfulUpdate: new Date('2026-11-01T17:00:00Z') }), now, TZ
    )?.text).toBe('Synced yesterday at 9:00 AM');
  });

  it('spells out the year once the date is not in the one being read in', () => {
    expect(accountFreshness(
      input({ linked: false, latestObservationAt: at('2025-12-20T20:00:00Z') }), NOW, TZ
    )?.text).toBe('Last valued Dec 20, 2025');
  });
});

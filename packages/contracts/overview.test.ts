import { describe, expect, it } from 'vitest';
import { WATCHLIST_STALE_DAYS, watchlistIsStale } from './overview';

// The threshold left the web's WatchlistCard when the phone's dashboard started grading the same
// flag. What these pin is the BOUNDARY — the thing that drifts when two surfaces each keep their
// own copy, and the reason the constant is here rather than typed twice.

describe('watchlistIsStale', () => {
  it('turns on at the threshold, not after it', () => {
    expect(watchlistIsStale(WATCHLIST_STALE_DAYS - 1)).toBe(false);
    expect(watchlistIsStale(WATCHLIST_STALE_DAYS)).toBe(true);
    expect(watchlistIsStale(WATCHLIST_STALE_DAYS + 1)).toBe(true);
  });

  it('is false for a flag raised today', () => {
    expect(watchlistIsStale(0)).toBe(false);
  });

  // Two weeks is the documented intent; a change here is a product decision, not a refactor.
  it('is two weeks', () => {
    expect(WATCHLIST_STALE_DAYS).toBe(14);
  });
});

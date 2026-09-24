import { describe, expect, it } from 'vitest';
import { drillHref } from './drilldown';

// The conversion this module exists to own — every month index in the app is 0-based and the
// transactions page reads 1-based.
describe('drillHref', () => {
  it('shifts the month to 1-based and escapes the category', () => {
    expect(drillHref(['Toys/Gifts/Flowers'], 8))
      .toBe('/transactions?category=Toys%2FGifts%2FFlowers&month=9&from=dashboard');
  });
});

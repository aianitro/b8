import { describe, it, expect } from 'vitest';
import {
  transactionDetail, readable, detailedCategory, safeWebsiteUrl, mapsUrl, type DetailRow,
} from './transactionDetail';

// Fabricated rows throughout, as everywhere in this repo's tests.

const row = (over: Partial<DetailRow> = {}): DetailRow => ({
  id: 7,
  date: '2026-03-04',
  authorized_date: null,
  amount: '12.5',
  name: 'SQ *FABRICATED CAFE',
  merchant_name: 'Fabricated Cafe',
  logo_url: null,
  website: null,
  account_id: 'acct_x',
  account_name: 'Everyday Checking',
  mapped_category: 'Dining',
  plaid_category: 'FOOD_AND_DRINK',
  plaid_category_detailed: 'FOOD_AND_DRINK_COFFEE',
  plaid_category_confidence: 'VERY_HIGH',
  payment_channel: 'in store',
  location_city: null,
  location_region: null,
  location_country: null,
  note: null,
  watched_at: null,
  hidden: false,
  plaid_raw: null,
  ...over,
});

describe('transactionDetail', () => {
  it('reads the row, makes Plaid vocabularies readable, and takes the amount from the column', () => {
    const d = transactionDetail(row({ plaid_raw: { amount: 999, location: {} } }));
    expect(d).toMatchObject({
      id: 7, amount: 12.5, title: 'Fabricated Cafe', bankDescription: 'SQ *FABRICATED CAFE',
      account: { id: 'acct_x', name: 'Everyday Checking' }, budgetCategory: 'Dining',
      plaidCategory: 'Food and drink', plaidCategoryDetailed: 'Coffee', plaidConfidence: 'Very high',
      paymentChannel: 'In store', enriched: true, location: null, mapsUrl: null,
    });
  });

  it('never passes the raw object through', () => {
    const d = transactionDetail(row({ plaid_raw: { secret_new_key: 'x', counterparties: [] } }));
    expect(JSON.stringify(d)).not.toContain('secret_new_key');
    expect(d).not.toHaveProperty('plaid_raw');
  });

  it('builds the location from columns first, the raw object for the rest, and links coordinates', () => {
    const d = transactionDetail(row({
      location_city: 'Springfield', location_region: 'ST',
      plaid_raw: { location: { address: '1 Fabricated Way', city: 'Elsewhere', postal_code: '00000', store_number: '42', lat: 12.5, lon: -45.25 } },
    }));
    expect(d.location).toEqual({
      address: '1 Fabricated Way', city: 'Springfield', region: 'ST', postalCode: '00000', country: null, storeNumber: '42',
    });
    expect(d.mapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=12.5%2C-45.25');
  });

  it('says nothing twice: same authorized date, or a bank text equal to the title', () => {
    const d = transactionDetail(row({ authorized_date: '2026-03-04', name: 'Fabricated Cafe' }));
    expect(d.authorizedDate).toBeNull();
    expect(d.bankDescription).toBeNull();
    expect(transactionDetail(row({ authorized_date: '2026-03-02' })).authorizedDate).toBe('2026-03-02');
  });

  it('keeps named counterparties only, with safe links and logos', () => {
    const d = transactionDetail(row({ plaid_raw: { counterparties: [
      { name: 'Fabricated Pay', type: 'payment_app', website: 'pay.example.com', logo_url: 'https://logo.example.com/p.png' },
      { name: ' ', type: 'merchant' },
      { name: 'Evil', type: 'merchant', website: 'javascript:alert(1)', logo_url: 'http://insecure.example.com/x.png' },
      'not an object',
    ] } }));
    expect(d.counterparties).toEqual([
      { name: 'Fabricated Pay', type: 'Payment app', website: 'https://pay.example.com/', logoUrl: 'https://logo.example.com/p.png' },
      { name: 'Evil', type: 'Merchant', website: null, logoUrl: null },
    ]);
  });

  it('reads the payment method and processor', () => {
    const d = transactionDetail(row({ plaid_raw: { payment_meta: { payment_method: 'ACH', payment_processor: 'Fabricated Processing' } } }));
    expect(d).toMatchObject({ paymentMethod: 'Ach', paymentProcessor: 'Fabricated Processing' });
  });

  it('marks a row with nothing captured from Plaid, and survives a malformed blob', () => {
    expect(transactionDetail(row()).enriched).toBe(false);
    const d = transactionDetail(row({ plaid_raw: { location: 'nope', counterparties: 'nope', payment_meta: [] } }));
    expect(d).toMatchObject({ enriched: true, location: null, counterparties: [], paymentMethod: null });
  });

  it('reports watched from the timestamp', () => {
    expect(transactionDetail(row({ watched_at: new Date('2026-03-05') })).watched).toBe(true);
  });
});

describe('readable', () => {
  it('turns Plaid vocabularies into a sentence-case phrase', () => {
    expect(readable('FOOD_AND_DRINK')).toBe('Food and drink');
    expect(readable('in store')).toBe('In store');
    expect(readable('financial_institution')).toBe('Financial institution');
    expect(readable(null)).toBeNull();
    expect(readable('__')).toBeNull();
  });
});

describe('detailedCategory', () => {
  it('drops the primary prefix, keeps an unrelated value whole, and says nothing when equal', () => {
    expect(detailedCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE')).toBe('Coffee');
    expect(detailedCategory('FOOD_AND_DRINK', 'TRAVEL_FLIGHTS')).toBe('Travel flights');
    expect(detailedCategory('TRAVEL', 'TRAVEL')).toBeNull();
    expect(detailedCategory(null, null)).toBeNull();
  });
});

describe('safeWebsiteUrl', () => {
  it('links a bare host over https and keeps an explicit http(s) URL', () => {
    expect(safeWebsiteUrl('example.com')).toBe('https://example.com/');
    expect(safeWebsiteUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('refuses other schemes, credentials, undotted hosts, controls and non-strings', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.com', 'localhost', 'exa mple.com', 'java\tscript:x', 42, null]) {
      expect(safeWebsiteUrl(bad)).toBeNull();
    }
  });
});

describe('mapsUrl', () => {
  const loc = { address: '1 Fabricated Way', city: 'Springfield', region: 'ST', postalCode: null, country: null, storeNumber: null };

  it('falls back to the address when the coordinates are missing or out of range', () => {
    const expected = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('1 Fabricated Way, Springfield, ST');
    expect(mapsUrl({ lat: 95, lon: 10 }, loc)).toBe(expected);
    expect(mapsUrl({ lat: '12', lon: '10' }, loc)).toBe(expected);
    expect(mapsUrl(null, loc)).toBe(expected);
  });

  it('has nothing to link without coordinates or a street address', () => {
    expect(mapsUrl(null, { ...loc, address: null })).toBeNull();
  });
});

// The enrichment mapping on its own, with no database: what each Plaid field becomes as a column
// value, and what `plaid_raw` keeps. The SQL around it — that both upserts write these values, that
// nothing COALESCEs them, that the tombstone guard still holds — is proved against Postgres in
// `app/api/v1/sync/enrichment.test.ts`; this file pins the rules that are decided before any SQL.
//
// EVERY VALUE IS FABRICATED. Ids carry a FIXTURE- prefix, merchants are invented, and the
// counterparty account numbers are sentinel strings that are not account numbers at all.

import { describe, expect, it } from 'vitest';
import {
  CounterpartyType, TransactionPaymentChannelEnum, TransactionTransactionTypeEnum, type Transaction,
} from 'plaid';
import {
  enrichmentParams, plaidEnrichment, redactedPlaidTransaction, storableJson, storableText,
} from './plaidEnrichment';

/** Every key of the SDK's `Transaction`, so a dropped key cannot hide behind an absent one. */
function fixture(): Required<Transaction> {
  return {
    account_id: 'FIXTURE-unit-acct',
    amount: 1,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    category: null,
    category_id: null,
    check_number: null,
    date: '2026-03-04',
    location: {
      address: null, city: 'Fixtureville', region: 'FX', postal_code: null,
      country: 'US', lat: null, lon: null, store_number: null,
    },
    name: 'Fabricated Unit Cafe',
    merchant_name: 'Fabricated Unit Cafe',
    original_description: null,
    payment_meta: {
      reference_number: null, ppd_id: null, payee: null, by_order_of: null, payer: null,
      payment_method: null, payment_processor: null, reason: null,
    },
    pending: false,
    pending_transaction_id: null,
    account_owner: null,
    transaction_id: 'FIXTURE-unit-1',
    transaction_type: TransactionTransactionTypeEnum.Place,
    logo_url: 'https://logo.fixture.invalid/cafe.png',
    website: 'cafe.fixture.invalid',
    authorized_date: '2026-03-02',
    authorized_datetime: null,
    datetime: null,
    payment_channel: TransactionPaymentChannelEnum.InStore,
    personal_finance_category: {
      primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE', confidence_level: 'VERY_HIGH',
    },
    business_finance_category: null,
    transaction_code: null,
    personal_finance_category_icon_url: 'https://icon.fixture.invalid/food.png',
    counterparties: [{
      name: 'Fabricated Unit Cafe', entity_id: 'FIXTURE-entity-unit', type: CounterpartyType.Merchant,
      website: 'cafe.fixture.invalid', logo_url: null, confidence_level: 'HIGH',
      account_numbers: {
        bacs: { account: 'SENTINEL-UNIT-BACS-ACCT', sort_code: 'SENTINEL-UNIT-SORT' },
        international: { iban: 'SENTINEL-UNIT-IBAN', bic: 'SENTINEL-UNIT-BIC' },
      },
    }],
    merchant_entity_id: 'FIXTURE-entity-unit',
    client_customization: null,
  };
}

describe('plaidEnrichment', () => {
  it('maps every column verbatim, the detailed category included, and leaves the primary out', () => {
    const e = plaidEnrichment(fixture());
    expect(e).toMatchObject({
      plaidCategoryDetailed: 'FOOD_AND_DRINK_COFFEE',
      plaidCategoryConfidence: 'VERY_HIGH',
      authorizedDate: '2026-03-02',
      paymentChannel: 'in store',
      merchantEntityId: 'FIXTURE-entity-unit',
      logoUrl: 'https://logo.fixture.invalid/cafe.png',
      website: 'cafe.fixture.invalid',
      locationCity: 'Fixtureville',
      locationRegion: 'FX',
      locationCountry: 'US',
    });
    // The primary category is sync's own column, written from `primary` as it always was.
    expect(JSON.stringify(Object.values(e).slice(0, 10))).not.toContain('"FOOD_AND_DRINK"');
  });

  it('turns omitted, null, empty and whitespace-only values into null, never "" or "null"', () => {
    const t: Transaction = fixture();
    delete t.logo_url;
    delete t.merchant_entity_id;
    t.website = '   ';
    t.location = { ...t.location, city: '', region: '\t', country: null };
    t.authorized_date = null;
    t.personal_finance_category = null;
    const e = plaidEnrichment(t);
    for (const [k, v] of Object.entries(e)) {
      if (k === 'plaidRaw') continue;
      if (k === 'paymentChannel') { expect(v).toBe('in store'); continue; }
      expect(v, k).toBeNull();
    }
  });

  it('survives a transaction whose objects are missing outright', () => {
    const t = fixture() as unknown as Record<string, unknown>;
    delete t.location;
    delete t.personal_finance_category;
    delete t.counterparties;
    delete t.payment_channel;
    const e = plaidEnrichment(t as unknown as Transaction);
    expect(e.locationCity).toBeNull();
    expect(e.plaidCategoryDetailed).toBeNull();
    expect(e.paymentChannel).toBeNull();
    expect(JSON.parse(e.plaidRaw)).not.toHaveProperty('counterparties');
  });

  it('passes the authorized date through as the string, and refuses one Postgres would reject', () => {
    const t = fixture();
    expect(plaidEnrichment(t).authorizedDate).toBe('2026-03-02');
    for (const bad of ['2026-02-30', '2026-3-2', '2026-03-02T00:00:00Z', 'yesterday']) {
      expect(plaidEnrichment({ ...t, authorized_date: bad }).authorizedDate, bad).toBeNull();
    }
    expect(plaidEnrichment({ ...t, authorized_date: '2024-02-29' }).authorizedDate).toBe('2024-02-29');
  });

  it('serialises plaid_raw once, as a JSON object rather than a JSON string', () => {
    const parsed = JSON.parse(plaidEnrichment(fixture()).plaidRaw);
    expect(typeof parsed).toBe('object');
    expect(parsed.transaction_id).toBe('FIXTURE-unit-1');
  });

  it('binds the eleven values in the column order the upserts name', () => {
    const e = plaidEnrichment(fixture());
    const p = enrichmentParams(e);
    expect(p).toHaveLength(11);
    expect(p).toEqual([
      e.plaidCategoryDetailed, e.plaidCategoryConfidence, e.authorizedDate, e.paymentChannel,
      e.merchantEntityId, e.logoUrl, e.website, e.locationCity, e.locationRegion, e.locationCountry,
      e.plaidRaw,
    ]);
  });
});

describe('redactedPlaidTransaction', () => {
  it('removes only counterparties[*].account_numbers and keeps every other key', () => {
    const t = fixture();
    const out = redactedPlaidTransaction(t);
    expect(Object.keys(out).sort()).toEqual(Object.keys(t).sort());
    const { account_numbers: _gone, ...keptCounterparty } = t.counterparties[0];
    expect(out).toEqual({ ...t, counterparties: [keptCounterparty] });
    expect(JSON.stringify(out)).not.toMatch(/SENTINEL/);
    expect(out).toHaveProperty('payment_meta', t.payment_meta);
    expect(out).toHaveProperty('account_owner', null);
  });

  it('does not edit the response object it was given', () => {
    const t = fixture();
    const before = structuredClone(t);
    redactedPlaidTransaction(t);
    plaidEnrichment(t);
    expect(t).toEqual(before);
    expect(t.counterparties[0]).toHaveProperty('account_numbers');
  });

  it('leaves odd counterparty shapes as received instead of throwing', () => {
    const t = fixture() as unknown as Record<string, unknown>;
    t.counterparties = [null, 'FIXTURE-odd', { name: 'Fabricated Unit Payee', type: 'merchant' }];
    const out = redactedPlaidTransaction(t as unknown as Transaction);
    expect(out.counterparties).toEqual(t.counterparties);
    t.counterparties = 'FIXTURE-not-an-array';
    expect(redactedPlaidTransaction(t as unknown as Transaction).counterparties).toBe('FIXTURE-not-an-array');
  });
});

// G3 amendment (REVIEW-1 B1). Built from code units with `String.fromCharCode` rather than written as
// escapes in literals, so what each case feeds in is unambiguous on the page.
const NUL = String.fromCharCode(0);
const HIGH = String.fromCharCode(0xd800);
const LOW = String.fromCharCode(0xdc00);
const FFFD = String.fromCharCode(0xfffd);
/** A correctly paired surrogate: one emoji, two code units. Must survive untouched. */
const EMOJI = String.fromCharCode(0xd83d, 0xde00);

describe('storableText / storableJson', () => {
  it('replaces U+0000 and lone high and low surrogates with U+FFFD, one for one', () => {
    expect(storableText(`A${NUL}B`)).toBe(`A${FFFD}B`);
    expect(storableText(`X${HIGH}Y`)).toBe(`X${FFFD}Y`);
    expect(storableText(`X${LOW}Y`)).toBe(`X${FFFD}Y`);
    expect(storableText(`${HIGH}`)).toBe(FFFD);
    expect(storableText(`end${HIGH}`)).toBe(`end${FFFD}`);
    expect(storableText(`${LOW}${HIGH}`)).toBe(`${FFFD}${FFFD}`);
    expect(storableText(`${HIGH}${HIGH}${LOW}`)).toBe(`${FFFD}${HIGH}${LOW}`);
    expect(storableText(`${NUL}${NUL}`)).toBe(`${FFFD}${FFFD}`);
  });

  it('preserves a valid surrogate pair and every other character', () => {
    expect(storableText(`Caf\u00e9 ${EMOJI} in store`)).toBe(`Caf\u00e9 ${EMOJI} in store`);
    expect(storableText('\t \n plain')).toBe('\t \n plain');
    expect(storableText(`${EMOJI}${NUL}${EMOJI}`)).toBe(`${EMOJI}${FFFD}${EMOJI}`);
  });

  it('cleans keys and values at any depth, passes non-strings through, and does not mutate', () => {
    const input = {
      [`k${NUL}`]: `v${HIGH}`,
      n: 1, f: 0.5, b: false, z: null,
      arr: [`a${LOW}`, 2, true, null, { deep: `d${NUL}` }],
      nested: { ok: `fine ${EMOJI}` },
    };
    const before = structuredClone(input);
    expect(storableJson(input)).toEqual({
      [`k${FFFD}`]: `v${FFFD}`,
      n: 1, f: 0.5, b: false, z: null,
      arr: [`a${FFFD}`, 2, true, null, { deep: `d${FFFD}` }],
      nested: { ok: `fine ${EMOJI}` },
    });
    expect(input).toEqual(before);
    expect(storableJson(7)).toBe(7);
    expect(storableJson(null)).toBeNull();
    expect(storableJson(true)).toBe(true);
  });

  it('leaves no escape in plaid_raw that jsonb refuses, and cleans the columns, without editing the response', () => {
    const t = fixture();
    t.location = { ...t.location, city: `Fixture${NUL}ville` };
    t.website = `cafe${HIGH}.fixture.invalid`;
    t.payment_meta = { ...t.payment_meta, reference_number: `REF${NUL}${LOW}` };
    t.counterparties = [{ ...t.counterparties[0], name: `Cafe ${EMOJI}${HIGH}` }];
    const before = structuredClone(t);
    const e = plaidEnrichment(t);
    expect(e.locationCity).toBe(`Fixture${FFFD}ville`);
    expect(e.website).toBe(`cafe${FFFD}.fixture.invalid`);
    expect(e.plaidRaw).not.toMatch(/\\u0000|\\ud[89ab][0-9a-f]{2}|\\ud[c-f][0-9a-f]{2}/i);
    const raw = JSON.parse(e.plaidRaw);
    expect(raw.payment_meta.reference_number).toBe(`REF${FFFD}${FFFD}`);
    expect(raw.counterparties[0].name).toBe(`Cafe ${EMOJI}${FFFD}`);
    expect(raw.counterparties[0]).not.toHaveProperty('account_numbers');
    expect(t).toEqual(before);
  });
});

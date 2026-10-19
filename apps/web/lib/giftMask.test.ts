// P7-41b — what a masked row is: `lib/domain/giftMask.ts`, pure. Scenarios P1–P6 of SPEC.md.
//
// CANARIES. Every text field of the fabricated row holds a distinct token (`ZQ41B…`), so a leak is
// found by substring in the serialised output whatever field it came through and whatever case it
// was printed in. None is a real name, merchant or figure.

import { describe, expect, it } from 'vitest';
import {
  GIFT_LABEL,
  MASKED_ROW_KEYS,
  TRANSACTION_COLUMN_MASK,
  isMaskedFor,
  maskedProjection,
  merchantBuckets,
  viewRow,
  type FullTransactionRow,
  type GiftHold,
} from './domain/giftMask';
import { maskedTransactionDetail, transactionDetail, type DetailRow } from './transactionDetail';

const GIVER = 21;
const RECIPIENT = 22;
const THIRD = 23;
const TODAY = '2026-11-20';
const HOLD: GiftHold = { giverUserId: GIVER, revealDate: '2026-12-25' };

const CANARIES = [
  'ZQ41Bname', 'ZQ41Bmerchant', 'ZQ41Bplaidcat', 'ZQ41Bdetailed', 'ZQ41Bconfidence', 'ZQ41Bchannel',
  'ZQ41Bentity', 'ZQ41Blogo', 'ZQ41Bwebsite', 'ZQ41Bcity', 'ZQ41Bregion', 'ZQ41Bcountry', 'ZQ41Bnote',
  'ZQ41Bplaidid', 'ZQ41Bcounterparty', 'ZQ41Baddress', 'ZQ41Bstore', 'ZQ41Bprocessor', 'ZQ41Bmethod',
  'ZQ41Bpeer', 'ZQ41Bsuggestion', 'ZQ41Bpostal',
];

function fullRow(patch: Partial<FullTransactionRow> = {}): FullTransactionRow {
  return {
    id: 501,
    date: '2026-11-05',
    amount: '48.15',
    account_id: 'acct-zq41b-card',
    account_name: 'Fabricated Card',
    account_landscape: 'operational',
    mapped_category: 'Fabricated Gifts',
    hidden: false,
    created_at: '2026-11-06T06:00:00.000Z',
    rule_applied: false,
    effective_property: null,
    name: 'ZQ41Bname',
    merchant_name: 'ZQ41Bmerchant',
    plaid_category: 'ZQ41Bplaidcat',
    plaid_category_detailed: 'ZQ41Bdetailed',
    plaid_category_confidence: 'ZQ41Bconfidence',
    payment_channel: 'ZQ41Bchannel',
    merchant_entity_id: 'ZQ41Bentity',
    logo_url: 'https://ZQ41Blogo.example/x.png',
    website: 'ZQ41Bwebsite.example',
    authorized_date: '2026-11-04',
    location_city: 'ZQ41Bcity',
    location_region: 'ZQ41Bregion',
    location_country: 'ZQ41Bcountry',
    note: 'ZQ41Bnote',
    watched_at: '2026-11-06 07:00:00+00',
    plaid_transaction_id: 'ZQ41Bplaidid',
    group_peers: [{ account_name: 'ZQ41Bpeer', amount: '-48.15' }],
    suggestion: { rationale: 'ZQ41Bsuggestion' },
    plaid_raw: {
      counterparties: [{ name: 'ZQ41Bcounterparty', website: 'ZQ41Bwebsite.example' }],
      location: { address: 'ZQ41Baddress', store_number: 'ZQ41Bstore', postal_code: 'ZQ41Bpostal' },
      payment_meta: { payment_processor: 'ZQ41Bprocessor', payment_method: 'ZQ41Bmethod' },
    },
    ...patch,
  };
}

const leaks = (value: unknown) => {
  const text = JSON.stringify(value).toLowerCase();
  return CANARIES.filter((c) => text.includes(c.toLowerCase()));
};

describe('the masked projection (P)', () => {
  it('T41b-P1: the masked projection of a row with a canary in every text field holds none of them, and keeps the label, amount, date and account', () => {
    const masked = maskedProjection(fullRow());
    expect(leaks(masked)).toEqual([]);
    const text = JSON.stringify(masked);
    expect(text).toContain(GIFT_LABEL);
    expect(masked.amount).toBe('48.15');
    expect(masked.date).toBe('2026-11-05');
    expect(masked.account_name).toBe('Fabricated Card');
    // The detail sheet's own projection, from the same row through the real detail builder.
    const detailRow = fullRow() as unknown as DetailRow;
    const detail = maskedTransactionDetail(transactionDetail(detailRow));
    expect(leaks(detail)).toEqual([]);
    expect(detail.title).toBe(GIFT_LABEL);
    expect(detail.amount).toBe(48.15);
    expect(detail.account).toEqual({ id: 'acct-zq41b-card', name: 'Fabricated Card' });
    expect(detail.enriched).toBe(false);
    // Control: the unmasked detail of the same row DOES carry the canaries, so the check can fail.
    expect(leaks(transactionDetail(detailRow)).length).toBeGreaterThan(5);
  });

  it('T41b-P2: the masked key set is exactly the allowlist for every row variant, and every column of transactions is classified', () => {
    const variants = [
      fullRow(),
      fullRow({ name: null, merchant_name: null, logo_url: null, website: null, plaid_raw: null, note: null }),
      fullRow({ effective_property: 'Fabricated Cottage', hidden: true, mapped_category: null }),
    ];
    for (const v of variants) {
      expect(Object.keys(maskedProjection(v)).sort()).toEqual([...MASKED_ROW_KEYS].sort());
    }
    // The SQL row source is built from this table: every `transactions` column has a treatment, and
    // the kept ones are the allowlist's columns.
    const kept = Object.entries(TRANSACTION_COLUMN_MASK).filter(([, t]) => t === 'keep').map(([c]) => c).sort();
    expect(kept).toEqual(['account_id', 'amount', 'created_at', 'date', 'hidden', 'id', 'mapped_category', 'property_id']);
    expect(Object.keys(TRANSACTION_COLUMN_MASK)).toHaveLength(27);
  });

  it('T41b-P3: the giver sees the row itself; everyone else — a third user, null and undefined included — sees it masked until the reveal date', () => {
    const r = fullRow();
    expect(viewRow(r, HOLD, GIVER, TODAY)).toEqual(r);
    expect(viewRow(r, HOLD, RECIPIENT, TODAY)).toEqual(maskedProjection(r));
    expect(viewRow(r, HOLD, THIRD, TODAY)).toEqual(maskedProjection(r));
    expect(viewRow(r, HOLD, null, TODAY)).toEqual(maskedProjection(r));
    expect(viewRow(r, HOLD, undefined, TODAY)).toEqual(maskedProjection(r));
    expect(isMaskedFor(HOLD, RECIPIENT, '2026-12-24')).toBe(true);
    expect(viewRow(r, HOLD, RECIPIENT, '2026-12-25')).toEqual(r);
    expect(viewRow(r, HOLD, null, '2026-12-26')).toEqual(r);
  });

  it('T41b-P4: a row no gift holds is returned unchanged for every viewer, null included', () => {
    const r = fullRow();
    for (const v of [GIVER, RECIPIENT, THIRD, null, undefined]) expect(viewRow(r, null, v, TODAY)).toEqual(r);
  });

  it('T41b-P5: the masked label is exactly Gift whether the merchant and name are null, empty or present — never a fallback', () => {
    for (const patch of [
      { name: null, merchant_name: null },
      { name: '', merchant_name: '' },
      { name: 'ZQ41Bname', merchant_name: 'ZQ41Bmerchant' },
    ]) {
      const masked = maskedProjection(fullRow(patch));
      expect(masked.label).toBe('Gift');
      expect(['Unnamed', 'Transaction', '—', '']).not.toContain(masked.label);
    }
    // The SQL row source carries the label in `name` with no merchant, so every existing label
    // chain (`merchant ?? name ?? fallback`) yields exactly the label.
    expect(TRANSACTION_COLUMN_MASK.name).toBe('label');
    expect(TRANSACTION_COLUMN_MASK.merchant_name).toBe('null');
  });

  it('T41b-P6: for a non-giver the masked rows group into one Gift bucket with the same total; the giver sees the real grouping', () => {
    const rows = [
      { merchant: 'ZQ41Bmerchant', name: 'ZQ41Bname', amount: '48.15', hold: HOLD },
      { merchant: 'ZQ41Bother', name: null, amount: '0.35', hold: HOLD },
      { merchant: 'Fabricated Grocer', name: null, amount: '12.07', hold: null },
    ];
    const recipient = merchantBuckets(rows, RECIPIENT, TODAY);
    expect(recipient).toEqual([
      { merchant: 'Gift', count: 2, total: '48.50' },
      { merchant: 'Fabricated Grocer', count: 1, total: '12.07' },
    ]);
    expect(leaks(recipient)).toEqual([]);
    const giver = merchantBuckets(rows, GIVER, TODAY);
    expect(giver.map((b) => b.merchant).sort()).toEqual(['Fabricated Grocer', 'ZQ41Bmerchant', 'ZQ41Bother']);
    expect(merchantBuckets(rows, null, TODAY)[0]).toEqual({ merchant: 'Gift', count: 2, total: '48.50' });
  });
});

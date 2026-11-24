// P8-42d — the screenshot contract (U7–U10): the read answer, the confirm request, the panel's
// `screenshotDue` and the exports, each as a table of accepted and refused objects.
//
// THE CONTRACT IS REACHED AS A NAMESPACE (`loyalty.<Name>`), never by named import, and every test
// first asserts that the export it uses exists. So against a contracts file without these exports a
// test fails on that assertion, not on an import error that would stop the whole file from loading.
//
// Fabricated data only: letter-bearing suffixes, small whole balances, and the one cash figure is
// built from its parts in the test.

import { describe, expect, it } from 'vitest';
import * as loyalty from '@b8/contracts/loyalty';

type Schema = { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } };
/** The named export as a schema, after asserting that it is one. */
function schema(name: string): Schema {
  const s = (loyalty as Record<string, unknown>)[name] as Schema | undefined;
  expect(typeof s?.safeParse, `${name} is exported as a schema`).toBe('function');
  return s as Schema;
}
const accepts = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `accepts ${what}`).toBe(true);
const refuses = (s: Schema, v: unknown, what: string) => expect(s.safeParse(v).success, `refuses ${what}`).toBe(false);

const CASH = ['7', '25'].join('.');
const FULL_READ = {
  outcome: 'read', errorCode: null, balance: '12', unit: 'points', asOf: '2026-01-05', maskedSuffix: '••••ZQ7K',
  programCheck: 'match', suffixCheck: 'match', unitCheck: 'match',
  expiryWarnings: [{ what: 'points', expiresOn: '2026-03-01', amount: '5' }], instruments: [{ kind: 'free_night', expiresOn: null }],
};
const NOTHING = {
  outcome: 'read', errorCode: null, balance: null, unit: null, asOf: null, maskedSuffix: null,
  programCheck: 'not_stated', suffixCheck: 'not_stated', unitCheck: 'not_stated', expiryWarnings: [], instruments: [],
};
const PANEL = { readable: false, lastRead: null, waiting: 0, failed: 0, needsAttentionTotal: 0, needsAttention: [], coverage: [], fromMail: [] };

describe('the screenshot contract (P8-42d)', () => {
  it('T42d-U7: the read answer accepts a full read, an empty read, disabled and each error, and refuses anything loose', () => {
    const s = schema('LoyaltyScreenshotReadSchema');
    accepts(s, FULL_READ, 'a full read');
    accepts(s, NOTHING, 'a read with nothing readable');
    accepts(s, { ...FULL_READ, balance: CASH, unit: 'usd', unitCheck: 'mismatch' }, 'a cash reading');
    accepts(s, { ...FULL_READ, balance: '0' }, 'a read zero');
    accepts(s, { ...NOTHING, outcome: 'disabled' }, 'disabled');
    for (const code of loyalty.LOYALTY_READ_ERROR_CODES) accepts(s, { ...NOTHING, outcome: 'error', errorCode: code }, `error ${code}`);

    for (const key of ['name', 'memberNumber', 'image', 'subject']) refuses(s, { ...FULL_READ, [key]: 'ZQ42D' }, `an unknown key ${key}`);
    refuses(s, { ...NOTHING, outcome: 'error' }, 'an error without a code');
    refuses(s, { ...FULL_READ, errorCode: 'timeout' }, 'a code on a read');
    refuses(s, { ...NOTHING, outcome: 'disabled', errorCode: 'timeout' }, 'a code on disabled');
    refuses(s, { ...FULL_READ, unit: null, unitCheck: 'not_stated' }, 'a balance without a unit');
    refuses(s, { ...FULL_READ, balance: null }, 'a unit without a balance');
    for (const bad of [['12', '5'].join('.'), '-12', '+12', ['1', '200'].join(','), '012']) refuses(s, { ...FULL_READ, balance: bad }, `a whole-unit balance ${bad}`);
    for (const bad of [['7', '5'].join('.'), ['7', '125'].join('.'), '7', `-${CASH}`]) refuses(s, { ...FULL_READ, unit: 'usd', balance: bad }, `a cash balance ${bad}`);
    for (const outcome of ['disabled', 'error']) {
      const base = { ...NOTHING, outcome, errorCode: outcome === 'error' ? 'api_error' : null };
      refuses(s, { ...base, balance: '12', unit: 'points' }, `${outcome} carrying a balance`);
      refuses(s, { ...base, asOf: '2026-01-05' }, `${outcome} carrying a date`);
      refuses(s, { ...base, maskedSuffix: '••••ZQ7K' }, `${outcome} carrying a suffix`);
      refuses(s, { ...base, instruments: FULL_READ.instruments }, `${outcome} carrying an instrument`);
      refuses(s, { ...base, programCheck: 'match' }, `${outcome} carrying a comparison`);
    }
    refuses(s, { ...NOTHING, unitCheck: 'match' }, 'a unit comparison with no unit');
    refuses(s, { ...NOTHING, suffixCheck: 'mismatch' }, 'a suffix comparison with no suffix');
    for (const bad of ['ZQ7K', '•••ZQ7K', '••••ZQ', '••••ZQ7K9', '••••', 'ZQ42DFULLNUMBERZQ7K']) refuses(s, { ...FULL_READ, maskedSuffix: bad }, `a suffix ${bad}`);
    refuses(s, { ...FULL_READ, expiryWarnings: Array(loyalty.LOYALTY_READ_EXPIRY_MAX + 1).fill(FULL_READ.expiryWarnings[0]) }, 'too many expiry warnings');
    refuses(s, { ...FULL_READ, instruments: Array(loyalty.LOYALTY_READ_INSTRUMENT_MAX + 1).fill(FULL_READ.instruments[0]) }, 'too many instruments');
  });

  it('T42d-U8: the confirm request takes asOf, balance and unit only, valid for the unit, and never echoes a value', () => {
    const s = schema('LoyaltyScreenshotConfirmRequestSchema');
    accepts(s, { asOf: '2026-01-05', balance: '12', unit: 'points' }, 'whole units');
    accepts(s, { asOf: '2026-01-05', balance: CASH, unit: 'usd' }, 'cash');
    accepts(s, { asOf: '2026-01-05', balance: '0', unit: 'nights' }, 'a zero');
    for (const source of ['screenshot', 'typed', 'email', 'import', null]) refuses(s, { asOf: '2026-01-05', balance: '12', unit: 'points', source }, `source ${source}`);
    refuses(s, { asOf: '2026-01-05', balance: '12', unit: 'points', image: 'ZQ42D' }, 'an image key');
    refuses(s, { asOf: '2026-01-05', balance: '12', unit: 'points', note: 'ZQ42D' }, 'an extra key');
    for (const asOf of ['2026-02-30', '2026-1-5', 'ZQ42D', '']) refuses(s, { asOf, balance: '12', unit: 'points' }, `the date ${asOf}`);
    for (const balance of [['12', '5'].join('.'), '-12', ['1', '200'].join(','), ' 12', 'ZQ42D']) refuses(s, { asOf: '2026-01-05', balance, unit: 'miles' }, `the balance ${balance}`);
    refuses(s, { asOf: '2026-01-05', balance: ['7', '125'].join('.'), unit: 'usd' }, 'a third cash decimal');
    refuses(s, { asOf: '2026-01-05', balance: 12, unit: 'points' }, 'a JSON number');
    for (const missing of ['asOf', 'balance', 'unit']) {
      const body: Record<string, unknown> = { asOf: '2026-01-05', balance: '12', unit: 'points' };
      delete body[missing];
      refuses(s, body, `a body without ${missing}`);
    }
    const echoed = 'ZQ42D-SUBMITTED-VALUE';
    for (const body of [{ asOf: '2026-01-05', balance: echoed, unit: 'points' }, { asOf: echoed, balance: '12', unit: 'points' }, { asOf: '2026-01-05', balance: '12', unit: echoed }]) {
      const r = s.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message ?? '').not.toContain(echoed);
    }
  });

  it('T42d-U9: the panel requires screenshotDue, strictly ascending positive whole ids', () => {
    const s = schema('LoyaltyInboxReadPanelSchema');
    accepts(s, { ...PANEL, screenshotDue: [] }, 'an empty list');
    accepts(s, { ...PANEL, screenshotDue: [1, 2, 7, 40] }, 'ascending ids');
    refuses(s, PANEL, 'a missing key');
    refuses(s, { ...PANEL, screenshotDue: null }, 'null');
    refuses(s, { ...PANEL, screenshotDue: [3, 3] }, 'a repeat');
    refuses(s, { ...PANEL, screenshotDue: [4, 2] }, 'a descending pair');
    refuses(s, { ...PANEL, screenshotDue: [0, 1] }, 'zero');
    refuses(s, { ...PANEL, screenshotDue: [-1] }, 'a negative');
    refuses(s, { ...PANEL, screenshotDue: [1.5] }, 'a fraction');
  });

  it('T42d-U10: the read envelope, the outcomes export, and the typed route still refusing a screenshot source', () => {
    const r = schema('LoyaltyScreenshotReadResponseSchema');
    accepts(r, { success: true, data: FULL_READ }, 'a success');
    accepts(r, { success: false, error: { code: 'INVALID_INPUT', message: 'The request is not valid.' } }, 'a failure');
    refuses(r, { success: true, data: { ...FULL_READ, name: 'ZQ42D' } }, 'a success carrying a name');
    refuses(r, { success: true }, 'a success without data');
    expect((loyalty as Record<string, unknown>).LOYALTY_SCREENSHOT_OUTCOMES).toEqual(['read', 'disabled', 'error']);
    const outcome = schema('LoyaltyScreenshotOutcomeSchema');
    for (const o of ['read', 'disabled', 'error']) accepts(outcome, o, o);
    refuses(outcome, 'applied', 'another outcome');
    const typed = schema('LoyaltyObservationCreateRequestSchema');
    accepts(typed, { asOf: '2026-01-05', balance: '12', unit: 'points', source: 'typed' }, 'a typed reading');
    refuses(typed, { asOf: '2026-01-05', balance: '12', unit: 'points', source: 'screenshot' }, 'a typed request claiming screenshot');
  });
});

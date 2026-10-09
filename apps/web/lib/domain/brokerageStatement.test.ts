import { describe, expect, it } from 'vitest';
import { parseBrokerageStatement } from './brokerageStatement';

// Fabricated statement text in the shape the PDF extractor produces: the page-one summary lines
// run together with whatever sits beside them. No figure here comes from a real statement.
const page1 = (ending = 'Ending Total Value (as of 9/30/26) $12,345.67') =>
  'CLIENT STATEMENT For the Period July 1- September 30, 2026 STATEMENT FOR: ' +
  'Beginning Total Value (as of 7/1/26) $10,000.00 FABRICATED OWNER ' + ending +
  ' Includes Accrued Interest Account Summary 111-222333-444 ';

describe('parseBrokerageStatement', () => {
  it('reads the ending value, its as-of date, and the account ending', () => {
    expect(parseBrokerageStatement(page1())).toEqual({
      ok: true,
      reading: { asOf: '2026-09-30', value: 12345.67, accountEnding: '444' },
    });
  });

  it('takes the ENDING value, never the beginning one beside it', () => {
    const r = parseBrokerageStatement(page1());
    expect(r.ok && r.reading.value).toBe(12345.67);
  });

  it('accepts a repeat of the same figure later in the document, and line breaks inside the label', () => {
    const text = page1('Ending Total\nValue (as of 9/30/26)\n$12,345.67') + ' … Ending Total Value (as of 9/30/2026) $12,345.67';
    expect(parseBrokerageStatement(text)).toMatchObject({ ok: true, reading: { asOf: '2026-09-30', value: 12345.67 } });
  });

  it('refuses a document with no ending value rather than guessing at another figure', () => {
    const r = parseBrokerageStatement('Some other bank statement. Closing balance $999.00');
    expect(r.ok).toBe(false);
  });

  it('refuses two different ending values', () => {
    const text = page1() + ' Ending Total Value (as of 9/30/26) $1.00';
    expect(parseBrokerageStatement(text).ok).toBe(false);
  });

  it('refuses a date that is not on the calendar', () => {
    expect(parseBrokerageStatement(page1('Ending Total Value (as of 2/30/26) $1.00')).ok).toBe(false);
  });

  it('reads a statement with no account number printed', () => {
    const r = parseBrokerageStatement('Ending Total Value (as of 12/31/25) $0.00');
    expect(r).toEqual({ ok: true, reading: { asOf: '2025-12-31', value: 0, accountEnding: null } });
  });
});

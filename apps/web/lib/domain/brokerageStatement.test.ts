import { describe, expect, it } from 'vitest';
import { companyName, parseBrokerageStatement, transfersIn } from './brokerageStatement';

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
      reading: { asOf: '2026-09-30', value: 12345.67, accountEnding: '444', transfersIn: [] },
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
    expect(r).toEqual({ ok: true, reading: { asOf: '2025-12-31', value: 0, accountEnding: null, transfersIn: [] } });
  });
});

describe('transfersIn', () => {
  // Fabricated rows in the extractor's layout: one per line, the dollar sign on the first only.
  const section =
    'SECURITY TRANSFERS\nActivity\nDate Activity Type Security (Symbol) Comments Quantity Accrued Interest Amount\n' +
    '9/17 Transfer into Account FABRICATED CORP, INC 10.000 $1,234.50\n' +
    '9/17 Transfer into Account FABRICATED CORP, INC 2.5 98.76\n' +
    '9/16 9/17 Sold FABRICATED CORP, INC ACTED AS AGENT\n' +
    '9/28 Transfer out of Account FABRICATED CORP, INC 1.000 $50.00\n' +
    'TOTAL SECURITY TRANSFERS $1,333.26\n';

  it('reads each shares-received row, and nothing that left the account', () => {
    expect(transfersIn(section, '2026-09-30')).toEqual([
      { date: '2026-09-17', security: 'FABRICATED CORP, INC', quantity: 10, amount: 1234.5 },
      { date: '2026-09-17', security: 'FABRICATED CORP, INC', quantity: 2.5, amount: 98.76 },
    ]);
  });

  it('dates a December row on a January statement to the year before', () => {
    const text = '12/20 Transfer into Account FABRICATED CORP, INC 1.000 $10.00\n';
    expect(transfersIn(text, '2027-01-31')[0].date).toBe('2026-12-20');
  });

  it('rides along on the statement reading', () => {
    const r = parseBrokerageStatement(page1() + section);
    expect(r.ok && r.reading.transfersIn).toHaveLength(2);
  });
});

describe('companyName', () => {
  it('drops the legal suffix and title-cases what is left', () => {
    expect(companyName('FABRICATED CORP, INC')).toBe('Fabricated Corp');
    expect(companyName('ZSCALER, INC')).toBe('Zscaler');
    expect(companyName('ACME HOLDINGS')).toBe('Acme');
    expect(companyName('Widget Co.')).toBe('Widget');
  });
});

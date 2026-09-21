import { describe, it, expect } from 'vitest';
import { accountTypeLabel, ACCOUNT_TYPES } from './accountTypes';

describe('accountTypeLabel', () => {
  it('labels each canonical account type', () => {
    expect(accountTypeLabel('depository', 'checking')).toBe('Checking');
    expect(accountTypeLabel('depository', 'savings')).toBe('Savings');
    expect(accountTypeLabel('credit', 'credit card')).toBe('Credit Card');
    expect(accountTypeLabel('investment', 'brokerage')).toBe('Brokerage');
  });

  it('labels the subtype-less types by their type alone', () => {
    expect(accountTypeLabel('loan', null)).toBe('Loan / Mortgage');
    expect(accountTypeLabel('other', null)).toBe('Other');
  });

  it('every canonical entry round-trips to its own label', () => {
    for (const t of ACCOUNT_TYPES) {
      expect(accountTypeLabel(t.type, t.subtype)).toBe(t.label);
    }
  });

  describe('falls back to capitalizing whatever Plaid actually sent', () => {
    it.each([
      ['money market', 'Money Market'],
      ['ira', 'Ira'],
      ['401k', '401k'], // leading digit: \b\w matches the digit, which has no uppercase form
      ['cash management', 'Cash Management'],
    ])('renders an unrecognized subtype %s as %s', (subtype, expected) => {
      expect(accountTypeLabel('investment', subtype)).toBe(expected);
    });

    it('falls back to the type when the subtype is null and unrecognized', () => {
      expect(accountTypeLabel('payroll', null)).toBe('Payroll');
    });

    it('prefers the subtype over the type when both are unrecognized', () => {
      expect(accountTypeLabel('brokerage', 'mutual fund')).toBe('Mutual Fund');
    });
  });

  it('matches a known subtype even under an unexpected type', () => {
    // The lookup keys on subtype first, so a Plaid type change does not lose the label.
    expect(accountTypeLabel('unexpected', 'savings')).toBe('Savings');
  });
});

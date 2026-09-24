import { describe, it, expect } from 'vitest';
import { isValidTransferIds, validateTransferRows, type TransferCandidate , isCounterpart } from './transferValidation';

const row = (id: number, amount: string | number, groupId: number | null = null): TransferCandidate => ({
  id,
  amount,
  transfer_group_id: groupId,
});

describe('isValidTransferIds', () => {
  it('accepts two or more distinct ids', () => {
    expect(isValidTransferIds([1, 2])).toBe(true);
    expect(isValidTransferIds([1, 2, 3, 4])).toBe(true);
  });

  it('rejects fewer than two ids — one transaction is not a transfer', () => {
    expect(isValidTransferIds([1])).toBe(false);
    expect(isValidTransferIds([])).toBe(false);
  });

  it('rejects duplicate ids, which would net a transaction against itself', () => {
    expect(isValidTransferIds([1, 1])).toBe(false);
    expect(isValidTransferIds([1, 2, 2])).toBe(false);
  });

  it('rejects non-array input', () => {
    expect(isValidTransferIds(null)).toBe(false);
    expect(isValidTransferIds(undefined)).toBe(false);
    expect(isValidTransferIds('1,2')).toBe(false);
  });

  it('rejects non-integer ids reaching a SQL parameter', () => {
    // These are interpolated into `id = ANY($1)`; anything non-integer is malformed input,
    // not a lookup that should be attempted.
    expect(isValidTransferIds(['1', '2'])).toBe(false);
    expect(isValidTransferIds([1.5, 2])).toBe(false);
    expect(isValidTransferIds([1, null])).toBe(false);
    expect(isValidTransferIds([1, NaN])).toBe(false);
  });
});

describe('validateTransferRows', () => {
  it('accepts a balanced two-sided transfer', () => {
    expect(validateTransferRows([1, 2], [row(1, '-500.00'), row(2, '500.00')])).toBeNull();
  });

  it('accepts a balanced multi-leg transfer', () => {
    // One outflow split across two destination accounts.
    const rows = [row(1, '-500.00'), row(2, '300.00'), row(3, '200.00')];
    expect(validateTransferRows([1, 2, 3], rows)).toBeNull();
  });

  it('reports NOT_FOUND when the DB returned fewer rows than ids requested', () => {
    expect(validateTransferRows([1, 2], [row(1, '-500.00')])?.code).toBe('NOT_FOUND');
  });

  it('reports ALREADY_GROUPED when any transaction is in an existing group', () => {
    const rows = [row(1, '-500.00'), row(2, '500.00', 42)];
    expect(validateTransferRows([1, 2], rows)?.code).toBe('ALREADY_GROUPED');
  });

  it('checks grouping before balance, so the actionable error wins', () => {
    // Both rules are violated; "unlink first" is the one the user can act on.
    const rows = [row(1, '-500.00', 42), row(2, '400.00')];
    expect(validateTransferRows([1, 2], rows)?.code).toBe('ALREADY_GROUPED');
  });

  describe('balance', () => {
    it('rejects amounts that do not net to zero', () => {
      const error = validateTransferRows([1, 2], [row(1, '-500.00'), row(2, '400.00')]);
      expect(error?.code).toBe('UNBALANCED');
      expect(error?.message).toContain('-100.00');
    });

    it('rejects two same-signed amounts even when the magnitudes match', () => {
      expect(validateTransferRows([1, 2], [row(1, '500.00'), row(2, '500.00')])?.code).toBe('UNBALANCED');
    });

    it('tolerates sub-cent float dust within epsilon', () => {
      // Summing numeric strings from Postgres can leave dust below the 0.01 threshold.
      const rows = [row(1, '-0.1'), row(2, '-0.2'), row(3, '0.3')];
      expect(validateTransferRows([1, 2, 3], rows)).toBeNull();
    });

    it('rejects a real one-cent discrepancy just outside epsilon', () => {
      expect(validateTransferRows([1, 2], [row(1, '-500.00'), row(2, '499.98')])?.code).toBe('UNBALANCED');
    });

    it('handles amounts arriving as numbers as well as strings', () => {
      expect(validateTransferRows([1, 2], [row(1, -500), row(2, 500)])).toBeNull();
    });
  });
});

describe('isCounterpart', () => {
  const subject = { amount: 6938.46, date: '2026-09-23' };
  const row = (over: Partial<{ amount: number; transfer_group_id: number | null; date: string }> = {}) =>
    ({ amount: -6938.46, transfer_group_id: null, date: '2026-09-22', ...over });

  it('accepts the exact negation a couple of days either side', () => {
    expect(isCounterpart(row(), subject)).toBe(true);
    expect(isCounterpart(row({ date: '2026-09-24' }), subject)).toBe(true);
    expect(isCounterpart(row({ date: '2026-09-23' }), subject)).toBe(true);
  });

  // THE CENT THAT MUST NOT PAIR. `EPSILON` absorbs the float error of reading a NUMERIC through
  // `pg`; it is not a tolerance for near-misses. Two rows a cent apart are two movements of money,
  // and pairing them would bury that cent in a budget forever.
  it('refuses an amount that is close but not equal', () => {
    expect(isCounterpart(row({ amount: -6938.45 }), subject)).toBe(false);
    expect(isCounterpart(row({ amount: -6938.47 }), subject)).toBe(false);
  });

  it('tolerates only float noise', () => {
    expect(isCounterpart(row({ amount: -6938.46 - 1e-9 }), subject)).toBe(true);
  });

  it('refuses the same sign', () => {
    expect(isCounterpart(row({ amount: 6938.46 }), subject)).toBe(false);
  });

  it('refuses a row already in a group, which the server would reject anyway', () => {
    expect(isCounterpart(row({ transfer_group_id: 168 }), subject)).toBe(false);
  });

  // A standing transfer of the same amount repeats. The window is what stops last fortnight's
  // being offered as this one's other half.
  it('refuses a match outside the window', () => {
    expect(isCounterpart(row({ date: '2026-09-16' }), subject)).toBe(true);   // exactly 7 days
    expect(isCounterpart(row({ date: '2026-09-15' }), subject)).toBe(false);  // 8
    expect(isCounterpart(row({ date: '2026-10-07' }), subject)).toBe(false);
  });

  it('refuses an unparseable date rather than treating it as near', () => {
    expect(isCounterpart(row({ date: 'not-a-date' }), subject)).toBe(false);
  });
});

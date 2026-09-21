import { describe, it, expect } from 'vitest';
import { isValidTransferIds, validateTransferRows, type TransferCandidate } from './transferValidation';

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

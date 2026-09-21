import { describe, it, expect } from 'vitest';
import {
  CONTROL_MODES,
  CONTROL_MODE_LABELS,
  parseControlMode,
  conflictsWithDebtService,
} from './categoryControl';

describe('CONTROL_MODES', () => {
  it('is exactly the set the schema CHECK allows', () => {
    // If this fails, either the constraint changed or this copy drifted from it. Both are bugs,
    // and the failure must be loud here rather than as a 23514 from Postgres at write time.
    expect([...CONTROL_MODES].sort()).toEqual(['discretionary', 'fixed', 'variable-necessary']);
  });

  it('gives every mode a label', () => {
    for (const mode of CONTROL_MODES) {
      expect(CONTROL_MODE_LABELS[mode]).toBeTruthy();
    }
  });
});

describe('parseControlMode', () => {
  it.each([...CONTROL_MODES])('accepts %s unchanged', (mode) => {
    expect(parseControlMode(mode)).toBe(mode);
  });

  describe('rejects rather than falling back to the default', () => {
    // The distinction this suite exists to protect: a rejected value must be distinguishable
    // from 'fixed'. Coercing a typo to the default would write the one value that keeps a
    // category OUT of the scored set, and the write would report success.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty string', ''],
      ['a near miss', 'discretionery'],
      ['a case variant', 'Discretionary'],
      ['a boolean', true],
      ['a number', 0],
      ['an object', { control_mode: 'discretionary' }],
      ['an array of one valid mode', ['discretionary']],
    ])('returns null for %s', (_label, input) => {
      expect(parseControlMode(input)).toBeNull();
    });
  });
});

describe('conflictsWithDebtService', () => {
  it('allows fixed on a debt-service category', () => {
    expect(conflictsWithDebtService('fixed', true)).toBe(false);
  });

  it.each(['discretionary', 'variable-necessary'] as const)(
    'rejects %s on a debt-service category',
    (mode) => {
      expect(conflictsWithDebtService(mode, true)).toBe(true);
    }
  );

  it.each([...CONTROL_MODES])('allows %s when the category is not debt service', (mode) => {
    expect(conflictsWithDebtService(mode, false)).toBe(false);
  });
});

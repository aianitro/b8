import { describe, it, expect } from 'vitest';
import { monthPct, expenseCellStyle, expenseCellText, incomeCellStyle, incomeCellText } from './budgetColors';

// These thresholds are the app's only signal for "is this category in trouble" in the
// monthly grid, and they're shared across the grid and the category detail page — so the
// boundaries are worth pinning before anyone tunes them.

describe('monthPct', () => {
  it('is the spend ratio against the month budget', () => {
    expect(monthPct(50, 100, false)).toBe(0.5);
    expect(monthPct(150, 100, false)).toBe(1.5);
  });

  it('is Infinity for off-cycle spend — activity outside a scheduled window', () => {
    expect(monthPct(50, 0, true)).toBe(Infinity);
    expect(monthPct(0, 100, true)).toBe(Infinity);
  });

  it('is 0 when no budget is configured at all, which stays neutral rather than over', () => {
    expect(monthPct(500, 0, false)).toBe(0);
  });
});

describe('expenseCellStyle', () => {
  it('greys out future months regardless of any other input', () => {
    expect(expenseCellStyle(0, 100, true, false)).toBe('bg-slate-50');
    expect(expenseCellStyle(9999, 100, true, true)).toBe('bg-slate-50');
  });

  it('leaves an untouched month blank', () => {
    expect(expenseCellStyle(0, 100, false, false)).toBe('bg-white');
  });

  describe('threshold boundaries', () => {
    it.each([
      ['well under budget', 25, 'bg-green-50'],
      ['at the 50% boundary', 50, 'bg-green-50'],
      ['just past halfway', 51, 'bg-emerald-50'],
      ['exactly on budget', 100, 'bg-emerald-50'],
      ['just over budget', 101, 'bg-amber-50'],
      ['at the 110% boundary', 110, 'bg-amber-50'],
      ['past 110%', 111, 'bg-red-100'],
    ])('%s renders %s', (_label, spent, expected) => {
      expect(expenseCellStyle(spent, 100, false, false)).toBe(expected);
    });
  });

  it('flags off-cycle spend as over budget', () => {
    expect(expenseCellStyle(10, 0, false, true)).toBe('bg-red-100');
  });

  it('stays neutral for spend in a category with no budget configured', () => {
    // Distinct from off-cycle: no schedule means no expectation to violate.
    expect(expenseCellStyle(500, 0, false, false)).toBe('bg-green-50');
  });
});

describe('expenseCellText', () => {
  it('mutes future and empty months', () => {
    expect(expenseCellText(50, 100, true, false)).toBe('text-slate-300');
    expect(expenseCellText(0, 100, false, false)).toBe('text-slate-300');
  });

  it('escalates emphasis in step with the cell background', () => {
    expect(expenseCellText(50, 100, false, false)).toBe('text-slate-700');
    expect(expenseCellText(105, 100, false, false)).toBe('text-amber-700 font-medium');
    expect(expenseCellText(200, 100, false, false)).toBe('text-red-700 font-semibold');
  });
});

describe('incomeCellStyle', () => {
  it('greys out future months and leaves empty months blank', () => {
    expect(incomeCellStyle(500, 500, true, false)).toBe('bg-slate-50');
    expect(incomeCellStyle(0, 500, false, false)).toBe('bg-white');
  });

  it('treats income received off-cycle as noteworthy, not as a failure', () => {
    // Inverse of the expense case: unexpected income is amber, never red.
    expect(incomeCellStyle(500, 0, false, true)).toBe('bg-amber-50');
  });

  describe('threshold boundaries', () => {
    it.each([
      ['target met exactly', 500, 'bg-emerald-100'],
      ['target exceeded', 600, 'bg-emerald-100'],
      ['at the halfway boundary', 250, 'bg-emerald-50'],
      ['short of halfway', 249, 'bg-amber-50'],
    ])('%s renders %s', (_label, received, expected) => {
      expect(incomeCellStyle(received, 500, false, false)).toBe(expected);
    });
  });

  it('treats any income against no target as fully met', () => {
    expect(incomeCellStyle(100, 0, false, false)).toBe('bg-emerald-100');
  });
});

describe('incomeCellText', () => {
  it('mutes future and empty months, emphasizes everything else', () => {
    expect(incomeCellText(500, true)).toBe('text-slate-300');
    expect(incomeCellText(0, false)).toBe('text-slate-300');
    expect(incomeCellText(500, false)).toBe('text-emerald-700 font-medium');
  });
});

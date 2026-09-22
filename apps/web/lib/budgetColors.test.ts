import { describe, it, expect } from 'vitest';
import { monthPct, expenseCellStyle, expenseCellText, incomeCellStyle, incomeCellText } from './budgetColors';
import { expenseCellState, incomeCellState } from './domain/budgetCellState';

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


// ─── ADDED when the thresholds were split from the class names ────────────────────────────────
//
// `budgetColors.ts` once held both. The phone needed the same grading and Tailwind classes do not
// exist in React Native, so the rule moved to `@b8/contracts/budgetCellState` and this file became
// the web's palette for its answers. The fixtures below pin the MAPPING — every state to the class
// it produced before the split — because that refactor touched rendering code and the tests above
// pin the thresholds rather than the classes.
//
// (They also exist because the first version of this block was written over the file above by
// mistake, destroying it. It was recovered from git; these are additive.)

describe('the state → class mapping, pinned across the split', () => {
  const expenseCases: Array<[string, [number, number, boolean, boolean], string, string]> = [
    ['a future month',       [0, 100, true, false],    'bg-slate-50',   'text-slate-300'],
    ['nothing spent',        [0, 100, false, false],   'bg-white',      'text-slate-300'],
    ['over 110%',            [111, 100, false, false], 'bg-red-100',    'text-red-700 font-semibold'],
    ['just over 100%',       [105, 100, false, false], 'bg-amber-50',   'text-amber-700 font-medium'],
    ['exactly 100%',         [100, 100, false, false], 'bg-emerald-50', 'text-slate-700'],
    ['exactly half',         [50, 100, false, false],  'bg-green-50',   'text-slate-700'],
    ['off-cycle',            [40, 0, false, true],     'bg-red-100',    'text-red-700 font-semibold'],
    ['no budget configured', [40, 0, false, false],    'bg-green-50',   'text-slate-700'],
  ];
  for (const [name, args, bg, text] of expenseCases) {
    it(`expense: ${name}`, () => {
      expect(expenseCellStyle(...args)).toBe(bg);
      expect(expenseCellText(...args)).toBe(text);
    });
  }

  const incomeCases: Array<[string, [number, number, boolean, boolean], string]> = [
    ['a future month',   [0, 100, true, false],    'bg-slate-50'],
    ['nothing received', [0, 100, false, false],   'bg-white'],
    ['off-cycle',        [50, 0, false, true],     'bg-amber-50'],
    ['at target',        [100, 100, false, false], 'bg-emerald-100'],
    ['half',             [50, 100, false, false],  'bg-emerald-50'],
    ['below half',       [20, 100, false, false],  'bg-amber-50'],
    ['no target set',    [500, 0, false, false],   'bg-emerald-100'],
  ];
  for (const [name, args, bg] of incomeCases) {
    it(`income: ${name}`, () => expect(incomeCellStyle(...args)).toBe(bg));
  }
});

describe('the state names themselves, which the phone binds to', () => {
  it('puts 100% on the on-plan side and 100.1% on the watch side', () => {
    expect(expenseCellState(100, 100, false, false)).toBe('on-plan');
    expect(expenseCellState(100.1, 100, false, false)).toBe('watch');
  });

  it('puts 110% on the watch side and 110.1% on the over side', () => {
    expect(expenseCellState(110, 100, false, false)).toBe('watch');
    expect(expenseCellState(110.1, 100, false, false)).toBe('over');
  });

  it('income meets its target at exactly 100%, not above it', () => {
    expect(incomeCellState(100, 100, false, false)).toBe('income-met');
    expect(incomeCellState(99.9, 100, false, false)).toBe('income-part');
  });
});

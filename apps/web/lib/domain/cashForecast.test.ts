import { describe, expect, it } from 'vitest';
import { detectCashSeries, dueDates, projectBalance, type CashTxn } from './cashForecast';

// Fabricated history on one account. Positive is money out, as Plaid signs it.
const monthly = (label: string, amount: number, day: number, months: string[]): CashTxn[] =>
  months.map((m) => ({ date: `${m}-${String(day).padStart(2, '0')}`, amount, label }));
const every = (label: string, amount: number, start: string, gap: number, n: number): CashTxn[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.parse(`${start}T00:00:00Z`) + i * gap * 86_400_000).toISOString().slice(0, 10), amount, label,
  }));

describe('detectCashSeries', () => {
  it('finds a monthly charge and a fortnightly paycheck, and nothing irregular', () => {
    const txns = [
      ...monthly('RENT PAYMENT 0042', 50, 15, ['2026-07', '2026-08', '2026-09']),
      ...every('ACME PAYROLL', -40, '2026-08-07', 14, 5),
      // A card payment whose amount changes every month: not a series.
      ...monthly('CARD AUTOPAY', 10, 20, ['2026-07', '2026-08', '2026-09']).map((t, i) => ({ ...t, amount: [10, 30, 5][i] })),
      // Twice only: not yet believed.
      ...monthly('NEW GYM', 5, 3, ['2026-08', '2026-09']),
    ];
    const s = detectCashSeries(txns, '2026-10-10');
    expect(s.map((x) => [x.key, x.direction, x.cadence, x.amount])).toEqual([
      ['ACME PAYROLL', 'in', 'fortnightly', 40],
      ['RENT PAYMENT', 'out', 'monthly', 50],
    ]);
  });

  it('drops a series that has stopped', () => {
    const txns = monthly('OLD SUB', 5, 1, ['2026-05', '2026-06', '2026-07']);
    expect(detectCashSeries(txns, '2026-10-10')).toEqual([]);
  });
});

describe('dueDates', () => {
  const rent = { key: 'R', label: 'Rent', direction: 'out' as const, cadence: 'monthly' as const, amount: 50, last: '2026-09-15', gap: 30 };
  it('lands a monthly charge on its day of the month, within the horizon only', () => {
    expect(dueDates(rent, '2026-10-10')).toEqual(['2026-10-15']);
    expect(dueDates(rent, '2026-10-01')).toEqual([]);
  });
  it('counts an overdue instalment as tomorrow, within the grace', () => {
    expect(dueDates(rent, '2026-10-17')).toEqual(['2026-10-18']);
  });
  it('clamps a month-end day', () => {
    expect(dueDates({ ...rent, last: '2026-01-31' }, '2026-02-25')).toEqual(['2026-02-28']);
  });
});

describe('projectBalance', () => {
  const rent = { key: 'R', label: 'Rent', direction: 'out' as const, cadence: 'monthly' as const, amount: 50, last: '2026-09-15', gap: 30 };
  const pay = { key: 'P', label: 'Payroll', direction: 'in' as const, cadence: 'fortnightly' as const, amount: 40, last: '2026-10-02', gap: 14 };

  it('reports the low and the charges that drive it', () => {
    expect(projectBalance(30, [rent], '2026-10-10')).toEqual({ low: -20, lowOn: '2026-10-15', charges: [{ label: 'Rent', amount: 50, on: '2026-10-15' }] });
  });

  it('counts a paycheck the day before the charge, but not one landing the same day', () => {
    expect(projectBalance(30, [rent, { ...pay, last: '2026-09-30' }], '2026-10-10').low).toBe(20); // pay lands the 14th
    expect(projectBalance(30, [rent, { ...pay, last: '2026-10-01' }], '2026-10-10').low).toBe(-20); // pay lands the 15th
  });

  it('is the balance today when nothing lowers it', () => {
    expect(projectBalance(30, [pay], '2026-10-10')).toEqual({ low: 30, lowOn: '2026-10-10', charges: [] });
  });
});

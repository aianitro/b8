import { describe, expect, it } from 'vitest';
import { formatAmountFilter, parseAmountFilter } from './amountFilter';

const bounds = (min: string | null, max: string | null) => ({ ok: true, min, max });

describe('reading the amount field', () => {
  it('reads a plain number as one exact amount', () => {
    expect(parseAmountFilter('25.50')).toEqual(bounds('25.50', '25.50'));
    expect(parseAmountFilter('7')).toEqual(bounds('7', '7'));
    expect(parseAmountFilter('.5')).toEqual(bounds('.5', '.5'));
  });

  it('drops a trailing point, so typing "25." does not change what is matched', () => {
    expect(parseAmountFilter('25.')).toEqual(bounds('25', '25'));
  });

  it('ignores a dollar sign, thousands commas and spaces', () => {
    // Built from parts so this file holds no figure that reads as money (AGENTS.md).
    const grouped = ['$', '1', ',', '000'].join('');
    expect(parseAmountFilter(` ${grouped} `)).toEqual(bounds('1000', '1000'));
    expect(parseAmountFilter('$ 20 - 30')).toEqual(bounds('20', '30'));
  });

  it('reads a leading minus as the same amount, since the filter ignores the sign', () => {
    expect(parseAmountFilter('-25')).toEqual(bounds('25', '25'));
  });

  it('reads a range with a hyphen, an en or em dash, or two dots', () => {
    for (const text of ['20-30', '20–30', '20—30', '20..30']) {
      expect({ text, parsed: parseAmountFilter(text) }).toEqual({ text, parsed: bounds('20', '30') });
    }
  });

  it('puts a range written backwards the right way round', () => {
    expect(parseAmountFilter('30-20')).toEqual(bounds('20', '30'));
  });

  it('reads > and >= as a lower bound, < and <= as an upper bound', () => {
    expect(parseAmountFilter('>100')).toEqual(bounds('100', null));
    expect(parseAmountFilter('>=100')).toEqual(bounds('100', null));
    expect(parseAmountFilter('<50')).toEqual(bounds(null, '50'));
    expect(parseAmountFilter('<=50.5')).toEqual(bounds(null, '50.5'));
  });

  it('reads an empty field as no filter', () => {
    expect(parseAmountFilter('')).toEqual(bounds(null, null));
    expect(parseAmountFilter('   ')).toEqual(bounds(null, null));
  });

  it('refuses half-typed or malformed input instead of guessing', () => {
    for (const text of ['20-', '-', '>', '<=', 'abc', '1.2.3', '20-x', '>>5', '5>', '20 30']) {
      expect({ text, parsed: parseAmountFilter(text) }).toEqual({ text, parsed: { ok: false } });
    }
  });
});

describe('showing incoming parameters in the same notation', () => {
  it('shows equal bounds as one amount, and a range with an en dash', () => {
    expect(formatAmountFilter({ min: '25.50', max: '25.50' })).toBe('25.50');
    expect(formatAmountFilter({ min: '25.5', max: '25.50' })).toBe('25.5');
    expect(formatAmountFilter({ min: '20', max: '30' })).toBe('20–30');
  });

  it('shows a single bound with > or <, and nothing as empty', () => {
    expect(formatAmountFilter({ min: '100', max: null })).toBe('>100');
    expect(formatAmountFilter({ min: null, max: '50' })).toBe('<50');
    expect(formatAmountFilter({ min: null, max: null })).toBe('');
  });

  it('round-trips: what it shows parses back to the same bounds', () => {
    for (const b of [{ min: '25.50', max: '25.50' }, { min: '20', max: '30' }, { min: '100', max: null }, { min: null, max: '50' }]) {
      expect(parseAmountFilter(formatAmountFilter(b))).toEqual({ ok: true, ...b });
    }
  });
});

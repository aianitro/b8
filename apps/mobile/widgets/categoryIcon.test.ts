import { describe, expect, it } from 'vitest';
import { categoryIcon } from './categoryIcon';

// Every one of these names is a real category from this ledger. The table is only worth having if
// it covers the categories that actually exist, so the test asserts that rather than asserting the
// regexes it is made of.
const REAL = [
  'Auto insurance', 'Auto service', 'Clothes/Beauty', 'Education', 'Entertainment', 'Gas',
  'Grocery', 'Health', 'Home improvements', 'One time', 'Online services', 'Pets', 'Pocket money',
  'Property Taxes', 'Restoraunts', 'Shared expenses', 'Sport', 'Toys/Gifts/Flowers',
  'Transportation', 'Travel', 'Utilities/Maintenance',
];

describe('categoryIcon', () => {
  it('has a glyph for every category in this ledger, none falling back to a letter', () => {
    for (const name of REAL) {
      const icon = categoryIcon(name);
      expect(icon, `${name} fell through to the letter fallback`).not.toMatch(/^[A-Z]$/);
    }
  });

  // LOAD-BEARING SINCE THE TILES LOST THEIR NAMES. While a glyph was only a fallback for small
  // tiles, two categories sharing one was untidy; now that it is the sole label on every tile, it
  // makes two categories indistinguishable on the map. This fails the moment a new keyword
  // duplicates an existing glyph.
  it('gives every category in this ledger a distinct glyph', () => {
    const byIcon = new Map<string, string[]>();
    for (const name of REAL) {
      const icon = categoryIcon(name);
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), name]);
    }
    const shared = [...byIcon].filter(([, names]) => names.length > 1);
    expect(shared, `these categories share a glyph: ${JSON.stringify(shared)}`).toEqual([]);
  });

  // The ordering rule. "Auto insurance" matches both `insur` and `auto`, and the specific term is
  // listed first; reordering the table silently breaks this and nothing else would notice.
  it('prefers the more specific keyword where two apply', () => {
    expect(categoryIcon('Property Taxes')).not.toBe(categoryIcon('Home improvements'));
    expect(categoryIcon('Home improvements')).not.toBe(categoryIcon('Home insurance'));
  });

  // Vehicle cover is a car rather than a shield — a two-word match that must beat the one-word
  // `insur` rule. Three distinct glyphs, because all three are distinct kinds of spending.
  it('separates vehicle cover, general cover, and servicing', () => {
    const autoCover = categoryIcon('Auto insurance');
    expect(autoCover).not.toBe(categoryIcon('Home insurance'));
    expect(autoCover).not.toBe(categoryIcon('Auto service'));
    expect(categoryIcon('Home insurance')).not.toBe(categoryIcon('Auto service'));
  });

  it('reads vehicle cover the same whichever way round it is written', () => {
    const autoCover = categoryIcon('Auto insurance');
    for (const name of ['Car insurance', 'Insurance - auto', 'Vehicle Insurance', 'Motor insurance']) {
      expect(categoryIcon(name), name).toBe(autoCover);
    }
  });

  // Why keywords rather than a table keyed on the exact name: this ledger's own spelling.
  it('matches a misspelled category the same as the correct spelling', () => {
    expect(categoryIcon('Restoraunts')).toBe(categoryIcon('Restaurants'));
  });

  it('survives renaming, pluralising and case changes', () => {
    expect(categoryIcon('GROCERY')).toBe(categoryIcon('Groceries'));
    expect(categoryIcon('pets')).toBe(categoryIcon('Pet'));
  });

  it('falls back to the first letter for a category it has never heard of', () => {
    expect(categoryIcon('Zorbing')).toBe('Z');
    expect(categoryIcon('  quixotic  ')).toBe('Q');
  });

  // A caller renders the result unconditionally, so it must never be empty.
  it('always returns something', () => {
    for (const name of ['', '   ', 'x', 'Zorbing', 'Grocery']) {
      expect(categoryIcon(name).length).toBeGreaterThan(0);
    }
  });

  // `name[0]` would cut an astral character in half and render a replacement box.
  it('does not split a multi-code-point first character', () => {
    expect(categoryIcon('🏝️ Island fund')).not.toBe('\uD83C');
    expect([...categoryIcon('Ätna')][0]).toBe('Ä');
  });
});

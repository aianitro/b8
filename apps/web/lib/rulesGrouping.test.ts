import { describe, expect, it } from 'vitest';
import { groupRulesByCategory } from './rulesGrouping';

const payee = (merchant_name: string, mapped_category: string | null, count: number) => ({
  merchant_name, mapped_category, count,
});

describe('grouping rules by the category they file into', () => {
  it('groups rows under their category, alphabetically', () => {
    const groups = groupRulesByCategory(
      [payee('Safeway', 'Grocery', 30), payee('Panda Express', 'Restaurants', 40), payee('Tony\'s Pizza', 'Restaurants', 12)],
      (r) => r.count
    );
    expect(groups.map((g) => g.category)).toEqual(['Grocery', 'Restaurants']);
    expect(groups[1].rows.map((r) => r.merchant_name)).toEqual(['Panda Express', "Tony's Pizza"]);
  });

  it('preserves the order the caller supplied within each group', () => {
    // The two callers sort differently inside a group and neither wants this to re-sort them, so
    // the rows must come back exactly as handed over. Deliberately supplied out of count order.
    const groups = groupRulesByCategory(
      [payee('B', 'Grocery', 1), payee('A', 'Grocery', 99), payee('C', 'Grocery', 50)],
      (r) => r.count
    );
    expect(groups[0].rows.map((r) => r.merchant_name)).toEqual(['B', 'A', 'C']);
  });

  it('sums each group with the caller\'s own count accessor', () => {
    const groups = groupRulesByCategory(
      [payee('Safeway', 'Grocery', 30), payee('Co-op', 'Grocery', 12)],
      (r) => r.count
    );
    expect(groups[0].total).toBe(42);
  });

  it('EXCLUDES rows with no category rather than inventing a group for them', () => {
    // The page renders unmapped rows in their own section with a different treatment. Returning them
    // here too would put the same row on screen twice.
    const groups = groupRulesByCategory(
      [payee('Safeway', 'Grocery', 30), payee('Unknown', null, 5), payee('Blank', '   ', 7)],
      (r) => r.count
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('Grocery');
    expect(groups[0].total).toBe(30);
  });

  it('orders case-insensitively, the way a reader scans a list', () => {
    // Byte order would put every capitalised name before every lower-case one, so "dining" would
    // sort after "Zakat". These are owner-written names, not identifiers.
    const groups = groupRulesByCategory(
      [payee('a', 'Zakat', 1), payee('b', 'dining out', 1), payee('c', 'Groceries', 1)],
      (r) => r.count
    );
    expect(groups.map((g) => g.category)).toEqual(['dining out', 'Groceries', 'Zakat']);
  });

  it('returns nothing for an empty list, and for a list with no categories at all', () => {
    expect(groupRulesByCategory([], (r: { count: number }) => r.count)).toEqual([]);
    expect(groupRulesByCategory([payee('x', null, 3)], (r) => r.count)).toEqual([]);
  });

  it('works for the Plaid-category rows too, which carry a different row shape', () => {
    // The whole point of the generic: one grouping, two callers, no second spelling of it.
    const plaid = [
      { plaid_category: 'FOOD_AND_DRINK', count: 120, uncategorized: 0, mapped_category: 'Restaurants' },
      { plaid_category: 'GROCERIES', count: 200, uncategorized: 3, mapped_category: 'Grocery' },
      { plaid_category: 'FAST_FOOD', count: 45, uncategorized: 0, mapped_category: 'Restaurants' },
    ];
    const groups = groupRulesByCategory(plaid, (r) => r.count);
    expect(groups.map((g) => [g.category, g.rows.length, g.total])).toEqual([
      ['Grocery', 1, 200],
      ['Restaurants', 2, 165],
    ]);
  });
});

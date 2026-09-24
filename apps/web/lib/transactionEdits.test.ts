import { describe, expect, it } from 'vitest';
import { GROUP_LABELS, groupCategories, isTransferCategory, type CategoryOption } from './transactionEdits';

// This ledger's own categories and flags, as `budget_categories` holds them. The table is only
// worth testing against the shapes that actually exist — the landscape/exclude combinations here
// are what the picker really has to sort.
const REAL: CategoryOption[] = [
  { name: 'Auto insurance', landscape: 'operational', exclude_from_budget: false },
  { name: 'Grocery', landscape: 'operational', exclude_from_budget: false },
  { name: 'Salary', landscape: 'operational', exclude_from_budget: false },
  { name: 'College', landscape: 'capital', exclude_from_budget: false },
  { name: 'Investment', landscape: 'capital', exclude_from_budget: false },
  // A CATEGORY LITERALLY NAMED "Other", which is why no group may be labelled that.
  { name: 'Other', landscape: 'capital', exclude_from_budget: false },
  { name: 'Transfer', landscape: 'operational', exclude_from_budget: true },
];

const flat = (g: ReturnType<typeof groupCategories>) =>
  [...g.suggested, ...g.operational, ...g.capital, ...g.excluded].map((c) => c.name);

describe('groupCategories', () => {
  // THE BUG THE OWNER REPORTED, pinned. `Transfer` is `exclude_from_budget`, so it sorted into the
  // last group whatever the old boolean did, and sat at the bottom of a 37-item picker.
  it.each([
    'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224',
    'Online Transfer to CHK ...7718 transaction#: 30927102425',
    'AUTOMATIC PAYMENT - THANK',
  ])('puts Transfer first for %s', (description) => {
    expect(flat(groupCategories(REAL, description))[0]).toBe('Transfer');
  });

  // Two of those three descriptions do not contain the word "payment". The rule was `/payment/i`
  // and missed them both; this is the assertion that keeps it widened.
  it('is not satisfied by the word "payment" alone', () => {
    const autopay = groupCategories(REAL, 'CHASE CREDIT CRD AUTOPAY');
    const transfer = groupCategories(REAL, 'Online Transfer to CHK');
    expect(autopay.suggested.map((c) => c.name)).toEqual(['Transfer']);
    expect(transfer.suggested.map((c) => c.name)).toEqual(['Transfer']);
  });

  it('suggests nothing for an ordinary merchant', () => {
    const g = groupCategories(REAL, 'Safeway');
    expect(g.suggested).toEqual([]);
    expect(g.excluded.map((c) => c.name)).toEqual(['Transfer']);
  });

  it('suggests nothing when there is no description at all', () => {
    expect(groupCategories(REAL, null).suggested).toEqual([]);
    expect(groupCategories(REAL).suggested).toEqual([]);
  });

  // A PROMOTED CATEGORY LEAVES ITS GROUP. Two entries for one name is a picker that shows the
  // reader the same choice twice and a count that does not add up.
  it('never lists a category twice', () => {
    const names = flat(groupCategories(REAL, 'AUTOMATIC PAYMENT'));
    expect(new Set(names).size).toBe(names.length);
  });

  // THE GUARD THAT MATTERS MOST HERE, and it failed on the first run. Every group was built by a
  // filter, so a category whose landscape is neither 'operational' nor 'capital' matched none of
  // them and vanished from the picker with nothing raised. The last group is a remainder now, so
  // an unknown landscape is visible and selectable rather than absent.
  it.each([
    ['this ledger', REAL],
    ['a landscape nobody has added yet', [...REAL, { name: 'Trust', landscape: 'fiduciary', exclude_from_budget: false }]],
  ])('loses no category from %s', (_label, input) => {
    const names = flat(groupCategories(input as CategoryOption[], 'Safeway'));
    expect(names.sort()).toEqual((input as CategoryOption[]).map((c) => c.name).sort());
  });

  it('sorts each group by name', () => {
    const g = groupCategories(REAL, 'Safeway');
    expect(g.operational.map((c) => c.name)).toEqual(['Auto insurance', 'Grocery', 'Salary']);
    expect(g.capital.map((c) => c.name)).toEqual(['College', 'Investment', 'Other']);
  });
});

describe('GROUP_LABELS', () => {
  // The collision that made "Transfer is not available" hard to even describe: the group holding
  // it was called "Other", and `Other` is also a real category sitting in Capital.
  it('names no group after a real category', () => {
    const names = new Set(REAL.map((c) => c.name.toLowerCase()));
    for (const label of Object.values(GROUP_LABELS)) {
      expect(names.has(label.toLowerCase()), `group "${label}" shares a name with a category`).toBe(false);
    }
  });
});

describe('isTransferCategory', () => {
  // Narrower than the suggestion pattern: this one decides whether to WARN that a row now owes a
  // pair, and a warning about nothing is worse than a suggestion nobody takes.
  it('is true for the category that creates a half-transfer', () => {
    expect(isTransferCategory('Transfer')).toBe(true);
    expect(isTransferCategory('Internal transfer')).toBe(true);
  });

  it('does not fire on the words that merely SUGGEST a transfer', () => {
    // These match TRANSFERISH so they surface Transfer in the picker. None of them is a category
    // whose selection owes a pair.
    expect(isTransferCategory('Mortgage Gastonia')).toBe(false);
    expect(isTransferCategory('Income tax')).toBe(false);
    expect(isTransferCategory(null)).toBe(false);
  });
});

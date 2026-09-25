import { describe, expect, it } from 'vitest';
import { ruleFor, type CategoryRule } from './categoryRules';

const merchantRule = (merchantName: string, mappedCategory: string): CategoryRule =>
  ({ merchantName, plaidCategory: null, mappedCategory });
const categoryRule = (plaidCategory: string, mappedCategory: string): CategoryRule =>
  ({ plaidCategory, merchantName: null, mappedCategory });

const pandaExpress = { merchantName: 'Panda Express', plaidCategory: 'FOOD_AND_DRINK' };
const safeway = { merchantName: 'Safeway', plaidCategory: 'FOOD_AND_DRINK' };

describe('ruleFor', () => {
  it('files nothing when no rule matches', () => {
    expect(ruleFor(pandaExpress, [])).toBeNull();
    expect(ruleFor(pandaExpress, [merchantRule('Chipotle', 'Restoraunts')])).toBeNull();
  });

  it('files by merchant', () => {
    expect(ruleFor(pandaExpress, [merchantRule('Panda Express', 'Restoraunts')])).toBe('Restoraunts');
  });

  it('files by plaid category', () => {
    expect(ruleFor(safeway, [categoryRule('FOOD_AND_DRINK', 'Grocery')])).toBe('Grocery');
  });

  // THE ORDERING THIS MODULE EXISTS FOR. The broad rule must not swallow the payee exception —
  // that is the failure that filed 152 restaurant charges as groceries.
  it.each([
    ['merchant rule first', [merchantRule('Panda Express', 'Restoraunts'), categoryRule('FOOD_AND_DRINK', 'Grocery')]],
    ['category rule first', [categoryRule('FOOD_AND_DRINK', 'Grocery'), merchantRule('Panda Express', 'Restoraunts')]],
  ])('prefers the merchant rule whatever the array order (%s)', (_label, rules) => {
    expect(ruleFor(pandaExpress, rules as CategoryRule[])).toBe('Restoraunts');
    // ...and the broad rule still files everything it is the only claimant for.
    expect(ruleFor(safeway, rules as CategoryRule[])).toBe('Grocery');
  });

  it('matches a merchant case- and whitespace-insensitively', () => {
    const rules = [merchantRule('panda express', 'Restoraunts')];
    expect(ruleFor({ merchantName: 'PANDA EXPRESS', plaidCategory: null }, rules)).toBe('Restoraunts');
    expect(ruleFor({ merchantName: '  Panda Express  ', plaidCategory: null }, rules)).toBe('Restoraunts');
  });

  // NEVER A SUBSTRING. A rule for "Tony's" claiming "Tony's Auto Body" would turn a car repair into
  // a restaurant with nothing on screen to explain it.
  it('does not match a merchant by prefix or containment', () => {
    const rules = [merchantRule("Tony's", 'Restoraunts')];
    expect(ruleFor({ merchantName: "Tony's Auto Body", plaidCategory: null }, rules)).toBeNull();
    expect(ruleFor({ merchantName: 'Tony', plaidCategory: null }, rules)).toBeNull();
  });

  // A transfer or a manual import may have no merchant at all. A merchant rule must not claim it,
  // and two rows that both lack one must not be treated as the same payee.
  it('never matches a null merchant', () => {
    const rules = [merchantRule('Panda Express', 'Restoraunts')];
    expect(ruleFor({ merchantName: null, plaidCategory: 'FOOD_AND_DRINK' }, rules)).toBeNull();
    expect(ruleFor({ merchantName: null, plaidCategory: null }, [{ merchantName: null, plaidCategory: null, mappedCategory: 'X' }])).toBeNull();
  });

  it('never matches a null plaid category', () => {
    expect(ruleFor({ merchantName: 'X', plaidCategory: null }, [categoryRule('FOOD_AND_DRINK', 'Grocery')])).toBeNull();
  });
});

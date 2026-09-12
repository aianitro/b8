// Fixtures for the seven object shapes. Every payload below is a WIRE value — the JSON a handler
// produces after `Response.json(...)`, which is the boundary shapes.ts says it describes — so:
//
//   * scalar NUMERIC money is a numeric STRING (`'1200.00'`), because `pg` returns OID 1700 as
//     text and `JSON.stringify` passes a string through untouched;
//   * NUMERIC[] elements are JS NUMBERS (`80`), because `pg` registers the array parser separately
//     and it does convert. The two rules are asymmetric and measured (representation.ts), and half
//     the fixtures here exist to hold each side of that split in place;
//   * timestamps and dates are ISO-8601 STRINGS, never `Date` objects. `pg` hands a handler a
//     `Date`; it is `Response.json` that serializes it, and these schemas sit after that step.
//
// Every figure, id, and name is fabricated. Nothing here came out of a real account.
//
// Negative fixtures assert the issue PATH, not merely that parsing failed. A row missing
// `control_mode` and a row with a typo'd `landscape` both "fail to parse", and a test that only
// checks `success === false` passes for either reason — including for a reason that has nothing to
// do with the rule its title claims. The path is what makes the assertion's subject the title's
// subject.
//
// F12 (the BudgetCategory field-set control) lives in index.test.ts rather than here: it asserts a
// correspondence with `shared/types.ts`'s own declaration, which it reads from that file's AST, and
// index.test.ts is where that parse already lives. Splitting it out beat duplicating the parser,
// and importing one test file from another would re-register its suites and run every fixture twice.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AccountSchema,
  BudgetCategorySchema,
  BudgetSummarySchema,
  CategoryRuleSchema,
  LinkedAccountSummarySchema,
  PropertySchema,
  TransactionSchema,
} from './shapes';

/** The dotted path of every issue a rejection produced; `[]` when the payload parsed. */
function issuePathsOf(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

/** A `budget_categories` row exactly as `GET /api/categories` puts it on the wire. */
const budgetCategoryWireRow = {
  id: 7,
  name: 'Groceries',
  annual_budget: '1200.00',
  landscape: 'operational',
  exclude_from_budget: false,
  is_income: false,
  control_mode: 'variable-necessary',
  dedicated_account_id: null,
  monthly_amounts: null,
  created_at: '2026-01-15T00:00:00.000Z',
};

/** A custom schedule that spends unevenly and still totals `annual_budget`: 1200.00. */
const monthlySchedule = [80, 80, 100, 100, 100, 100, 120, 120, 100, 100, 100, 100];

describe('BudgetCategorySchema', () => {
  it('a BudgetCategory row exactly as Postgres and the existing GET /api/categories handler produce it, with annual_budget as the numeric string 1200.00 rather than a JS number, parses successfully', () => {
    const parsed = BudgetCategorySchema.parse(budgetCategoryWireRow);

    // The flagship claim, in both halves. The string parses and survives untouched — the schema is
    // a validator, not a computation, so it neither re-rounds nor reformats the figure...
    expect(parsed.annual_budget).toBe('1200.00');
    expect(parsed).toEqual(budgetCategoryWireRow);

    // ...and the representation a fixture author reaches for by habit, a JS number, is refused. A
    // schema written as `z.number()` would pass every hand-authored fixture and reject every real
    // response from this route, which is the first failure mode SPEC.md lists.
    expect(
      issuePathsOf(BudgetCategorySchema, { ...budgetCategoryWireRow, annual_budget: 1200 })
    ).toEqual(['annual_budget']);
  });

  it('annual_budget as the non-numeric string abc is rejected rather than silently coerced', () => {
    // "Rather than silently coerced" is the load-bearing half: a `z.coerce.number()` here would
    // have SUCCEEDED on 'abc' and yielded NaN, which then renders as "NaN" on the budget page. A
    // rejection at the boundary is the only outcome that keeps the garbage out.
    expect(
      issuePathsOf(BudgetCategorySchema, { ...budgetCategoryWireRow, annual_budget: 'abc' })
    ).toEqual(['annual_budget']);
  });

  it('control_mode accepts all three CHECK-constrained values: fixed, discretionary, and variable-necessary', () => {
    // One `it` rather than `it.each`, because SPEC.md's acceptance command greps for this exact
    // title and `it.each` would emit three interpolated variants of it instead.
    for (const mode of ['fixed', 'discretionary', 'variable-necessary']) {
      const parsed = BudgetCategorySchema.parse({ ...budgetCategoryWireRow, control_mode: mode });
      expect(parsed.control_mode).toBe(mode);
    }
  });

  it('control_mode rejects variable, the truncated value an implementer reaching for the CHECK constraint from memory could plausibly type instead of variable-necessary', () => {
    // The derivation-source control. 'variable' is what a schema transcribed from memory or from a
    // UI label looks like; the CHECK constraint says 'variable-necessary'. Admitting it would put a
    // category outside every scored set — invisible to the guardrail rather than loudly wrong.
    expect(
      issuePathsOf(BudgetCategorySchema, { ...budgetCategoryWireRow, control_mode: 'variable' })
    ).toEqual(['control_mode']);
  });

  it('control_mode is required and non-nullable, so a row with control_mode explicitly null is rejected exactly as the NOT NULL column would refuse it', () => {
    // The repo's one stated exception to "nullable means unknown": a missing valuation is genuinely
    // unknown, a category's control mode is at worst mis-decided, never absent.
    expect(
      issuePathsOf(BudgetCategorySchema, { ...budgetCategoryWireRow, control_mode: null })
    ).toEqual(['control_mode']);
  });

  it('a row missing the control_mode key entirely is rejected, because every real row carries the column', () => {
    const { control_mode: _control_mode, ...withoutControlMode } = budgetCategoryWireRow;
    expect(issuePathsOf(BudgetCategorySchema, withoutControlMode)).toEqual(['control_mode']);
  });

  it('dedicated_account_id null is accepted, because the column is genuinely nullable and every real row carries the key', () => {
    const parsed = BudgetCategorySchema.parse({
      ...budgetCategoryWireRow,
      dedicated_account_id: null,
    });
    // Null stays null: not defaulted to an empty string, not dropped from the output.
    expect(parsed.dedicated_account_id).toBeNull();
    expect(Object.keys(parsed)).toContain('dedicated_account_id');

    // And the populated case still parses, so the acceptance above is not a nullable field that
    // happens to accept nothing else.
    expect(
      BudgetCategorySchema.parse({ ...budgetCategoryWireRow, dedicated_account_id: 'manual_7f1c' })
        .dedicated_account_id
    ).toBe('manual_7f1c');
  });

  it('a row missing the dedicated_account_id key entirely is rejected, because Postgres never omits a selected column', () => {
    // `.nullable()` and `.optional()` are not interchangeable. Modelled `.optional()`, this and the
    // fixture above would BOTH pass, and "this category tracks no pool of money" would be
    // indistinguishable from "a key went missing somewhere upstream" — the first renders "—", the
    // second is a bug, and they need different responses.
    const { dedicated_account_id: _dedicated, ...withoutDedicatedAccount } = budgetCategoryWireRow;
    expect(issuePathsOf(BudgetCategorySchema, withoutDedicatedAccount)).toEqual([
      'dedicated_account_id',
    ]);
  });

  it('monthly_amounts null is accepted as the no-custom-schedule case', () => {
    const parsed = BudgetCategorySchema.parse({ ...budgetCategoryWireRow, monthly_amounts: null });
    // Null here means "spread annual_budget evenly across twelve months" — a real state with a real
    // meaning, and emphatically not twelve zeroes.
    expect(parsed.monthly_amounts).toBeNull();
    expect(Object.keys(parsed)).toContain('monthly_amounts');
  });

  it("a twelve-element monthly_amounts array of JS numbers, the representation pg's array parser actually produces, is accepted", () => {
    const parsed = BudgetCategorySchema.parse({
      ...budgetCategoryWireRow,
      monthly_amounts: monthlySchedule,
    });
    expect(parsed.monthly_amounts).toEqual(monthlySchedule);
    expect(parsed.monthly_amounts?.every((amount) => typeof amount === 'number')).toBe(true);
  });

  it("a twelve-element monthly_amounts array of numeric strings, which pg's array parser never produces, is rejected", () => {
    // The reverse control for the parser asymmetry. `monthlySchedule.map(toFixed(2))` is precisely
    // what applying the scalar money rule to the array case "for consistency" produces, and a
    // schema built that way rejects every category that carries a custom schedule. Each of the
    // twelve elements is refused, by its own index, so the failure is the elements and not the
    // field being absent or the array being the wrong length.
    expect(
      issuePathsOf(BudgetCategorySchema, {
        ...budgetCategoryWireRow,
        monthly_amounts: monthlySchedule.map((amount) => amount.toFixed(2)),
      })
    ).toEqual([
      'monthly_amounts.0',
      'monthly_amounts.1',
      'monthly_amounts.2',
      'monthly_amounts.3',
      'monthly_amounts.4',
      'monthly_amounts.5',
      'monthly_amounts.6',
      'monthly_amounts.7',
      'monthly_amounts.8',
      'monthly_amounts.9',
      'monthly_amounts.10',
      'monthly_amounts.11',
    ]);
  });
});

describe('PropertySchema', () => {
  it('purchase_price and cost_basis accept a numeric string or null, the same Postgres NUMERIC representation as annual_budget', () => {
    const valued = {
      id: 3,
      nickname: 'Maple Duplex',
      address: '12 Fabricated Way',
      type: 'rental',
      purchase_price: '450000.00',
      purchase_date: '2019-06-01',
      cost_basis: '462500.00',
    };
    expect(PropertySchema.parse(valued)).toEqual(valued);

    // Null on either is UNKNOWN, and it renders "—". A property tracked without a purchase price is
    // not a property that cost zero.
    const unvalued = { ...valued, purchase_price: null, purchase_date: null, cost_basis: null };
    expect(PropertySchema.parse(unvalued)).toEqual(unvalued);

    // "The same representation as annual_budget" is a claim with a falsifiable half: a JS number is
    // refused on both fields, exactly as it is on annual_budget above.
    expect(issuePathsOf(PropertySchema, { ...valued, purchase_price: 450000 })).toEqual([
      'purchase_price',
    ]);
    expect(issuePathsOf(PropertySchema, { ...valued, cost_basis: 462500 })).toEqual(['cost_basis']);
  });
});

/** A `transactions` row on the wire. `amount` is fabricated, as is every identifier. */
const transactionWireRow = {
  id: 4102,
  plaid_transaction_id: 'txn_fabricated_0001',
  date: '2026-02-03',
  amount: '128.45',
  name: 'CORNER MARKET 118',
  merchant_name: 'Corner Market',
  plaid_category: 'Food and Drink',
  mapped_category: 'Groceries',
  rule_applied: true,
  account_id: 'manual_7f1c',
  hidden: false,
  created_at: '2026-02-04T02:15:00.000Z',
};

describe('TransactionSchema', () => {
  it("a transaction amount of a negative numeric string is accepted, because income is negative under this ledger's Plaid-derived sign convention", () => {
    // A `.positive()` slipped in here would reject every income row in the ledger. The sign is not
    // a validity question at this boundary; it is the convention's carrier.
    const income = { ...transactionWireRow, amount: '-3410.00', mapped_category: 'Rental Income' };
    expect(TransactionSchema.parse(income).amount).toBe('-3410.00');
  });

  it('a transaction amount of a positive numeric string is accepted, because spend is positive under the same convention', () => {
    expect(TransactionSchema.parse(transactionWireRow).amount).toBe('128.45');
    // Both signs, one schema, and neither is normalized away: the string arrives as the string.
    expect(TransactionSchema.parse({ ...transactionWireRow, amount: '-3410.00' }).amount).toBe(
      '-3410.00'
    );
  });

  it('merchant_name null is accepted and a row missing the merchant_name key entirely is rejected', () => {
    // Plaid supplies a merchant name or it does not, and null is the "it did not" case — required
    // and nullable, the same nullable-never-optional rule as dedicated_account_id.
    const parsed = TransactionSchema.parse({ ...transactionWireRow, merchant_name: null });
    expect(parsed.merchant_name).toBeNull();

    const { merchant_name: _merchantName, ...withoutMerchantName } = transactionWireRow;
    expect(issuePathsOf(TransactionSchema, withoutMerchantName)).toEqual(['merchant_name']);
  });
});

describe('CategoryRuleSchema', () => {
  it('a canonical CategoryRule fixture parses', () => {
    const rule = {
      id: 12,
      plaid_category: 'Food and Drink',
      mapped_category: 'Groceries',
      created_at: '2026-01-02T14:45:00.000Z',
    };
    expect(CategoryRuleSchema.parse(rule)).toEqual(rule);
    // Neither name is a foreign key and the schema does not pretend otherwise: `mapped_category` is
    // matched on name within a landscape at query time, so a rule may legitimately name a category
    // that does not exist yet.
    expect(CategoryRuleSchema.parse({ ...rule, mapped_category: 'Not Yet Created' })).toEqual({
      ...rule,
      mapped_category: 'Not Yet Created',
    });
  });
});

describe('BudgetSummarySchema', () => {
  it('a canonical BudgetSummary fixture with numeric-string money fields parses', () => {
    // All four money fields reach the boundary as text for four slightly different reasons —
    // a NUMERIC column, a COALESCE(SUM(...)), a NUMERIC subtraction, and a ROUND(.../12, 2) — and
    // `pg` returns every one of them as a string.
    const summary = {
      category: 'Groceries',
      annual_budget: '1200.00',
      ytd_spent: '318.27',
      remaining: '881.73',
      monthly_reference: '100.00',
    };
    expect(BudgetSummarySchema.parse(summary)).toEqual(summary);

    // Over-spend is the case the page colours red; a sign restriction on `remaining` would reject
    // exactly the rows a budget exists to surface.
    expect(BudgetSummarySchema.parse({ ...summary, ytd_spent: '1450.00', remaining: '-250.00' })
      .remaining).toBe('-250.00');
  });
});

describe('LinkedAccountSummarySchema', () => {
  it('a canonical LinkedAccountSummary fixture with null mask and null subtype parses', () => {
    // The only contracted shape with no money field: it is assembled in TypeScript from Plaid's
    // response, where `a.subtype ?? null` and `a.mask ?? null` mean "Plaid did not tell us" — the
    // key is always present, and null is an answer rather than an omission.
    const linked = {
      id: 'plaid_acct_fabricated_1',
      name: 'Everyday Checking',
      type: 'depository',
      subtype: null,
      mask: null,
    };
    const parsed = LinkedAccountSummarySchema.parse(linked);
    expect(parsed).toEqual(linked);
    expect(parsed.subtype).toBeNull();
    expect(parsed.mask).toBeNull();
  });
});

describe('AccountSchema', () => {
  it('a canonical Account row carries all twelve declared keys, including the null property_id of an account secured against no property, and parses', () => {
    // Not one of SPEC.md's 28 named fixtures, but `Account` is a contracted shape and an untested
    // schema is an unverified one. `property_id: null` here means "secured against no property",
    // which is most accounts — NOT the inheriting null of `transactions.property_id`, which this
    // type does not expose.
    const account = {
      id: 'manual_7f1c',
      name: 'Everyday Checking',
      type: 'depository',
      subtype: 'checking',
      landscape: 'operational',
      track_transactions: true,
      bank: 'Fabricated Mutual',
      is_manual: true,
      last_synced_at: null,
      valuation_mode: 'ledger',
      is_liability: false,
      property_id: null,
    };
    expect(AccountSchema.parse(account)).toEqual(account);
    expect(Object.keys(AccountSchema.shape)).toHaveLength(12);

    // `type` is open on purpose — `accounts.type` carries no CHECK, and closing the vocabulary would
    // make the first unrecognized Plaid type a validation failure instead of a rendered row.
    expect(AccountSchema.parse({ ...account, type: 'a-type-plaid-invents-next-year' }).type).toBe(
      'a-type-plaid-invents-next-year'
    );
  });
});

// Which rule files a transaction, and which rule wins when two could.
//
// Pure: rules in, category out. The I/O shells — `lib/sync.ts` on arrival and
// `/api/v1/rules/apply` retroactively — both call this, so a row filed at sync time and the same
// row re-filed later cannot disagree about what the rules say.

export interface CategoryRule {
  /** Set on a category rule, null on a merchant rule. Exactly one of the two is set. */
  plaidCategory: string | null;
  /** Set on a merchant rule, null on a category rule. */
  merchantName: string | null;
  mappedCategory: string;
}

export interface RuleSubject {
  plaidCategory: string | null;
  merchantName: string | null;
}

/**
 * Case-insensitive, and EXACT — never a substring.
 *
 * Substring matching is the tempting version and it is a trap: a rule for "Tony's" would also claim
 * "Tony's Auto Body", and the owner would have no way to see why a car repair became a restaurant
 * except by re-reading every rule. An exact payee is a thing the UI can name back — "always file
 * Panda Express here" — and a promise it can keep literally.
 *
 * The cost is real and worth stating: a merchant that arrives under two spellings needs two rules.
 * That is visible and fixable; a substring rule quietly over-reaching is neither.
 */
const sameMerchant = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The category a rule assigns to this transaction, or null when no rule matches.
 *
 * ─── MERCHANT BEATS CATEGORY, and the ordering is the whole point of this function ────────────
 *
 * A merchant rule is a statement about one payee; a category rule is a statement about a whole
 * taxonomy bucket. The specific one wins, which is the only ordering under which "Panda Express is
 * always Restoraunts" survives the owner later adding a rule for FOOD_AND_DRINK. Under the other
 * ordering the broad rule would silently swallow every payee exception, which is exactly the
 * failure that produced 152 restaurant charges filed as groceries.
 *
 * Ties within a kind cannot happen: the table holds at most one rule per merchant and one per
 * category, enforced by unique indexes rather than by ordering here.
 */
export function ruleFor(subject: RuleSubject, rules: CategoryRule[]): string | null {
  for (const rule of rules) {
    if (rule.merchantName !== null && sameMerchant(rule.merchantName, subject.merchantName)) {
      return rule.mappedCategory;
    }
  }
  for (const rule of rules) {
    if (rule.plaidCategory !== null && rule.plaidCategory === subject.plaidCategory) {
      return rule.mappedCategory;
    }
  }
  return null;
}

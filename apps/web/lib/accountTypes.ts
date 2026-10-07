export const ACCOUNT_TYPES = [
  { label: 'Checking',         type: 'depository', subtype: 'checking'    },
  { label: 'Savings',          type: 'depository', subtype: 'savings'      },
  { label: 'Credit Card',      type: 'credit',     subtype: 'credit card'  },
  { label: 'Brokerage',        type: 'investment', subtype: 'brokerage'     },
  { label: 'Loan / Mortgage',  type: 'loan',       subtype: null           },
  { label: 'Cash',             type: 'cash',       subtype: null           },
  { label: 'Other',            type: 'other',      subtype: null           },
] as const;

// Not a Plaid type — a feed never reports one. It is money held in hand, so it has no bank, and
// the forms hide that field for it rather than ask a question with no answer.
export const CASH_TYPE = 'cash';

// Falls back to capitalizing whatever Plaid/the DB actually has when it doesn't match one
// of our canonical options (e.g. a Plaid-synced subtype like "money market" or "ira").
export function accountTypeLabel(type: string, subtype: string | null): string {
  const match = ACCOUNT_TYPES.find((t) =>
    subtype ? t.subtype === subtype : t.type === type && t.subtype === null
  );
  if (match) return match.label;
  const raw = subtype ?? type;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

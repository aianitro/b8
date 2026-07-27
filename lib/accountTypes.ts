export const ACCOUNT_TYPES = [
  { label: 'Checking',         type: 'depository', subtype: 'checking'    },
  { label: 'Savings',          type: 'depository', subtype: 'savings'      },
  { label: 'Credit Card',      type: 'credit',     subtype: 'credit card'  },
  { label: 'Brokerage',        type: 'investment', subtype: 'brokerage'     },
  { label: 'Loan / Mortgage',  type: 'loan',       subtype: null           },
  { label: 'Other',            type: 'other',      subtype: null           },
] as const;

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

// Per-property equity (ROADMAP.md Phase 0 step 5): a property's own market value lives in
// property_valuations, while the mortgage secured against it is an ordinary valuation-mode
// liability account (lib/domain/valuation.ts) linked via accounts.property_id. Equity is
// computed by joining the two, not stored anywhere — same "derived read, never a stored
// column" stance as latestValuationByAccount.
//
// latestValuationByProperty below duplicates latestValuationByAccount's "pick the newest row"
// logic rather than sharing it. Deliberate for now: this module and valuation.ts are being
// developed on separate, not-yet-merged branches, and a shared generic helper would create a
// cross-branch dependency neither one currently has. Worth consolidating once both land on
// main — small enough that leaving a fork here is cheaper than coordinating an interface
// through two Phase 0 branches for a ~10-line function.

export interface Property {
  id: number;
  nickname: string;
}

export interface PropertyValuationRow {
  propertyId: number;
  value: number;
  valuedAt: Date | string;
}

export function latestValuationByProperty(rows: PropertyValuationRow[]): Map<number, number> {
  const latest = new Map<number, { value: number; valuedAtMs: number }>();
  for (const row of rows) {
    const valuedAtMs = new Date(row.valuedAt).getTime();
    const existing = latest.get(row.propertyId);
    if (!existing || valuedAtMs > existing.valuedAtMs) {
      latest.set(row.propertyId, { value: row.value, valuedAtMs });
    }
  }
  return new Map([...latest].map(([propertyId, v]) => [propertyId, v.value]));
}

export interface PropertyEquity {
  propertyId: number;
  nickname: string;
  value: number | null; // null: never valued — equity is unknowable, not zero
  mortgageBalance: number; // 0 when no mortgage is linked
  equity: number | null;
}

/**
 * mortgageBalanceByProperty is already the *latest* balance per property — one property could
 * in principle have more than one linked liability account, so the caller sums before this
 * function sees it rather than this function guessing how to combine multiple accounts.
 */
export function computePropertyEquity(
  properties: Property[],
  latestPropertyValuations: Map<number, number>,
  mortgageBalanceByProperty: Map<number, number>
): PropertyEquity[] {
  return properties.map((p) => {
    const value = latestPropertyValuations.get(p.id) ?? null;
    const mortgageBalance = mortgageBalanceByProperty.get(p.id) ?? 0;
    return {
      propertyId: p.id,
      nickname: p.nickname,
      value,
      mortgageBalance,
      equity: value === null ? null : value - mortgageBalance,
    };
  });
}

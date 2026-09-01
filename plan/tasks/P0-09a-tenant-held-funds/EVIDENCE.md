# EVIDENCE — P0-09a-tenant-held-funds
**Author:** implementer · **Run:** 2026-08-27, this working tree, `--pool=threads` throughout.

## Headline, stated before the detail

Ten of the eleven acceptance commands produce exactly the expected value. **Acceptance #2 does
not**: it expects `290 passed` and produces `298 passed / 18 files`. That is not a red suite —
nothing fails — but the number is not the specced one, and the reason is recorded in full under
"Acceptance #2" below with the discriminating commands that isolate it. In short: my work adds
exactly the 8 tests the SPEC asks for (netWorth.test.ts 19 → 25, property.test.ts 22 → 24), and
the tree's pre-existing count had already moved from the recorded 282 baseline to 290 before I
touched anything, in a file outside this task's scope. I did not adjust anything to reach a
number.

---

## Acceptance commands, verbatim

### #1 — `npx tsc --noEmit`
Expected: exit 0.

```
$ npx tsc --noEmit; echo "exit code: $?"
exit code: 0
```

No output, exit 0. The two pre-existing duplicate-`.d.ts` errors recorded in `GATES.md` are gone
(PD-1 retired them by clearing the build cache), so this is a clean 0 with nothing to diff
against a baseline.

### #2 — `npm test -- --pool=threads`
Expected: `290 passed`, 18 files. **Measured: `298 passed`, 18 files.**

```
$ npm test -- --pool=threads

> app@0.1.0 test
> vitest run --pool=threads


 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app


 Test Files  18 passed (18)
      Tests  298 passed (298)
   Start at  19:00:09
   Duration  4.37s (transform 347ms, setup 0ms, import 618ms, tests 4.26s, environment 1ms)
```

**Where the 8-test difference lives, established by command rather than by argument.**

The suite's 18 files are 17 tracked `lib/**` files plus one untracked file,
`.claude/hooks/scope-guard.test.mts`, which `vitest.config.mts` began including as part of build-
system fix PD-1 (`GATES.md`). Splitting the run along that line:

```
$ npx vitest run --pool=threads lib shared
 Test Files  17 passed (17)
      Tests  262 passed (262)

$ npx vitest run --pool=threads .claude/hooks
 Test Files  1 passed (1)
      Tests  36 passed (36)
```

262 + 36 = 298. My contribution to the 262 is exactly 8, counted directly against HEAD:

```
$ for f in lib/domain/netWorth.test.ts lib/domain/property.test.ts; do
    echo "$f: HEAD=$(git show HEAD:$f | grep -c "^\s*it(") NOW=$(grep -c "^\s*it(" $f)"
  done
lib/domain/netWorth.test.ts: HEAD=19 NOW=25
lib/domain/property.test.ts: HEAD=22 NOW=24
```

+6 and +2, matching the SPEC's 6-in-netWorth / 2-in-property split, and `git status --short`
shows no other test file modified by me. So the tree's pre-my-work total was 298 − 8 = **290**,
against a recorded baseline of **282**. The missing 8 are in the hook test file: `GATES.md`'s
PD-1 entry, written *after* the 282 measurement, records "36/36 in
`.claude/hooks/scope-guard.test.mts`" and describes adding the multi-line heredoc cases that its
first fix attempt failed. 254 lib + 28 hook = 282 at baseline; 254 + 36 = 290 before my change.

**I did not touch `.claude/hooks/**` or `vitest.config.mts`** (the latter was already modified in
this tree when the task opened). Reaching a literal `290` would require deleting 8 tests from a
working guard that is outside this task's scope, which would be tampering with the evidence base
rather than satisfying it. Recorded here for the orchestrator to adjudicate: the arithmetic the
SPEC intended (baseline + 8, in the two named files, file count unchanged) holds exactly; the
constant it was written against moved underneath it.

### #3 — deposit reduces liabilities and total only
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "reduces liabilities and total by a recorded security deposit, leaving the other three components unchanged"
1
```

### #4 — last-month holding moves nothing
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "does not change any component or the total for a recorded last-month-rent-held amount"
1
```

### #5 — components still sum to total
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "still sums components to total exactly with a security deposit and a last-month holding both present"
1
```

### #6 — per-property, not portfolio-wide
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "only the property carrying a security deposit contributes to liabilities, not a property with none"
1
```

### #7 — contributions sum to the component total
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "sums liabilities contributions to the liabilities total when a security deposit is present"
1
```

### #8 — deposit survives an unvalued property, unlike its mortgage
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/netWorth.test.ts | grep -cF "still subtracts a security deposit from liabilities when its property has no recorded valuation, unlike its linked mortgage which is dropped together with the unvalued property"
1
```

### #9 — deposit: never recorded ≠ recorded zero
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/property.test.ts | grep -cF "resolves a security deposit to null when never recorded, distinct from an explicit zero"
1
```

### #10 — last-month: never recorded ≠ recorded zero
```
$ npx vitest run --pool=threads --reporter=verbose lib/domain/property.test.ts | grep -cF "resolves a last-month-rent-held amount to null when never recorded, distinct from an explicit zero"
1
```

### #11 — the liabilities caption mentions a deposit
Expected: ≥ 1 (`0` on the untouched tree).
```
$ grep -A3 "key: 'liabilities'" app/net-worth/page.tsx | grep -ic deposit
1
```

---

## The `app/net-worth/page.tsx` edit — one line, quoted verbatim

Post-edit `hint` string, exactly:

```
Unsecured loans and tenant deposits held
```

`label` is **unchanged** (`'Other debt'` — a held deposit is a form of debt, so the label was
never false), and `href` is **unchanged** (`'/accounts'`, deliberately, per the SPEC's stated
reasoning). The whole diff for the file is one line replaced by one line:

```
$ git diff --numstat app/net-worth/page.tsx
1	1	app/net-worth/page.tsx

$ git diff app/net-worth/page.tsx
-  { key: 'liabilities', label: 'Other debt', href: '/accounts', hint: 'Loans not secured against a property', accent: 'bg-red-500' },
+  { key: 'liabilities', label: 'Other debt', href: '/accounts', hint: 'Unsecured loans and tenant deposits held', accent: 'bg-red-500' },
```

No other line in that file changed — not the generic per-line `kind`/`id` resolution, not the
layout, not any other component's metadata. (An explanatory comment above the entry was written
and then removed: the SPEC authorizes exactly one text edit here, the neighbouring entries carry
no comments, and the reasoning is already recorded in `db/schema.sql` and in this file.)

---

## Fabricated four-property fixture

**Every figure below is invented.** No real deposit, rent, balance, or valuation appears in this
file, in the tests, or in the code. The rows were run through the real
`computeNetWorthBreakdown` / `resolveTenantHeldFunds` in a throwaway test file
(`lib/domain/__fixture-probe.test.ts`), whose output is reproduced verbatim below; the file was
then deleted (`git status --short lib/domain` shows only the four intended modifications).

Portfolio: one operational ledger account `trust-chk` at **$12,000**; mortgage `mtgA` **$310,000**
linked to property 1; mortgage `mtgD` **$180,000** linked to property 9.

| Property | Valuation | Mortgage | Deposit entered | Last-month entered | Deposit displays | Last-month displays | Contribution emitted (`liabilities`) |
|---|---|---|---|---|---|---|---|
| A (id 1) | $450,000 | $310,000 | $2,500 | $1,800 | `$2,500` | `$1,800` | `{kind:'property', id:'1', value:-2500, propertyId:null}` |
| B (id 2) | $250,000 | — | **$0 (explicit, waived)** | never entered | `$0` | `—` | `{kind:'property', id:'2', value:0, propertyId:null}` |
| C (id 3) | $1,800,000 | — | never entered | never entered | `—` | `—` | none |
| D (id 9) | **never valued** | $180,000 | $2,200 | never entered | `$2,200` | `—` | `{kind:'property', id:'9', value:-2200, propertyId:null}` |

Resulting statement:

| Figure | Value |
|---|---|
| `operational` | 12000 |
| `capitalFinancial` | 0 |
| `realEstateEquity` | 2190000 (2,500,000 of value − 310,000; property 9 **and** its 180,000 mortgage dropped together) |
| `liabilities` | −4700 (2500 + 0 + 2200) |
| `total` | 2197300 |
| components sum to total | true |
| `liabilitiesSecurityDeposits` | −4700 |
| `unvaluedPropertyIds` | [9] |

Probe output, verbatim:

```
{
  "operational": 12000,
  "capitalFinancial": 0,
  "realEstateEquity": 2190000,
  "liabilities": -4700,
  "total": 2197300,
  "sumsToTotal": true,
  "liabilitiesSecurityDeposits": -4700,
  "unvaluedPropertyIds": [
    9
  ],
  "liabilityLines": [
    { "kind": "property", "id": "1", "component": "liabilities", "value": -2500, "propertyId": null },
    { "kind": "property", "id": "2", "component": "liabilities", "value": 0, "propertyId": null },
    { "kind": "property", "id": "9", "component": "liabilities", "value": -2200, "propertyId": null }
  ]
}
property 1: {"securityDeposit":2500,"lastMonthRent":1800}
property 2: {"securityDeposit":0,"lastMonthRent":null}
property 3: {"securityDeposit":null,"lastMonthRent":null}
property 9: {"securityDeposit":2200,"lastMonthRent":null}
```

(The `liabilityLines` array is reproduced with each object on one line for width; it is otherwise
character-identical to the probe's `JSON.stringify(..., null, 2)` output.)

Three rules are visible side by side in that output: property C's `null`s are not zeros, property
B's recorded `0` is not a `null`, property A's $1,800 last-month holding appears in the display
resolution and in **no** component or contribution, and property D's deposit survives the same
exclusion that dropped its mortgage.

**One correctness detail worth naming.** Property B's explicitly recorded `$0` exposed a negative-
zero hazard: `-magnitude` with `magnitude === 0` produces `-0`, which `Object.is` separates from
`0` and which `Intl.NumberFormat` renders as **`-$0`** — verified, not assumed:

```
$ node -e "const f=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
           console.log(JSON.stringify(f.format(-0)), JSON.stringify(f.format(0-0)))"
"-$0" "$0"
```

The contribution is therefore built with `0 - magnitude`, which yields positive zero, and the
acceptance-#7 test asserts the property-2 line is exactly `value: 0`.

---

## Null is distinguishable from zero all the way to the render

`lib/domain/property.ts` — resolution keeps the distinction, using `Map.has()` rather than a
coalesce:

```ts
export function resolveTenantHeldFunds(
  rows: readonly TenantFundRow[],
  propertyId: number
): TenantHeldFunds {
  const deposits = latestTenantFundByProperty(rows, 'security_deposit');
  const lastMonth = latestTenantFundByProperty(rows, 'last_month_rent');
  return {
    securityDeposit: deposits.has(propertyId) ? deposits.get(propertyId)! : null,
    lastMonthRent: lastMonth.has(propertyId) ? lastMonth.get(propertyId)! : null,
  };
}
```

`components/PropertyTenantFundsCard.tsx` — the render branches on `null` explicitly. There is no
`fmt(value ?? 0)` anywhere in this task's diff:

```tsx
function Figure({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      {value === null ? (
        <p className="text-2xl font-mono font-semibold text-slate-300 leading-tight mt-1" title="No amount recorded">
          —
        </p>
      ) : (
        <p className="text-2xl font-mono font-semibold text-slate-900 leading-tight mt-1">{fmt(value)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-1">{value === null ? 'Not recorded' : note}</p>
    </div>
  );
}
```

`app/properties/[id]/page.tsx` — reads the series and passes the resolved shape through, with the
rental-only restriction applied to the *entry affordance* only:

```tsx
async function getTenantHeldFunds(propertyId: string): Promise<TenantHeldFunds> {
  const result = await db.query<{ property_id: number; kind: string; value: string; valued_at: Date }>(
    'SELECT property_id, kind, value, valued_at FROM property_tenant_funds WHERE property_id = $1',
    [propertyId]
  );
  const rows: TenantFundRow[] = result.rows.map((r) => ({
    propertyId: r.property_id,
    kind: r.kind as TenantFundKind,
    value: Number(r.value),
    valuedAt: r.valued_at,
  }));
  return resolveTenantHeldFunds(rows, Number(propertyId));
}
```

```tsx
  const showTenantFunds =
    property.type === 'rental' ||
    tenantHeldFunds.securityDeposit !== null ||
    tenantHeldFunds.lastMonthRent !== null;
...
      {showTenantFunds && (
        <div className="mt-6">
          <PropertyTenantFundsCard
            propertyId={property.id}
            funds={tenantHeldFunds}
            canRecord={property.type === 'rental'}
          />
        </div>
      )}
```

`canRecord` is the SPEC's `type = 'rental'` affordance restriction. Display is deliberately not
gated on it: a reading that exists reduces net worth regardless of the property's type, and
hiding it would leave a number moving the headline with nowhere on the site to see it. Neither
`computeNetWorthBreakdown` nor anything in `lib/domain/property.ts` branches on
`properties.type`. Palette is `slate-*` throughout, matching the surrounding property cards.

---

## `propertyLedger.ts` and `propertyPnl.ts` carry no changes

```
$ git diff --stat HEAD -- lib/domain/propertyLedger.ts lib/domain/propertyPnl.ts
(no output)

$ git status --short lib/domain/propertyLedger.ts lib/domain/propertyPnl.ts
(no output)

$ for f in lib/domain/propertyLedger.ts lib/domain/propertyPnl.ts; do
    echo "$f  HEAD=$(git show HEAD:$f | md5)  WORKTREE=$(md5 -q $f)"
  done
lib/domain/propertyLedger.ts  HEAD=afb3dad62f2d5398720d9244c9317b12  WORKTREE=afb3dad62f2d5398720d9244c9317b12
lib/domain/propertyPnl.ts  HEAD=eb9baf265028d1abf76d9781019f08b6  WORKTREE=eb9baf265028d1abf76d9781019f08b6
```

Byte-identical to HEAD. The ledger's beginning balance, running balance and ending balance are
untouched, and no deposit or last-month amount is netted into them; the P&L's classification of a
deposit-received transaction is unchanged. Their test files are likewise unmodified (8 and 14
tests, same as HEAD).

---

## Files changed by this task

| File | Change |
|---|---|
| `lib/domain/netWorth.ts` | New required 6th parameter `securityDepositsByProperty`; deposit loop reducing `liabilities` and emitting one `kind:'property'`, `propertyId:null` contribution each; new `liabilitiesSecurityDeposits` field on `NetWorthBreakdown`. |
| `lib/domain/property.ts` | `TenantFundRow`, `latestTenantFundByProperty` (kind filter → `latestValueByKey`), `TenantHeldFunds`, `resolveTenantHeldFunds`. |
| `lib/domain/netWorth.test.ts` | 6 new tests (names verbatim per SPEC); 19 existing call sites gained the new required argument as `new Map()`. |
| `lib/domain/property.test.ts` | 2 new tests (names verbatim per SPEC). |
| `lib/netWorth.ts` | Fetches `property_tenant_funds`, reduces newest-wins filtered to `'security_deposit'`, passes it in; snapshot INSERT **and** `ON CONFLICT DO UPDATE` both set `liabilities_security_deposits`. |
| `app/properties/[id]/page.tsx` | `getTenantHeldFunds`, `showTenantFunds`, renders the card. |
| `components/PropertyTenantFundsCard.tsx` | **new** — display of both figures + rental-only entry form. |
| `app/api/properties/[id]/tenant-funds/route.ts` | **new** — always-INSERT POST, mirroring the valuation route. |
| `app/net-worth/page.tsx` | one line: the `liabilities` `hint`. |

Not touched: `lib/domain/propertyLedger.ts`, `lib/domain/propertyPnl.ts`, `app/properties/page.tsx`,
`shared/types.ts`, `migrations/**`, `db/schema.sql`, `.claude/**`, `vitest.config.mts`,
`scripts/seed-demo.mjs`.

---

## Notes and one flagged item, neither of which I acted on

1. **`scripts/seed-demo.mjs:454` writes `net_worth_snapshots` without the new column.** The
   CONTRACT flags it ("valid unchanged, but any seeded row it writes after the cutover carries the
   same lying-marker problem"). It is **outside this task's declared scope**, so I left it alone
   rather than making an unauthorized diff. Concretely: the script computes `liabilities` from
   unlinked liability accounts only and models no deposits at all, so its rows would land with
   `liabilities_security_deposits` NULL — claiming to predate deposit modelling. For seeded demo
   data the honest value is `0` (the fabricated portfolio genuinely holds no deposits), not NULL.
   Flagging upward for a follow-up decision; a one-line change, but not mine to make here.
2. **No migration was run.** Per the standing hazard in `GATES.md` and my instructions,
   `npm run migrate:*` loads `.env.local` and points at real data. Every acceptance command above
   is a pure-function run, `tsc`, or a static grep — none opens a database connection. The
   route handler and the two page queries are therefore verified by `tsc` and by code review, not
   by execution, which is what the SPEC's toolchain row T2 specifies.
3. **`npx vitest run --pool=threads` was used everywhere**, and every run reported a test count.
   No run in this bundle reported "no tests".
4. **Next 16.** `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and
   `.../03-file-conventions/route.md` were read before writing the route handler; `params` is a
   Promise and is awaited, matching the existing valuation route.

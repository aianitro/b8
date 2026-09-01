# NITS — P0-09a-tenant-held-funds

Follow-ups surfaced by this task and deliberately **not** acted on inside it. BUILD.md §7.4
requires nits to become recorded follow-ups rather than being silently absorbed — an absorbed nit
is a scope violation that happens to be well-intentioned, and it is invisible to the next reader.

Both items below were raised by the agent that found them, each of which correctly declined to
make the fix because the file sat outside this task's declared surface.

---

## N1 — `scripts/seed-demo.mjs:454` writes a snapshot row that lies about its own definition

**Raised by:** implementer, G2. **Severity:** low today, misleading later.

The seeder writes `net_worth_snapshots` with the pre-P0-09a column list, so any row it creates
after this task lands leaves `liabilities_security_deposits` NULL. By the semantics `CONTRACT.md`
established, NULL means *"this row predates deposit modelling"* — which is false for a row written
today.

The honest value for the seeder specifically is **`0`**, not NULL: the demo data models no
properties holding tenant deposits, so zero deposits is a true statement about that portfolio,
whereas NULL asserts the row comes from before the concept existed.

Not a live data risk — the seeder targets demo databases, not the owner's. But it is exactly the
"marker that lies" failure the whole column exists to prevent, reproduced in the one place nobody
would look.

**Fix:** add `liabilities_security_deposits` to the INSERT with a literal `0`.

---

## N2 — the dashboard's YTD delta straddles the definition change

**Raised by:** contract-guardian, G1. **Severity:** a real, one-time wrong number on a live surface.

`app/dashboard/page.tsx:391` computes `netWorth.total - firstThisYear.total` against the earliest
stored snapshot. From the cutover onward that subtracts an **old-definition baseline** from a
**new-definition current figure**, understating net-worth growth by exactly the total security
deposits held. It renders perfectly and is wrong — the precise failure mode `net_worth_snapshots`
gained a decomposition column to make visible.

The column makes it detectable:

```sql
SELECT snapshot_date FROM net_worth_snapshots
 WHERE liabilities_security_deposits IS NULL ORDER BY snapshot_date LIMIT 1;
```

Rows at or after that boundary are comparable to each other; rows before it are not comparable to
rows after without adding the deposit figure back.

**Why it was not fixed here:** `app/dashboard/page.tsx` is outside this task's declared surface,
and SPEC's non-goals scope the UI work to the property detail page plus one caption edit. SPEC
lists this scenario in its failure modes but attaches no acceptance command to it, which is
consistent: it is a known consequence, not a defect in this diff.

**Fix, when scheduled:** either compare only within the post-cutover era, or normalize the older
baseline by adding back its (unknown, therefore assumed-zero) deposit figure and disclose that the
comparison crosses a definition change. The first is honest; the second is honest only if the
disclosure ships with it.

**Note the interaction with N1:** if the seeder is fixed to write `0`, demo databases get a clean
non-NULL series and the boundary query above returns nothing there — correct, since no such
boundary exists in demo data.

---

## N3 — a same-day correction to any observation series is silently ignored, and here it is unrecoverable

**Raised by:** adversarial-reviewer, G3 (NIT-1). **Confirmed by execution** at G4.
**Severity:** wrong number displayed, no recourse until the next calendar day.

`latestValueByKey` breaks ties with strict `>`, so on an exact `valued_at` tie the first row the
query returns wins. Entry forms default to a date-only value, cast to session midnight, so two
readings entered the same day are byte-identical in timestamp.

Reproduced against a throwaway database — `250` then `2500`, same day, fed through the real
reducer in the order Postgres returned them:

```
AssertionError: expected 250 to be 2500
```

The typo wins. Net worth stays under-reduced, the card keeps showing the wrong figure, and the
card's own copy ("recording a new amount supersedes the last one") is false.

**Scope is wider than this task.** This is a pre-existing property of the shared reducer:
`latestValuationByAccount` and `latestValuationByProperty` behave identically, so a same-day
corrected *property valuation* is ignored the same way today. What is new is that it is
**unrecoverable here** — `PropertyValuationHistory` has a `DELETE` affordance, so a bad valuation
row can be removed; `PropertyTenantFundsCard` has none.

**Fix options, in preference order:** (a) tie-break on `id` inside `latestValueByKey` — one line,
fixes all three series at once, and `id` is monotonic per table; (b) add the delete affordance the
valuation card already has; (c) stop defaulting to a date-only stamp. (a) is the real fix; (b) is
worth doing regardless.

---

## N4 — `/net-worth`'s unvalued-property banner contradicts the deposit line beneath it

**Raised by:** adversarial-reviewer, G3 (NIT-2). **Severity:** correct number under a false caption.

`app/net-worth/page.tsx:121–132` tells the reader an unvalued property "is excluded entirely —
along with any mortgage against it… neither side is counted." With this task shipped, that same
page lists the same property by name under "Other debt" at its deposit amount. Both statements
render, on one page, about one property.

Same defect class the SPEC corrected the component `hint` for — and it was out of scope for the
same reason the hint edit was explicitly *in* scope: non-goals restricted that file to one line.

**Fix:** "excluded from real-estate equity" rather than "excluded entirely."

---

## N5 — the acceptance suite does not reach the production wiring

**Raised by:** adversarial-reviewer, G3 (NIT-3). **Confirmed by mutation testing** at G4.

Changing `lib/netWorth.ts:95` from `'security_deposit'` to `'last_month_rent'` — which would make
last month's rent reduce net worth and deposits stop counting, contradicting the owner's decision
outright — left **all eleven acceptance commands green**, including the full 298-test suite.

The suite tests pure functions; the single line wiring the correct kind into production is
reachable by none of them, because toolchain row T2 declared no database and the I/O shell is
therefore untestable.

**Mitigated, not fixed:** a static check (`grep -c "'last_month_rent'" lib/netWorth.ts` → `0`) now
runs at G4 and discriminates cleanly. The general lesson is recorded as BUILD.md amendment **A7**.
The real fix is route/DB-level tests against a throwaway database — `ROADMAP.md` §2 already calls
these tier 2, and this is a concrete argument for them.

---

## N6 — three input classes return 500 instead of 4xx

**Raised by:** adversarial-reviewer, G3 (NIT-4). **Severity:** low; not reachable from the UI.

`app/api/properties/[id]/tenant-funds/route.ts`: a non-JSON body, a literal `null` JSON body, and
a non-integer `:id` all escape as unhandled 500s. Identical to
`app/api/properties/[id]/valuation/route.ts`, which this route deliberately mirrors — carried
forward, not introduced. Worth fixing in both together.

---

## N7 — `today()` uses the date conversion this codebase documents as wrong

**Raised by:** adversarial-reviewer, G3 (NIT-5).

`components/PropertyTenantFundsCard.tsx:21` uses `new Date().toISOString().slice(0, 10)` — the
exact conversion `lib/domain/property.ts:34` explains is subtly wrong, because it converts to UTC
first and shifts the local date. `PropertyValuationHistory.tsx:21` is character-identical, so this
replicates the house pattern rather than diverging from it.

**Fix:** both call sites, using the existing `toDateInputValue` local-components formatter.

---

## N8 — deployment ordering: the migration must land before the code

**Raised by:** adversarial-reviewer, G3 (NIT-6). **Not a defect** — recorded so it is not learned
the hard way.

The tenant-funds query sits inside `Promise.all` in `computeCurrentNetWorth`, so against a
database without `property_tenant_funds` both `/dashboard` and `/net-worth` return 500 rather than
degrading. That is the correct behavior: a silently empty deposit set would overstate net worth,
which is precisely what the required-6th-parameter design prevents. It does mean **the migration
must be applied before this code is deployed**, and that ordering is not enforced by anything
mechanical.

---

## N9 — pre-existing test fixtures appear to contain real rent figures

**Found by:** orchestrator, G4 real-data sweep. **Not introduced by this task.**

Sweeping the two figures the owner named verbally turned up ten hits, all in
`lib/domain/propertyPnl.test.ts` and `lib/domain/propertyLedger.test.ts` — both byte-identical to
HEAD, so nothing this task added contains them. They sit there as *rent* amounts, and a security
deposit is commonly one month's rent, which is why they matched.

That means those committed test fixtures look like real figures from the owner's own portfolio.
Harmless in a private repo; a data-hygiene problem the moment it is public, and the repo is a
portfolio piece per `ROADMAP.md` §5.

**Fix:** re-fabricate the fixtures in both files with figures that resemble nothing real. Cheap,
mechanical, and the tests assert on relationships rather than magnitudes, so the values can change
freely.

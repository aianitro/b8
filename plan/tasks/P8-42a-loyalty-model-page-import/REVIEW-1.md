# REVIEW-1 — P8-42a-loyalty-model-page-import
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (cycle 1, 2026-11-19)

Persisted by the orchestrator from the reviewer's final message. The reviewer's YAML restatement of the same
log and findings is omitted as a duplicate of the tables below.

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | A full member number leaks through S2, an S5 POST/PATCH echo, or S7. | `membershipFrom` (loyaltyStore.ts:170) is the only membership-view builder and emits `maskMemberNumber(...)`; `loadOverview` has no other number field; `memberNumberOf` (:405) is called only by the S6 route; `LoyaltyMembershipSchema` is strict with `memberNumberMasked` refined to ≤4 visible characters. | REFUTED |
| 2 | A full number leaks through a 400/409 error body. | `failure` emits fixed messages; `bodyOf` emits the first zod issue's path + message; contract refine messages name rules, not values; `fromPgError` never returns `err.detail`; C4 checks 5-character canary substrings on a 400 and a 409. | REFUTED (zod built-ins → Inconclusive 1) |
| 3 | The full number reaches /travel's RSC payload. | page.tsx passes masked `loadOverview()` only; `LoyaltyCopyNumber` fetches S6 in `onClick`, keeps it out of state, writes to the clipboard; H11 checks page HTML. | REFUTED |
| 4 | The full number reaches a log line or the import's stdout/stderr. | Store logs `{code}`/`{count}` only; `lib/db.ts` has no logging; the import prints `planLines` and fixed strings and drops the error object; C4 spies non-empty; I5 across 8 runs. | REFUTED |
| 5 | Current balance is newest-by-arrival or computed outside observations.ts. | `latestRowByKey` + `compareDatedObservations` (asOf, recordedAt as fixed-width UTC text, id) is a total order; every path uses `currentObservationByMembership`; no ORDER BY … LIMIT 1 on observations; `latestValueByKey` unchanged; C2, I6. | REFUTED |
| 6 | A read-scope token writes, or a write route skips its scope check. | All 11 routes call `callerOf` → `authorize` → `scopePermits`; `READ_SAFE_POSTS` is only `/api/v1/chat`; C5 calls handlers directly: 403 and unchanged checksum. | REFUTED |
| 7 | A bearer token reaches S6. | member-number/route.ts:17 refuses `kind !== 'browser'` with 403 `BROWSER_SESSION_REQUIRED`; C4 covers read and full tokens. | REFUTED |
| 8 | A balance passes through Number/parseFloat/JS arithmetic, including UI grouping. | `Number(` only on ids; parsing and grouping are regex on text; SQL `$n::numeric` in, `balance::text` out. | REFUTED |
| 9 | Null renders as 0. | MembershipLine.tsx:58 and `formatBalance` render "—"; blank/`-` import cells yield no row; I2 asserts no zero rows. | REFUTED |
| 10 | The import is not all-or-nothing. | `planImport` returns no writes on any refusal; BEGIN → LOCK → plan → write → COMMIT, ROLLBACK on any throw; I4, I11, GATES #9. | REFUTED |
| 11 | A re-run duplicates rows. | Existing rows counted; ON CONFLICT DO NOTHING + rowCount check; partial unique indexes; I3 checksums. | REFUTED |
| 12 | The import creates a program/alias/member or updates a membership. | `performWrites` inserts only memberships, observations, instruments; I7; structure counts. | REFUTED |
| 13 | The import reads the fee column. | Fee header resolved only for the duplicate-header check; `ImportRow` has no fee field; fee digits absent from output. | REFUTED |
| 14 | Label resolution departs from the spec. | Traced `normalizeLabel` order, whole-word `endsWithWords`, ambiguity refusal, default-member match, exact alias equality, no retry path. The implementer's U10 note is correct. | REFUTED |
| 15 | M23: the API separator refusal is not enforced at the route. | Contract refine `isBalanceForUnit` runs in `bodyOf`; `parseBalance` re-checks in `addObservation`; two independent refusals, so one mutant leaves C3 green by design; C3 sends `"1,500"` through the handler → 400. | REFUTED |
| 16 | A scenario passes vacuously. | C and I tests call real handlers / `main` with the real DB and fixtures; non-empty capture assertions; GATES #9 is a real `tsx` process. | REFUTED |
| 17 | Future as-of accepted or off by one. | `$1::date > CURRENT_DATE + 1`; C3: +1 → 201, +2 and 2999-01-01 → 400. | REFUTED |
| 18 | Instrument date order bypassed by a PATCH of one date. | Table CHECKs + 23514 → 400; C7. | REFUTED |
| 19 | Concurrent duplicate memberships give a 500. | 23505 on the named constraint → 409; C9 ten concurrent pairs. | REFUTED |
| 20 | A non-goal is violated. | No Needs-attention section, no `card_account_id` write, no delete route, no observation UPDATE/DELETE; the only DELETE is S4's atomic alias replacement. | REFUTED |
| 21 | A client component imports `lib/db` or the store. | Import lists of all Loyalty*.tsx and TravelBoard.tsx. | REFUTED |
| 22 | Default as-of is a UTC day or server clock. | `useState(() => localIsoDate())`, mounted after a click; no Date/toISOString. | REFUTED |
| 23 | The service worker caches S6. | sw.js:59 skips `/api/`; client fetch `cache: 'no-store'`. | REFUTED (see N6) |
| 24 | Net worth/ledger changes or loyalty reads transactions. | No ledger table selected; C6 deep-equal + checksums; C10 grep. | REFUTED |
| 25 | An in-place edit destroys data unintentionally. | `LoyaltyInlineText` `startEmpty` with the member-number `onSave`. | CONFIRMED (N1) |
| 26 | The import's "add the alias on /travel" repair path exists. | Alias editor only on cards; cards only for held programs. | CONFIRMED (N2) |
| 27 | A mistyped far-future `--as-of` freezes the balance. | `parseArgs` checks calendar validity only. | CONFIRMED (N3) |

## Findings (all NIT — see NITS.md)
N1–N6 as recorded in NITS.md.

## Scope violations
None. Diff matches the declared surface plus `plan/` records.

## Inconclusive — requires execution
1. zod built-in enum/literal messages echoing the submitted value. **Run by the orchestrator** (GATES G3).
2. A global `Cache-Control` for `/api/`. **Run by the orchestrator** (GATES G3).

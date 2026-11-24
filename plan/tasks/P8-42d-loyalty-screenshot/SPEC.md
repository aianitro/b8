# P8-42d-loyalty-screenshot — a balance from a screenshot: "Update from screenshot" on each membership reads one re-encoded image with Claude, shows what it found and what disagrees, and one tap appends a `screenshot` observation; the image is never kept; /travel asks for a screenshot only where the inbox is not bringing balances

**Roadmap item:** ROADMAP.md §5 Phase 8 step 42d; `plan/LOYALTY-ROADMAP.md` §4 C and §6 42d. Origin: `plan/tasks/P8-42d-loyalty-screenshot/ITEM.md` (binding). "42c2 line n", "42c3 line n" and "42c4 line n" mean line n of the FROZEN SPEC.md of P8-42c2-loyalty-inbox-read, P8-42c3-loyalty-read-forwards and P8-42c4-loyalty-read-robustness. HEAD at spec time is `b82171c`.
**Status:** FROZEN (G0 2026-11-24, amendments A0, A1b, A2 and A3 at the end)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec holds no money-looking figure, no balance and no member number. Tests use fabricated `ZQ42D` data only: program names `ZQ42D …`, sender domains and addresses on `.test` or `example.*`, and images generated in code (a few bytes with a JPEG, PNG or WebP signature; never a photograph). Balances in tests are written as small whole numbers of two digits or fewer, or computed in the test; a quoted digit-only string of four or more digits or a quoted decimal with two to four places is forbidden in the new test files (command 14). Dates are `YYYY-MM-DD` or day offsets from Postgres `CURRENT_DATE`. Command 19 scans this spec. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way. No `sed` range below is a comma-grouped number: ranges use variables or `-e Np` pairs. `git show` always takes repo-relative paths. Restore traps use absolute paths because a subshell may `cd`.

## Goal
For a program whose mail never carries a balance, the person opens `/travel`, taps "Update from screenshot" on that membership, picks a screenshot of the program's app, and sees a form pre-filled with what Claude read (balance, unit, as-of date), a masked suffix, what disagrees with this membership, and whether the reading would become the current balance. One tap saves it as a new observation with source `screenshot`. Nothing is saved before that tap. The image is read and discarded within one request. `/travel` also lists, under "Needs a screenshot", each membership whose balance is old or absent for a program the inbox is not bringing balances for. Nothing about 42c's inbox, read pipeline, auto-apply, queue or typed edits changes.

### Decisions the item delegated to this spec
Each is binding; the short reason is for the reviewer.

**D1 — Share target: out, deferred.** No `share_target` in `app/manifest.ts`, no service-worker change, no multipart route. The entry is a control on each membership that opens the photo picker. *Why:* iOS home-screen web apps do not support the Web Share Target API, and the owner's phone is an iPhone, so the feature would not be reachable; it also needs a service worker or a multipart POST target that handles an unauthenticated-looking navigation, a new attack surface for no reachable benefit. Picker, then confirm, is two taps from `/travel`.

**D2 — Disagreement warns; it never blocks.** The read answer carries three comparisons against the membership the read was started from: `programCheck`, `suffixCheck`, `unitCheck`, each `match`, `mismatch` or `not_stated`. A `mismatch` shows a warning line in the form and changes the confirm button label from "Save balance" to "Save anyway"; the confirm route never refuses on it. *Why:* the person chose the membership and sees the screenshot; typed entry (path D) can already write any balance to any membership, so a block only forces re-typing and defeats the exit criterion; the server is stateless about the read (no image, no stored proposal), so it has nothing to block against. A `not_stated` shows no warning (a screenshot that prints no number is normal).

**D3 — Needs-attention staleness rule, from today's data.** Let `T` be `LOYALTY_INBOX_SILENCE_DAYS` (45, existing; no new constant, no per-program cycle learning). "The inbox is bringing balances for program P" is true exactly when all of: P has at least one sender domain; P's coverage value (the existing `balanceInLastStatement`) is `yes`; the greatest `last_seen_on` over P's domains is not null and `CURRENT_DATE` minus it is at most `T` days. A membership of P is **due** exactly when the inbox is not bringing balances for P AND (the membership has no observation, or `CURRENT_DATE` minus its current observation's as-of date is strictly greater than `T`). Exactly `T` days old is not due; `T + 1` is due. A future-dated current observation is not due. The current observation is the shared reducer's (greatest as-of, then recorded time, then id), so an older screenshot recorded later does not clear a due membership. The list is the panel's new field `screenshotDue`: membership ids, strictly ascending, one entry per membership however many sender domains the program has. All arithmetic is Postgres `CURRENT_DATE` in the same snapshot as the rest of the panel; no JS clock. *Why:* there is no per-program statement cycle in the data; the one cycle constant in the system is the 45-day silence constant, and 45 days spans a monthly statement with slack. Using coverage plus last-seen means a program the inbox serves is never nagged (that is forwarding health's job), while a program whose newest statement had no balance, or whose mail went quiet, is. A membership with no reading is due because "—" is the thing the person wants gone.

**D4 — The image is not kept.** It is read and discarded in the same request: no table, file, cache, log line, queue or API payload holds it, and nothing derived from it but the three confirmed values is stored. *Why:* it carries the full member number and the member's name; the confirm needs only balance, unit and as-of; a wrong read is fixed by taking another screenshot, so a re-read buffer buys nothing. 42c's fixed retention is therefore not used. The confirmed observation is an ordinary row.

**D5 — Where the reader lives and what it may send.** The screenshot reader is new exports in `apps/web/lib/loyaltyReader.ts`, additions only. The request to Anthropic holds one user message of exactly two blocks, the re-encoded image and one fixed text instruction, plus a fixed system prompt; no household data (no program name, member name, number, balance or id) is sent. The answer schema is the existing `READ_SCHEMA`, the clean pass is the existing `cleanReading`; no free text from the model is ever shown or stored. *Why:* `loyaltyReader.ts` is documented as the only file of the pipeline that names the key, and 42c2's importer check lists exactly the SDK importers; a new importing file would break both for no gain.

**D6 — Routes.** `POST /api/v1/loyalty/memberships/[id]/screenshot` reads one image and answers a proposal (it writes nothing). `POST /api/v1/loyalty/memberships/[id]/screenshot/confirm` appends the observation. Both are write routes (`callerOf`): a read-scope token is 403, because a read costs money and a confirm writes. *Why separate:* the typed route must keep refusing `source: screenshot` (pinned by `T42a-C3`), and the read and the write have different failure modes.

**D7 — Expiry warnings and instruments are read and shown, not stored.** They go through the 42c2 clean pass and appear in the read answer and in the form as information. Confirm stores no instrument and no warning. *Why:* storing them needs a new table or a widened instrument-source CHECK (a migration); the item's exit criterion is balances; 42e and 42g own what is done with them.

**D8 — Newest by as-of still wins; ties go to the new row.** A confirmed screenshot becomes current exactly when the membership has no observation or its as-of is greater than or equal to the current one's (string comparison of `YYYY-MM-DD`; an equal date wins because the reducer breaks ties by later recorded time). Strictly older: recorded, not current. The form states which before the tap. The server enforces nothing extra; it is the reducer's existing behaviour. *Why:* a person confirmed it, unlike 42c2's auto-apply, which treats an equal date as `stale`.

**D9 — The 42c2 rules reused, and the ones not.** Reused: the clean pass (`cleanReading`), the program check (`programCheck`, containment either way over the program's name and aliases), the suffix rule (stored number normalised to upper-case letters and digits ends with the kept suffix), the unit comparison (against the membership's current unit, else the program's default unit). Not used, by design: the jump rule, the stale rule, the queue and the `no_suffix`/`unmatched` reasons (a person is looking), and the not-mine list. The as-of future limit of the typed path (more than one day after `CURRENT_DATE` is refused) applies at confirm.

**D10 — A reading with no balance.** The answer is outcome `read` with balance, unit and as-of null; the form is empty and says nothing could be read. With no `ANTHROPIC_API_KEY`: outcome `disabled`, nothing sent. A failed read: outcome `error` with a classified code. All three are HTTP 200, as 42c2's read and the receipts reader; the form is always usable by hand.

## Non-goals
The reviewer enforces each as a defect if present.
- **No share target, no service worker, no manifest change** (D1). `apps/web/app/manifest.ts` is byte-identical.
- **No stored image, no stored proposal, no new table, column, migration or `db/schema.sql` change** (D4). No `receipt_captures` write, no file write, no cache, no browser storage of the image, no `FormData`.
- **No change to what 42c does**: the inbox, the read pipeline, `decideReading`, `cleanReading`, `READ_SCHEMA`, `READ_SYSTEM_PROMPT`, `createMailReader`, the auto-apply rule, the queue, retry limits and the scheduler are unchanged. Edits to `loyaltyReader.ts` and `loyaltyInboxRead.ts` are additions only (command 6 and 14).
- **No change to the receipts feature**: `receipt.ts`, `receiptReader.ts`, `receiptUpload.ts`, `receiptCaptureClient.ts`, `receiptCaptureStore.ts`, `app/api/v1/receipts/**` and `app/receipts/page.tsx` are untouched. The screenshot reuses `shrinkReceipt` and `checkReceipt` by import only.
- **No change to the typed observations route** or its refusal of `source: screenshot`; `addObservation`'s behaviour for `typed` is unchanged.
- **No instrument, expiry or stay is created or stored from a screenshot** (D7). Stays, flights, redemptions (42e), transfers (42f), alerts and digest (42g), the agent tool (42h) and 42c2's N3 are out of scope.
- **No per-program cycle learning, no stored staleness threshold, no new constant** (D3).
- **No second image encoder** in the new client code: `shrinkReceipt` is the only one (no new `createImageBitmap`, `toBlob`, canvas).
- **No jump check, no queue entry and no auto-apply for a screenshot** (D9).
- **No new dependency**, no new environment variable, no change to `package.json`, lockfile, `eslint.config.*` or `vitest*.mts`.
- **No log line carries image bytes, base64, a member number, a suffix, a balance, a name, model output, a library error text or a key**; only the model name, token counts and fixed codes. No `console.` call is added.
- **No existing test, fixture or script is edited** except the three named lines in `packages/contracts/loyalty.test.ts` (A1 below) and the additions to `apps/web/scripts/gifts-surface-check.mjs` and `apps/web/lib/giftSurfaceRegistry.ts` named in commands 11 and 13.
- **No wording change** to the 42c2 panel strings pinned by fixtures (`Needs attention: n`, `Nothing needs attention`); the new section is separate.

## Contracts touched
G1 **runs** (contract-guardian). The scope-guard hook blocks every other agent from `packages/contracts/**`, so contract-guardian writes every change in that directory, including the three test lines; the implementer does not edit it.

| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/loyalty.ts` | NEW const `LOYALTY_SCREENSHOT_OUTCOMES = ['read', 'disabled', 'error'] as const`; NEW `LoyaltyScreenshotOutcomeSchema`; NEW `LoyaltyScreenshotReadSchema` (strict: `outcome`, `errorCode` (`LoyaltyReadErrorCodeSchema` nullable), `balance` (string nullable), `unit` (`LoyaltyUnitSchema` nullable), `asOf` (`calendarDate` nullable), `maskedSuffix` (`LoyaltyReadMaskedSuffixSchema` nullable), `programCheck`, `suffixCheck`, `unitCheck` (each `LoyaltyReadProgramCheckSchema`), `expiryWarnings` (`LoyaltyReadExpiryWarningSchema` array, at most `LOYALTY_READ_EXPIRY_MAX`), `instruments` (`LoyaltyReadInstrumentSchema` array, at most `LOYALTY_READ_INSTRUMENT_MAX`); refinements: `errorCode` set exactly when `outcome` is `error`; `balance` and `unit` null together; a non-null balance canonical for its unit; outcomes `disabled` and `error` carry null balance, unit, asOf and suffix, empty arrays and all three checks `not_stated`; a non-`not_stated` `unitCheck` needs a unit; a non-`not_stated` `suffixCheck` needs a suffix); NEW `LoyaltyScreenshotReadResponseSchema = apiResponseSchema(LoyaltyScreenshotReadSchema)`; NEW `LoyaltyScreenshotConfirmRequestSchema` (strict `{ asOf: calendarDate, balance: LoyaltyBalanceInputSchema, unit: LoyaltyUnitSchema }`, refined by `isBalanceForUnit`; no `source` key); NEW types `LoyaltyScreenshotOutcome`, `LoyaltyScreenshotRead`, `LoyaltyScreenshotConfirmRequest` | additive |
| `packages/contracts/loyalty.ts` | `LoyaltyInboxReadPanelSchema` gains required `screenshotDue: z.array(LoyaltyIdSchema)` with a refinement that the ids are strictly ascending (so no repeat); its doc comment states D3 | **breaking** (new required field of an emitted object). Producer (`loadReadOverview`) and consumer (the page) ship in this commit; no external consumer exists. The guardian may re-class after checking `GET /api/v1/loyalty` consumers |
| `packages/contracts/loyalty.test.ts` | exactly three diff lines (A1): the `EMPTY_READ` literal gains `screenshotDue: [],` (one line removed, one added) and the `panel` builder gains one added line `screenshotDue: [],` before `...over,` | additive (test fixture follows the schema) |
| `db/schema.sql`, `migrations/**` | **none.** `loyalty_observations.source` CHECK already allows `screenshot` (schema line 1488); nothing is stored beyond an ordinary observation row | none |

Unchanged on purpose: `LOYALTY_OBSERVATION_SOURCES`, `LoyaltyObservationCreateRequestSchema` (its typed-only rule and `T42a-C3`), `LoyaltyErrorCodeSchema` (a 413 uses the existing `INVALID_INPUT`, as the receipts route does), `LOYALTY_INBOX_SILENCE_DAYS`, every `LOYALTY_READ_*` constant. The confirm route answers the existing `LoyaltyMembershipResponseSchema`.

**A1 — the three test lines.** The exact diff of `packages/contracts/loyalty.test.ts` against `HEAD` is: one removed line, the `EMPTY_READ` literal line as it is today; two added lines, each containing `screenshotDue: []`. Command 16 checks it.

## Conventions this task must honor
- **Sign:** a balance is a count of points, miles or nights, or a travel credit in `usd`; it is never negative and never signed. Canonical text only: whole units are digits with no leading zero except the value `0`, no sign, no grouping, no fraction, at most 12 digits; `usd` is digits, a point, exactly two decimals. No amount is negated. The Postgres column is `NUMERIC(12,2)` for every unit, read as text. Nothing here touches a ledger amount, so the ledger sign convention (card charge positive, payment negative) is not consulted.
- **Rounding:** none, anywhere. A figure that does not fit its unit's canonical form is no figure (null), never rounded: grouping commas are removed only when every group is exactly three digits (`cleanBalance`), a comma decimal such as `12,50` is refused, a third `usd` decimal is refused, a fraction on a whole unit is refused. Parsing is the shared `parseBalance` through `cleanReading`; no `parseFloat`, `Number` on a balance, `toFixed` or `Math.round`. Staleness is whole calendar days from Postgres date subtraction.
- **Landscape and exclusions:** not applicable. No ledger row is read or written by any new code; `landscape`, `hidden` and `exclude_from_budget` are never consulted and nothing here feeds net worth or `computeNetWorth()`. The confirm route answers a membership view that carries the card's fee-watch date (derived by existing code through the gift read path); that is why it is classed `numeric-only`.
- **Null semantics:** a membership with no observation shows "—", never 0; a read zero is the text `0` and is a reading. A balance the screenshot does not show is null and the form field is empty, never pre-filled with 0. An unread field is `null`; an unreadable list is `[]`. `screenshotDue` is `[]` when nobody is due, never null or absent. `not_stated` is "could not compare" (the screenshot printed no suffix, or the membership has no stored number): neither a match nor a warning.
- **Dates and clock:** "today" is Postgres `CURRENT_DATE`. None of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `setHours(`, `getTimezoneOffset`, `toLocaleDateString`, `toLocaleTimeString`, `parseFloat`, `parseInt`, `toFixed`, `Math.round` appears in any added non-test line (command 14). The one device-calendar default for an absent as-of is the existing `localIsoDate()` helper, imported, as `LoyaltyBalanceEditor` does.
- **Standing rule (D8) and due rule (D3):** pure string comparison of `YYYY-MM-DD`; no Date object.
- **Member numbers and names:** the full number never leaves the server in any new payload; the only fragment is the existing masked suffix (four bullets plus the 3 or 4 kept characters), and only the suffix the screenshot showed, not the membership's. The household member's name appears only where the page already shows it.
- **Determinism:** no live Anthropic, Plaid or mailbox, no non-loopback socket, no dependence on `b8_finance`; the model is faked in tests; Postgres is the throwaway `b8_p42a_throwaway`; the day arithmetic is done by Postgres from `CURRENT_DATE` with offsets.

## Toolchain prerequisites
All commands run under `/bin/bash` 3.2 from the repo root. The orchestrator measures every row at G0; a mismatch is a G0 FAIL and the numbers in commands 3 and 8 are corrected before freezing.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql` and local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB `b8_p42a_throwaway` at head, no `ZQ42D` rows, no leftover `zq42d` triggers or functions | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42D%')\|\|','\|\|(select count(*) from household_members where display_name like 'ZQ42D%')\|\|','\|\|(select count(*) from loyalty_sender_domains where domain like '%zq42d%')\|\|','\|\|(select count(*) from pg_trigger where tgname like 'zq42d%')\|\|','\|\|(select count(*) from pg_proc where proname like 'zq42d%')"` → `0,0,0,0,0` | filled at G0 |
| T3 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → `Test Files  112 passed (112)`, `Tests  1430 passed (1430)` | filled at G0 |
| T4 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, at most 5 warnings | filled at G0 |
| T5 | Integration baseline total 379 on the unmodified tree | **yes** | existing | `O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") \|\| true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r.testResults.flatMap(f=>f.assertionResults).length)' "$O"` → `379` | filled at G0 |
| T6 | `tsc` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Node 22 or later | **yes** | local | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T8 | Port 3198 free; surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`; then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → last line `OK H1-H15`, `exit=0` | filled at G0 |
| T9 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T10 | Frozen carried lines sit where stated. 42c2 SPEC prefixes: 251 `set -e; O="$(mktemp)"; npm run lint`, 255 `echo "OK lint 0 errors`, 269 `set -e; B="$(git merge-base HEAD main)"`, 278 `echo "OK dependencies"`, 374 `set -e; U=postgresql://localhost/b8_p42a_throwaway`, 392 `echo "OK schema"`, 397 `set -e; unset ANTHROPIC_API_KEY`, 398 `for TZV in UTC Pacific/Auckland`, 407 `node -e 'const r=JSON.parse(require("fs")`, 408 `LEFT="$(psql `, 409 `[ "$LEFT" = `, 410 `echo "OK no fixture rows left"`, 416 `set -e; unset ANTHROPIC_API_KEY`, 420 `bash -c `, 426 `set -e; unset ANTHROPIC_API_KEY`, 440 `BODY="$(sed -n `, 574 `set -e; D=apps/web/lib/fixtures/loyalty-read; I=`, 605 `echo "OK fixtures pinned and covered"`. 42c3 SPEC prefixes: 182 `set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN`, 183 `for TZV in UTC Pacific/Auckland; do O=`, 256 `set -e; D=apps/web/lib/fixtures/loyalty-read-forwards`, 288 `echo "OK new fixtures pinned and covered"`. Line 407 of 42c2 holds the digits `370` exactly twice | **yes** | frozen | `S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; for n in 251 255 269 278 374 392 397 398 407 408 409 410 416 420 426 440 574 605; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done`, `S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; for n in 182 183 256 288; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-70; done`, and `sed -n '407p' plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md \| grep -o 370 \| wc -l \| tr -d ' '` → `2` | filled at G0 |
| T11 | The 42c2 fixture directory has the digest used by command 12 and the 42c3 directory matches its pin, on the unmodified tree | **yes** | existing | command 12's first six statements on the unmodified tree → `OK new fixtures pinned and covered`, `OK fixtures pinned and covered` | filled at G0 |
| T12 | `INSERT INTO loyalty_observations` appears in non-test source under `apps/web/lib` and `apps/web/app` in exactly two files at HEAD | **yes** | existing | `grep -rlF 'INSERT INTO loyalty_observations' apps/web/lib apps/web/app \| grep -v '\.test\.ts$' \| sort \| tr '\n' ' '` → `apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyStore.ts ` | filled at G0 |
| T13 | Unit config collects `lib/**/*.test.ts` and the contracts tests; integration config collects `app/api/v1/**/*.test.ts` and runs files serially | **yes** | existing | `grep -c "'lib/\*\*/\*.test.ts'" apps/web/vitest.config.mts` → `1`; `grep -c "'app/api/v1/\*\*/\*.test.ts'" apps/web/vitest.integration.config.mts` → `1`; `grep -c 'fileParallelism: false' apps/web/vitest.integration.config.mts` → `1` | filled at G0 |
| T14 | Under `set -e`, a leading `!` does not abort when the negated command succeeds; this spec writes no `! cmd` guard | **yes** (hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T15 | Work happens on `main`, uncommitted, HEAD is the 42c4 commit, so `git diff HEAD` is exactly this task | **yes** | adjudicated at G0 | `[ "$(git merge-base HEAD main)" = "$(git rev-parse HEAD)" ]; echo "exit=$?"` → `exit=0`; `git status --short \| grep -v ' plan/' \| wc -l \| tr -d ' '` → `0` | filled at G0 |
| T16 | No iCloud-evicted (dataless) files in the checked trees | **yes** (hazard) | n/a | `find apps/web packages migrations db node_modules -flags +dataless -type f -not -path "*/.next/*" -not -path "node_modules/react-native*" -not -path "node_modules/@react-native*" -not -path "node_modules/@expo*" -not -path "node_modules/expo*" \| wc -l` → `0`, re-checked before each gate run | filled at G0 |
| T17 | A browser or jsdom renderer | **NO** | n/a. UI is proven by pure functions, source-scan tests and the HTTP surface script (H16) | n/a | n/a |
| T18 | Live Anthropic, Plaid, a real mailbox, non-loopback sockets, `b8_finance`, the owner's ledger | **NO** | n/a | n/a | n/a |
| T19 | `LOYALTY_IMAP_*` and `ANTHROPIC_*` unset in the gate shell; a set `LOYALTY_IMAP_` variable is refused | **yes** | n/a | `bash -c 'ANTHROPIC_API_KEY=x; unset ANTHROPIC_API_KEY; [ -z "${ANTHROPIC_API_KEY:-}" ]'; echo "exit=$?"` → `exit=0` | filled at G0 |

### Prerequisites the implementer creates
Exported names and paths below are fixed so the stub proof (command 17) can replace the files. Tests import only from these paths.
- **`apps/web/lib/domain/loyaltyScreenshot.ts`** (pure; no database, SDK, clock): `screenshotStanding(currentAsOf: string | null, asOf: string): 'current' | 'recorded_only'` (D8) and `compareScreenshot(input): { programCheck, suffixCheck, unitCheck }` (D9; each `'match' | 'mismatch' | 'not_stated'`). The input holds what the rules need: the cleaned reading, the membership's stored number (or null), its program's names and aliases, its current unit (or null) and the program's default unit.
- **Additions to `apps/web/lib/loyaltyReader.ts`**: `SCREENSHOT_SYSTEM_PROMPT` and `readLoyaltyScreenshot(image: Uint8Array, type: ReceiptType, env?: Env, deps?: { client?: Anthropic }): Promise<MailReaderResult>` (never rejects; reuses `MailReaderResult`). Behaviour in command 3's U3 to U6.
- **Routes:** `apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/route.ts` (`POST`) and `apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts` (`POST`).
- **Client and components:** `apps/web/lib/loyaltyScreenshotClient.ts`; `apps/web/components/LoyaltyScreenshotCapture.tsx`; `apps/web/components/LoyaltyScreenshotDue.tsx`; edits to `LoyaltyMembershipLine.tsx`, `LoyaltyProgramCard.tsx`, `TravelBoard.tsx` and `LoyaltyInboxReadPanel.tsx` as needed.
- **Panel:** `screenshotDue` computed in `apps/web/lib/loyaltyInboxRead.ts` inside the existing five-statement snapshot (`T42c4-I6` stays unedited and green: still exactly five statements on one client in the same order).
- **Store:** a confirm write in `apps/web/lib/loyaltyStore.ts` that appends source `screenshot` (the typed path unchanged).
- **Six new test files**, no others (command 16):
  - unit: `apps/web/lib/domain/loyaltyScreenshot.test.ts` (15 tests), `apps/web/lib/loyaltyScreenshotReader.test.ts` (4), `apps/web/lib/loyaltyScreenshotContract.test.ts` (4; it uses `import * as loyalty from '@b8/contracts/loyalty'` and reaches the schemas as `loyalty.<Name>`, so a missing export fails a test with an assertion-class `TypeError`, not an import error), `apps/web/lib/loyaltyScreenshotUi.test.ts` (3);
  - integration: `apps/web/app/api/v1/loyalty/loyaltyScreenshotDue.test.ts` (13; it imports only modules that exist today) and `apps/web/app/api/v1/loyalty/loyaltyScreenshot.test.ts` (10).
- The tests copy the helpers they need; none imports from another `*.test.ts`. They create only `ZQ42D` rows and remove every row, trigger, spy and environment change they make.
- **No fixture directory** is created or edited.

## Acceptance commands
All run from the repo root under `bash` (macOS `/bin/bash` 3.2). `U=postgresql://localhost/b8_p42a_throwaway`. No command uses a leading `!` as a guard (T14). Every command that runs tests first unsets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_PROFILE`; a command that touches the database or the surface refuses a set `LOYALTY_IMAP_` variable. File lists come from git, never a glob under `set -f`. Run order: 1 and 2, 3, then 17 early (it needs the tree complete), then the rest.

The shared first line of every carried command is:
`S=<frozen SPEC path>; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }`

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | a type error anywhere, including the new tests and the panel's new required field |
| 2 | Lint, carried (42c2 #2), below | `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, then the 26 new unit scenarios in two time zones, below | `OK unit 116 files 1456 tests`, then two lines `OK 26 scenarios … TZ=<zone>` | a missing or failing scenario; an existing unit test broken |
| 4 | 42c3 oracle, carried (42c3 #4) | two lines `OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=<zone>` | any change to the text path or pinned fixtures |
| 5 | 42c2 unit scenarios, carried (42c2 #7) | two lines `OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=<zone>` | a regression in 42c2's pure rules |
| 6 | Dependencies and importers (42c2 #4 carried unchanged) plus the additions-only guard on `loyaltyReader.ts` and `loyaltyInboxRead.ts`, below | `OK dependencies`, then `OK additions only` | a dependency, a new SDK importer, a removed or edited line in the two files |
| 7 | Schema carried (42c2 #6); no migration; contracts diff confined and comment-or-addition-only; new exports present once, below | `OK schema`, then `OK contracts` | a migration, a schema edit, a changed existing export, a missing new export |
| 8 | Integration: 42c2's block with its total set to 402, then the carried 42c3 and 42c4 scenarios and the new 23 each present once and passed in their files, then leak checks, below | `OK 402 tests, … T42c2-I1-I14 each present once and passed`, `OK T42c3-I1-I3, T42c4-I1-I6 and T42d-I1.1-I1.13, T42d-I2-I11 each present once and passed in their files`, `OK no fixture rows left`, `OK no ZQ42D rows or test triggers left` | any prior scenario regresses; a new one fails; a leaked row, trigger or function |
| 9 | Integration stability, carried (42c2 #9) | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 10 | Regression block, carried (42c2 #10) | the carried OK lines, ending `OK classes` | a 42a to 42c guarantee disturbed |
| 11 | Surface over real HTTP, rewritten for H16, below | `H1 PASS` to `H16 PASS` each once, `OK H1-H16`, `OK surface` | any page or route behaviour changed; H16 absent or failing |
| 12 | Fixture pins: 42c3 block carried, 42c2 block with the post-42c4 digest, no fixture diff, below | `fixture shape ok`, `OK new fixtures pinned and covered`, `fixture shape ok`, `OK fixtures pinned and covered`, `OK no fixture changed` | any fixture touched |
| 13 | Registry diff is exactly the two new route lines; travel page class unchanged, below | `OK registry` | a wrong class, a missing or extra line |
| 14 | Source guards, below | `OK source guards` | a clock or float, `console.`, an error text, an image written or kept, a second encoder, a ledger read, a figure in a new test, an extra writer of observations |
| 15 | Scope guard, below | `OK scope` | a file outside the allowed set changed |
| 16 | Existing tests untouched, the one contracts-test diff exact, census exact, below | `OK existing tests untouched, census exact` | an existing test edited; a wrong set or count of new tests |
| 17 | Baseline and stub proof, below | `OK due tests fail on today's sources`, `OK stubs fail every scenario`, `OK tree restored` | a vacuous scenario that passes against today's code or a no-op stub; a setup-error "failure"; a tree not restored |
| 18 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error in the routes or the client components |
| 19 | This spec's public-safety scan, below | `OK spec has no money-looking text` | a figure or long number in the spec |
| 20 | Mutation evidence, below | `OK mutation evidence rows <n>` with n at least 16 | fewer than 16 recorded mutations, or one not shown failing |

**#2 (lint, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 251 255 'set -e; O="$(mktemp)"; npm run lint' 'echo "OK lint 0 errors'
```

**#3 (unit totals, then the new unit scenarios).** The ids: `T42d-U1.1` to `U1.4`, `T42d-U2.1` to `U2.11`, `T42d-U3` to `T42d-U13`; 26 titles, each starting `T42d-<id>:` exactly once, in four files.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +116 passed \(116\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1456 passed \(1456\)' "$O")" = 1 ]
echo "OK unit 116 files 1456 tests"
for TZV in UTC Pacific/Auckland; do O2="$(mktemp)"
(cd apps/web && TZ=$TZV npx vitest run lib/domain/loyaltyScreenshot.test.ts lib/loyaltyScreenshotReader.test.ts lib/loyaltyScreenshotContract.test.ts lib/loyaltyScreenshotUi.test.ts --reporter=json --outputFile="$O2") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const ids=[];for(let i=1;i<=4;i++)ids.push("U1."+i);for(let i=1;i<=11;i++)ids.push("U2."+i);for(let i=3;i<=13;i++)ids.push("U"+i);const bad=[];for(const id of ids){const m=t.filter(x=>x.title.startsWith("T42d-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||t.length!==26||r.testResults.length!==4){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"tests="+t.length,"files="+r.testResults.length);process.exit(1)}console.log("OK 26 scenarios T42d-U1.1..U13 each present once and passed; TZ="+process.argv[2])' "$O2" "$TZV"
done
```

**#4 (42c3 oracle, carried).**
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 182 183 'set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN' 'for TZV in UTC Pacific/Auckland; do O='
```

**#5 (42c2 unit scenarios, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 397 398 'set -e; unset ANTHROPIC_API_KEY' 'for TZV in UTC Pacific/Auckland'
```

**#6 (dependencies and importers carried unchanged; additions only).** The importer list proves the screenshot reader added no new SDK importer (D5).
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 269 278 'set -e; B="$(git merge-base HEAD main)"' 'echo "OK dependencies"'
for f in apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyInboxRead.ts; do
  [ -n "$(git diff --name-only HEAD -- "$f")" ] || { echo "FAIL $f unchanged"; exit 1; }
  if git diff -U0 HEAD -- "$f" | grep -E '^-[^-]' | grep -vF 'q.query<{ waiting: number; failed: number; pending: number }>('; then echo "FAIL a line was removed or edited in $f"; exit 1; fi
done
[ "$(grep -cF 'export const READ_SCHEMA' apps/web/lib/loyaltyReader.ts)" = 1 ]
[ "$(grep -cF 'export function createMailReader' apps/web/lib/loyaltyReader.ts)" = 1 ]
[ "$(grep -cF 'export const SCREENSHOT_SYSTEM_PROMPT' apps/web/lib/loyaltyReader.ts)" = 1 ]
[ "$(grep -cF 'export async function readLoyaltyScreenshot' apps/web/lib/loyaltyReader.ts)" = 1 ]
echo "OK additions only"
```
Note: `loyaltyInboxRead.ts` may need a changed line to add the field to the returned object (`fromMail: fromMail.rows,` followed by a new line is an addition; a trailing comma is already present). If the implementer must edit an existing line there, it is an amendment to be adjudicated, not a silent change.

**#7 (schema carried; no migration; contracts diff).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 374 392 'set -e; U=postgresql://localhost/b8_p42a_throwaway' 'echo "OK schema"'
B="$(git rev-parse HEAD)"; C=packages/contracts/loyalty.ts
[ -z "$(git diff --name-only "$B" -- migrations db)" ]
[ -z "$(git ls-files -o --exclude-standard migrations db packages)" ]
[ "$(git diff --name-only "$B" -- packages | LC_ALL=C sort | tr '\n' ' ')" = "packages/contracts/loyalty.test.ts packages/contracts/loyalty.ts " ]
if git diff -U0 "$B" -- "$C" | grep -E '^-[^-]' | grep -vE '^-[[:space:]]*(\*|//|/\*)'; then echo "FAIL a non-comment line was removed or edited in $C"; exit 1; fi
for n in LOYALTY_SCREENSHOT_OUTCOMES LoyaltyScreenshotOutcomeSchema LoyaltyScreenshotReadSchema LoyaltyScreenshotReadResponseSchema LoyaltyScreenshotConfirmRequestSchema; do [ "$(grep -cE "^export const $n\b" "$C")" = 1 ] || { echo "FAIL $n not exported exactly once"; exit 1; }; done
for n in LoyaltyScreenshotOutcome LoyaltyScreenshotRead LoyaltyScreenshotConfirmRequest; do [ "$(grep -cE "^export type $n =" "$C")" = 1 ] || { echo "FAIL type $n"; exit 1; }; done
[ "$(grep -cE '^[[:space:]]*screenshotDue: ' "$C")" = 1 ]
[ "$(grep -cE "LOYALTY_OBSERVATION_SOURCES = \['typed', 'import', 'email', 'screenshot'\] as const" "$C")" = 1 ]
echo "OK contracts"
```

**#8 (integration: 42c2's block with the total 402; carried 42c3 and 42c4 families; the 23 new scenarios; leak checks).** The only edit to the carried line 407 is replacing its two `370` with `402` (370 plus 3 from 42c3 plus 6 from 42c4 plus 23 here). T5 measures the unmodified total; if it differs the orchestrator corrects 402 before freezing.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }
U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; export O U
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
G 407 "node -e 'const r=JSON.parse(require(\"fs\")"; G 408 'LEFT="$(psql '; G 409 '[ "$LEFT" = '; G 410 'echo "OK no fixture rows left"'
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
L407="$(sed -n '407p' "$S")"
[ "$(printf '%s' "$L407" | grep -o '370' | wc -l | tr -d ' ')" = 2 ]
bash -c "${L407//370/402}"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];const one=(title)=>{const m=t.filter(x=>x.title.startsWith(title));if(m.length!==1||m[0].status!=="passed")bad.push(title+"="+m.map(x=>x.status).join("/")+"("+m.length+")")};const inFile=(re,file,n)=>{const f=r.testResults.filter(x=>x.assertionResults.some(a=>re.test(a.title)));if(f.length!==1||!f[0].name.endsWith("apps/web/app/api/v1/loyalty/"+file))bad.push(String(re)+" files="+f.length);else if(f[0].assertionResults.filter(a=>re.test(a.title)).length!==n)bad.push(String(re)+" count")};for(let i=1;i<=3;i++)one("T42c3-I"+i+":");for(let i=1;i<=6;i++)one("T42c4-I"+i+":");for(let i=1;i<=13;i++)one("T42d-I1."+i+":");for(let i=2;i<=11;i++)one("T42d-I"+i+":");inFile(/^T42c3-I\d+:/,"loyaltyReadForwards.test.ts",3);inFile(/^T42c4-I\d+:/,"loyaltyReadRobust.test.ts",6);inFile(/^T42d-I1\.\d+:/,"loyaltyScreenshotDue.test.ts",13);inFile(/^T42d-I\d+:/,"loyaltyScreenshot.test.ts",10);if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("OK T42c3-I1-I3, T42c4-I1-I6 and T42d-I1.1-I1.13, T42d-I2-I11 each present once and passed in their files")' "$O"
bash -c "$(sed -n -e 408p -e 409p -e 410p "$S")"
LEFT2="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "select (select count(*) from loyalty_programs where name like 'ZQ42D%')||','||(select count(*) from household_members where display_name like 'ZQ42D%')||','||(select count(*) from loyalty_sender_domains where domain like '%zq42d%')||','||(select count(*) from pg_trigger where tgname like 'zq42d%')||','||(select count(*) from pg_proc where proname like 'zq42d%')")"
[ "$LEFT2" = "0,0,0,0,0" ] || { echo "FAIL ZQ42D leftovers: $LEFT2"; exit 1; }
echo "OK no ZQ42D rows or test triggers left"
```

**#9 (integration stability, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 416 420 'set -e; unset ANTHROPIC_API_KEY' 'bash -c '
```

**#10 (regression block, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 426 440 'set -e; unset ANTHROPIC_API_KEY' 'BODY="$(sed -n '
```
This block re-runs 42c1's TZ-pinned contracts-and-UI test files (including `packages/contracts/loyalty.test.ts`, which carries the three edited lines) and the 42b class block, so it fails if the edited test file or a registry class regresses.

**#11 (surface over real HTTP; 42c2 #11 rewritten for H16).** The carried line 451 expects `OK H1-H15` and cannot be reused; this is the same check with 16 steps. The script's additions are proven below by a removed-lines check.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
OUT="$(mktemp)"; SRC=apps/web/scripts/gifts-surface-check.mjs
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
node "$SRC" > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ] || { echo "FAIL H$i not exactly once"; exit 1; }; done
[ "$(tail -1 "$OUT")" = "OK H1-H16" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
[ "$(grep -cE "LOYALTY_IMAP_(HOST|PORT|TLS|USER|PASSWORD)" "$SRC")" -ge 5 ]
[ "$(grep -cF 'ANTHROPIC_API_KEY' "$SRC")" -ge 1 ]
[ "$(grep -cF 'ANTHROPIC_BASE_URL' "$SRC")" -ge 1 ]
[ "$(grep -cF "current = 'H16'" "$SRC")" = 1 ]
[ "$(grep -cF 'memberships/${' "$SRC")" -ge 1 ]
[ "$(grep -cF '/screenshot' "$SRC")" -ge 2 ]
if git diff -U0 HEAD -- "$SRC" | grep -E '^-[^-]' | grep -vE 'H1-H15|H15'; then echo "FAIL the script lost a line other than the summary or header mention of H15"; exit 1; fi
echo "OK surface"
```
**H16 must assert, over real HTTP for both people, with no `ANTHROPIC_API_KEY` in the server's environment:** (a) `/travel` is 200 and the phrase `Update from screenshot` occurs exactly (number of memberships on the page plus number of `screenshotDue` entries) times, where the seeded world has at least one due and one not-due membership; (b) the heading `Needs a screenshot` is present while a membership is due and absent after a screenshot confirmed for today clears the last one; (c) the read route answers 401 with no credential, 403 with a read-scope token, and 200 with outcome `disabled` for the owner and for the second user, with every data field null; (d) the confirm route answers 401, 403, then 201 for a valid body, after which `GET /api/v1/loyalty` shows that membership's `source` as `screenshot` and its id gone from `inboxRead.screenshotDue`; (e) the full member-number canary appears in none of `/travel`, `/api/v1/loyalty`, the read answer or the confirm answer; (f) the two users get identical `inboxRead.screenshotDue`; (g) H15's pinned `expectText` and `expectAbsent` still hold unchanged.

**#12 (fixture pins: 42c3 block carried; 42c2 block with its post-42c4 digest; nothing changed).**
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }
G 256 'set -e; D=apps/web/lib/fixtures/loyalty-read-forwards'; G 288 'echo "OK new fixtures pinned and covered"'
A=256; Z=288; bash -c "$(sed -n "${A},${Z}p" "$S")"
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G 574 'set -e; D=apps/web/lib/fixtures/loyalty-read; I='; G 605 'echo "OK fixtures pinned and covered"'
A=574; Z=605; BODY="$(sed -n "${A},${Z}p" "$S")"; [ "$(printf '%s' "$BODY" | grep -o 'a63773c1bd7db28be057caefbd246e2ae09b80b6ffa7774ed4b5bb04751d4cd8' | wc -l | tr -d ' ')" = 1 ]
bash -c "${BODY//a63773c1bd7db28be057caefbd246e2ae09b80b6ffa7774ed4b5bb04751d4cd8/67570ee60b87555ce5e21df4194b138740805caabd4584dbe2bef343b37027ca}"
[ -z "$(git diff --name-only HEAD -- apps/web/lib/fixtures)" ]
[ -z "$(git ls-files -o --exclude-standard apps/web/lib/fixtures)" ]
echo "OK no fixture changed"
```

**#13 (registry: exactly two new route lines; the travel page class unchanged).**
```
set -ef; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs
D="$(git diff -U0 HEAD -- "$R" | grep -E '^[+-][^+-]' | LC_ALL=C sort | tr '\n' '|')"
E="+  { file: 'app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts', classes: ['numeric-only'] },|+  { file: 'app/api/v1/loyalty/memberships/[id]/screenshot/route.ts', classes: ['no-transaction-data'] },|"
[ "$D" = "$E" ] || { echo "FAIL registry diff is not exactly the two route lines: $D"; exit 1; }
p="{ file: 'app/travel/page.tsx', classes: ['numeric-only'] },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]
p="'app/travel/page.tsx': { cls: 'numeric-only', url: () => '/travel' },"; [ "$(grep -cF -- "$p" "$X")" = 1 ]
[ "$(grep -cF "app/api/v1/loyalty/memberships/[id]/observations/route.ts', classes: ['numeric-only']" "$R")" = 1 ]
echo "OK registry"
```
The gift-surface wiring test `T41b-W4` (in the unit suite, command 3) additionally proves the registry lists exactly the `route.ts` files on disk.

**#14 (source guards).** Several guards fail on today's tree on purpose (the new files do not exist).
```
set -ef; B="$(git rev-parse HEAD)"
NEW="apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/route.ts apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts apps/web/lib/domain/loyaltyScreenshot.ts apps/web/lib/loyaltyScreenshotClient.ts apps/web/components/LoyaltyScreenshotCapture.tsx apps/web/components/LoyaltyScreenshotDue.tsx"
CHG="apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyStore.ts apps/web/components/LoyaltyMembershipLine.tsx apps/web/components/LoyaltyProgramCard.tsx apps/web/components/TravelBoard.tsx apps/web/components/LoyaltyInboxReadPanel.tsx"
TESTS="apps/web/lib/domain/loyaltyScreenshot.test.ts apps/web/lib/loyaltyScreenshotReader.test.ts apps/web/lib/loyaltyScreenshotContract.test.ts apps/web/lib/loyaltyScreenshotUi.test.ts apps/web/app/api/v1/loyalty/loyaltyScreenshotDue.test.ts apps/web/app/api/v1/loyalty/loyaltyScreenshot.test.ts"
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
for f in $NEW $TESTS; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
for f in $CHG; do [ -n "$(git diff --name-only "$B" -- "$f")" ] || [ "$f" = apps/web/components/LoyaltyProgramCard.tsx ] || { echo "FAIL $f was not changed"; exit 1; }; done
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|parseInt|toFixed|Math\.round'
for f in $NEW $CHG $TESTS; do
  [ ! -f "$f" ] && continue
  if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi
  if added "$f" | grep -nE '^[[:space:]]*(//|/\*|\*)' | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment of $f"; exit 1; fi
done
for f in $NEW $CHG; do
  if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
  if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
  if added "$f" | grep -nE 'receipt_captures|createCapture|writeFile|createWriteStream|localStorage|sessionStorage|indexedDB|caches\.|FormData|raw_mail'; then echo "FAIL the image may be kept or written in $f"; exit 1; fi
  if added "$f" | grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+(transactions|accounts|account_valuations)([^[:alnum:]_]|$)|visibleTransactions'; then echo "FAIL a ledger read in $f"; exit 1; fi
done
for f in $NEW apps/web/components/LoyaltyMembershipLine.tsx apps/web/components/TravelBoard.tsx apps/web/components/LoyaltyInboxReadPanel.tsx; do
  [ ! -f "$f" ] && continue
  if added "$f" | grep -nE 'createImageBitmap|toBlob|getContext\('; then echo "FAIL a second image encoder in $f"; exit 1; fi
done
[ "$(grep -cE "from '@/lib/receiptUpload'" apps/web/components/LoyaltyScreenshotCapture.tsx apps/web/lib/loyaltyScreenshotClient.ts | grep -vc ':0$')" -ge 1 ]
[ "$(grep -cF 'checkReceipt' "apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/route.ts")" -ge 1 ]
if grep -nE '4 \* 1024|MAX_RECEIPT_BYTES =' $NEW; then echo "FAIL a second size bound"; exit 1; fi
[ "$(added apps/web/lib/loyaltyReader.ts | grep -c 'maxRetries: 0')" -ge 2 ]
M="$(grep -rlF 'INSERT INTO loyalty_observations' apps/web/lib apps/web/app | grep -v '\.test\.ts$' | sort | tr '\n' ' ')"
[ "$M" = "apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyStore.ts " ]
[ "$(grep -cE "'screenshot'" apps/web/lib/loyaltyStore.ts)" -ge 1 ]
if git diff "$B" -- apps/web/app/manifest.ts | grep -q .; then echo "FAIL the manifest changed"; exit 1; fi
for IT in apps/web/lib/loyaltyScreenshotReader.test.ts apps/web/lib/loyaltyScreenshotContract.test.ts apps/web/lib/loyaltyScreenshotUi.test.ts apps/web/lib/domain/loyaltyScreenshot.test.ts apps/web/app/api/v1/loyalty/loyaltyScreenshotDue.test.ts apps/web/app/api/v1/loyalty/loyaltyScreenshot.test.ts; do
  if grep -nE "['\"][-]?[0-9]+\.[0-9]{2,4}['\"]" "$IT"; then echo "FAIL a decimal figure literal in $IT"; exit 1; fi
  if grep -nE "['\"][0-9]{4,}['\"]" "$IT"; then echo "FAIL a digit-only quoted string of four or more digits in $IT"; exit 1; fi
done
echo "OK source guards"
```

**#15 (scope guard).**
```
set -f; B="$(git rev-parse HEAD)"; [ "$B" = "$(git merge-base HEAD main)" ]
CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
OUT="$(grep -vE '^(apps/web/lib/loyalty\.test\.ts|apps/web/app/api/v1/loyalty/loyalty(Card|Earn|Inbox|Read)?\.test\.ts|packages/contracts/loyalty\.ts|packages/contracts/loyalty\.test\.ts|apps/web/lib/loyaltyReader\.ts|apps/web/lib/loyaltyInboxRead\.ts|apps/web/lib/loyaltyStore\.ts|apps/web/lib/domain/loyaltyScreenshot\.ts|apps/web/lib/domain/loyaltyScreenshot\.test\.ts|apps/web/lib/loyaltyScreenshotClient\.ts|apps/web/lib/loyaltyScreenshotReader\.test\.ts|apps/web/lib/loyaltyScreenshotContract\.test\.ts|apps/web/lib/loyaltyScreenshotUi\.test\.ts|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/scripts/gifts-surface-check\.mjs|apps/web/app/api/v1/loyalty/memberships/\[id\]/screenshot/route\.ts|apps/web/app/api/v1/loyalty/memberships/\[id\]/screenshot/confirm/route\.ts|apps/web/app/api/v1/loyalty/loyaltyScreenshot\.test\.ts|apps/web/app/api/v1/loyalty/loyaltyScreenshotDue\.test\.ts|apps/web/components/LoyaltyScreenshotCapture\.tsx|apps/web/components/LoyaltyScreenshotDue\.tsx|apps/web/components/LoyaltyMembershipLine\.tsx|apps/web/components/LoyaltyProgramCard\.tsx|apps/web/components/TravelBoard\.tsx|apps/web/components/LoyaltyInboxReadPanel\.tsx)$' "$CH" || true)"
[ -z "$OUT" ] || { echo "OUTSIDE THE ALLOWED SET:"; echo "$OUT"; exit 1; }
for f in packages/contracts/loyalty.ts packages/contracts/loyalty.test.ts apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyStore.ts apps/web/lib/domain/loyaltyScreenshot.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/scripts/gifts-surface-check.mjs apps/web/components/LoyaltyScreenshotCapture.tsx apps/web/components/LoyaltyScreenshotDue.tsx apps/web/components/TravelBoard.tsx; do grep -qxF "$f" "$CH" || { echo "MISSING $f"; exit 1; }; done
[ -z "$(git diff --name-only "$B" -- migrations db apps/web/package.json package.json package-lock.json 'apps/web/vitest*' 'apps/web/eslint*' eslint.config.mjs evals apps/web/app/manifest.ts apps/web/lib/receipt.ts apps/web/lib/receiptReader.ts apps/web/lib/receiptUpload.ts apps/web/lib/receiptCaptureClient.ts apps/web/lib/receiptCaptureStore.ts apps/web/app/api/v1/receipts apps/web/app/receipts apps/web/app/travel apps/web/lib/domain/loyaltyRead.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/scheduler.ts apps/web/lib/fixtures apps/web/app/api/v1/loyalty/memberships/\[id\]/observations)" ] || { echo "FAIL a frozen file changed"; exit 1; }
echo "OK scope"
```

**#16 (existing tests untouched; the contracts-test diff exact; census exact).**
```
set -f; B="$(git rev-parse HEAD)"
[ -z "$(git diff --name-only "$B" -- '*.test.ts' '*.test.tsx' '*.test.mts' | grep -vxF -e packages/contracts/loyalty.test.ts -e apps/web/lib/loyalty.test.ts -e apps/web/app/api/v1/loyalty/loyalty.test.ts -e apps/web/app/api/v1/loyalty/loyaltyCard.test.ts -e apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts -e apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts -e apps/web/app/api/v1/loyalty/loyaltyRead.test.ts || true)" ] || { echo "FAIL a tracked test file other than the contracts test and the A2 route-count pins changed"; exit 1; }
[ "$(git diff -U0 "$B" -- apps/web/lib/loyalty.test.ts apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/app/api/v1/loyalty/loyaltyRead.test.ts | grep -E '^[+-][^+-]' | shasum -a 256 | cut -d' ' -f1)" = 5c7a6f1d0a66288565ce3632e7cb47cfa7ac7c91f09059fc05c390593c375a83 ] || { echo "FAIL the A2 route-count pins differ from the orchestrator's edit"; exit 1; }
CT=packages/contracts/loyalty.test.ts
[ "$(git diff -U0 "$B" -- "$CT" | grep -cE '^-[^-]')" = 2 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -cE '^\+[^+]')" = 3 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^-[^-]' | grep -cF 'expect(responses.length).toBe(9);')" = 1 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^\+[^+]' | grep -cF 'expect(responses.length).toBe(10);')" = 1 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^\+[^+]' | grep -cF 'screenshotDue: [],')" = 2 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^-[^-]' | grep -vF 'expect(responses.length)')" = "-  readable: false, lastRead: null, waiting: 0, failed: 0, needsAttentionTotal: 0, needsAttention: [], coverage: [], fromMail: []," ] || { echo "FAIL the removed line is not the EMPTY_READ literal"; exit 1; }
NEW="$(git ls-files -o --exclude-standard | grep -E '\.test\.(ts|tsx|mts)$' | sort | tr '\n' ' ')"
[ "$NEW" = "apps/web/app/api/v1/loyalty/loyaltyScreenshot.test.ts apps/web/app/api/v1/loyalty/loyaltyScreenshotDue.test.ts apps/web/lib/domain/loyaltyScreenshot.test.ts apps/web/lib/loyaltyScreenshotContract.test.ts apps/web/lib/loyaltyScreenshotReader.test.ts apps/web/lib/loyaltyScreenshotUi.test.ts " ] || { echo "FAIL the set of new test files is wrong: $NEW"; exit 1; }
cnt(){ [ "$(grep -cE "^[[:space:]]*(it|test)\(" "$1")" = "$2" ] || { echo "FAIL $1 does not hold exactly $2 tests"; exit 1; }; [ "$(grep -cE "^[[:space:]]*(it|test)\('T42d-$3" "$1")" = "$2" ] || { echo "FAIL $1 titles do not all start T42d-$3"; exit 1; }; }
cnt apps/web/lib/domain/loyaltyScreenshot.test.ts 15 U
cnt apps/web/lib/loyaltyScreenshotReader.test.ts 4 U
cnt apps/web/lib/loyaltyScreenshotContract.test.ts 4 U
cnt apps/web/lib/loyaltyScreenshotUi.test.ts 3 U
cnt apps/web/app/api/v1/loyalty/loyaltyScreenshotDue.test.ts 13 I1
cnt apps/web/app/api/v1/loyalty/loyaltyScreenshot.test.ts 10 I
echo "OK existing tests untouched, census exact"
```

**#17 (baseline and stub proof).** Part A puts today's `loyaltyInboxRead.ts` back and runs the 13 due scenarios, which import only existing modules, so every one must fail on an assertion. Part B replaces each new source file with the smallest plausible no-op (a route answering 200 with `data: null`, always-`current`/`not_stated` rules, a reader that always fails, empty components, today's contracts file) and runs the other scenarios; each must fail on an assertion, so no stub passes. The failure text must not be a setup error. The tree is restored by absolute path and proven restored by a checksum. `[` and `]` in route paths are quoted throughout.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
ROOT="$(pwd)"; K="$(mktemp -d)"; U=postgresql://localhost/b8_p42a_throwaway; : > "$K/list"
SNAP(){ { git diff HEAD; git ls-files -o --exclude-standard | grep -v '^plan/' | sort | while IFS= read -r f; do printf '%s\n' "$f"; cat "$f"; done; } | cksum; }
S0="$(SNAP)"
swap(){ mkdir -p "$K/$(dirname "$2")"; cp "$2" "$K/$2"; printf '%s\n' "$2" >> "$K/list"
  case "$1" in
    head) git show "HEAD:$2" > "$2";;
    empty) : > "$2";;
    route) printf '%s\n' 'export async function POST() { return Response.json({ success: true, data: null }); }' > "$2";;
    domain) printf '%s\n' "export const screenshotStanding = () => 'current';" "export const compareScreenshot = () => ({ programCheck: 'not_stated', suffixCheck: 'not_stated', unitCheck: 'not_stated' });" > "$2";;
    reader) { git show "HEAD:$2"; printf '%s\n' 'export const SCREENSHOT_SYSTEM_PROMPT = "";' 'export async function readLoyaltyScreenshot() { return { ok: false, code: "api_error" }; }'; } > "$2";;
  esac; }
restore(){ while IFS= read -r f; do [ -n "$f" ] && cp "$K/$f" "$ROOT/$f"; done < "$K/list"; : > "$K/list"; }
trap restore EXIT
SETUP='ECONNREFUSED|Cannot find module|Failed to resolve|SyntaxError|is not defined|is not a function|is not a constructor|ENOENT'
check(){ node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const want=process.argv[2].split(" ");const bad=[];for(const w of want){const m=t.filter(x=>x.title.startsWith(w+":"));if(m.length!==1||m[0].status!=="failed"){bad.push(w+"="+m.map(x=>x.status).join("/")+"("+m.length+")");continue}if(new RegExp(process.argv[3]).test(m[0].failureMessages.join(" ")))bad.push(w+" failed on a setup error, not an assertion")}if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("ok "+want.length+" scenarios fail as required")' "$1" "$2" "$SETUP"; }
# Part A: today's panel code; the 13 due scenarios must fail on assertions
OA="$(mktemp)"; swap head apps/web/lib/loyaltyInboxRead.ts
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyScreenshotDue.test.ts --reporter=json --outputFile="$OA") || true
restore
check "$OA" "T42d-I1.1 T42d-I1.2 T42d-I1.3 T42d-I1.4 T42d-I1.5 T42d-I1.6 T42d-I1.7 T42d-I1.8 T42d-I1.9 T42d-I1.10 T42d-I1.11 T42d-I1.12 T42d-I1.13"
echo "OK due tests fail on today's sources"
# Part B1: no-op routes, rules and reader; the route, rule and reader scenarios must fail
OB="$(mktemp)"
swap route "apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/route.ts"; swap route "apps/web/app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts"
swap domain apps/web/lib/domain/loyaltyScreenshot.ts; swap reader apps/web/lib/loyaltyReader.ts
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyScreenshot.test.ts --reporter=json --outputFile="$OB") || true
OC="$(mktemp)"; (cd apps/web && npx vitest run lib/domain/loyaltyScreenshot.test.ts lib/loyaltyScreenshotReader.test.ts --reporter=json --outputFile="$OC") || true
restore
check "$OB" "T42d-I2 T42d-I3 T42d-I4 T42d-I5 T42d-I6 T42d-I7 T42d-I8 T42d-I9 T42d-I10 T42d-I11"
check "$OC" "T42d-U1.1 T42d-U1.4 T42d-U2.1 T42d-U2.2 T42d-U2.5 T42d-U2.8 T42d-U3 T42d-U4 T42d-U5 T42d-U6"
# Part B2: today's contracts; the contract scenarios must fail
OD="$(mktemp)"; swap head packages/contracts/loyalty.ts
(cd apps/web && npx vitest run lib/loyaltyScreenshotContract.test.ts --reporter=json --outputFile="$OD") || true
restore
check "$OD" "T42d-U7 T42d-U8 T42d-U9 T42d-U10"
# Part B3: today's components and empty new ones; the UI scenarios must fail
OE="$(mktemp)"
swap head apps/web/components/LoyaltyMembershipLine.tsx; swap head apps/web/components/TravelBoard.tsx; swap head apps/web/components/LoyaltyInboxReadPanel.tsx
swap empty apps/web/components/LoyaltyScreenshotCapture.tsx; swap empty apps/web/components/LoyaltyScreenshotDue.tsx; swap empty apps/web/lib/loyaltyScreenshotClient.ts
(cd apps/web && npx vitest run lib/loyaltyScreenshotUi.test.ts --reporter=json --outputFile="$OE") || true
restore
check "$OE" "T42d-U11 T42d-U12 T42d-U13"
echo "OK stubs fail every scenario"
[ "$S0" = "$(SNAP)" ] || { echo "FAIL the implementer's tree was not restored"; exit 1; }
echo "OK tree restored"
```
The scenarios not listed in Part B (`T42d-U1.2`, `U1.3`, `U2.3`, `U2.4`, `U2.6`, `U2.7`, `U2.9` to `U2.11`) assert values a constant stub can legitimately return (`current`, `not_stated`); they are covered by commands 3 and 20's mutations instead. Part A cannot use a stub for the panel because the panel's other fields are real; today's file is the honest baseline.

**#19 (this spec's public-safety scan).**
```
set -e; S=plan/tasks/P8-42d-loyalty-screenshot/SPEC.md; T="$(mktemp)"; sed -E 's/[0-9a-f]{64}//g' "$S" > "$T"
if grep -nE '\$[0-9]{3,}|\$[0-9]{1,3},[0-9]{3}|\$[0-9]+\.[0-9]{2}' "$T"; then echo "FAIL a dollar figure in the spec"; exit 1; fi
if grep -nE '[0-9]{1,3}(,[0-9]{3})+' "$T"; then echo "FAIL a thousands-separated figure in the spec"; exit 1; fi
BAD="$(grep -oE '[0-9]{6,}' "$T" | sort -u || true)"
[ -z "$BAD" ] || { echo "FAIL a long number in the spec: $BAD"; exit 1; }
if grep -nEi 'member number [0-9]|balance of [0-9]' "$T"; then echo "FAIL a balance or number stated in the spec"; exit 1; fi
echo "OK spec has no money-looking text"
```

**#20 (mutation evidence).** The implementer records in `plan/tasks/P8-42d-loyalty-screenshot/EVIDENCE.md` one row per deliberate single-line break: `| M<n> | <file and change in words> | <failing test id> | FAIL | reverted, green |`.
```
set -e; E=plan/tasks/P8-42d-loyalty-screenshot/EVIDENCE.md
[ -f "$E" ]
N="$(grep -cE '^\| M[0-9]+ \|.*\| FAIL \|.*reverted' "$E")"
[ "$N" -ge 16 ] || { echo "FAIL only $N mutation rows with FAIL and reverted"; exit 1; }
for id in T42d-I1.2 T42d-I1.5 T42d-I1.12 T42d-I2 T42d-I3 T42d-I5 T42d-I6 T42d-I8 T42d-I9 T42d-I10 T42d-I11 T42d-U1.3 T42d-U2.2 T42d-U4 T42d-U5 T42d-U12; do grep -qF "$id" "$E" || { echo "FAIL no mutation row names $id"; exit 1; }; done
if grep -nE '\$[0-9]{3,}|[0-9]{1,3}(,[0-9]{3})+' "$E"; then echo "FAIL EVIDENCE.md holds a money-looking figure"; exit 1; fi
echo "OK mutation evidence rows $N"
```

### What was not carried, and why
- 42c4's #7 (comment-only contracts), #12's last line (the fixture one-line diff, now empty at HEAD), #13 (registry unchanged), #14 to #17 and #19/#20 pin 42c4's own change set; their intent is rewritten as commands 7, 12, 13, 14, 15, 16, 17 and 19 here.
- 42c2's #11 is replaced by command 11 (H1 to H16); its source-grep lines are kept.
- 42c2's #5 (migration up-down-up) is not re-run: no migration; commands 7 and 15 prove it.
- `T42c3-I1-I3` and `T42c4-I1-I6` run inside command 8 and are asserted present and passed, so the 42c4 snapshot, rollback and read-robustness guarantees are re-proven on the new code.

## Scenarios
Fixture canary `ZQ42D`. Each integration scenario seeds what it asserts on and removes it; fault or interleave means are installed and removed in a `finally`. The model is faked at the SDK client or `createMailReader`/`readLoyaltyScreenshot` seam; its raw answers are fabricated objects, including injected keys (`name`, `address`, `note`) and a full printed member number in the suffix field. A `ZQ42D` image is a few generated bytes with a JPEG, PNG or WebP signature. Captured console lines are the whole file's, each a JSON line with `level`, `scope`, `message`.

### Unit scenarios (no database)
| Id | Observable rule | Setup and assertion | Catches |
|---|---|---|---|
| T42d-U1.1 to U1.4 | **D8 standing.** `screenshotStanding(current, asOf)`: U1.1 no current balance → `current`; U1.2 asOf later than current → `current`; U1.3 asOf equal to current → `current`; U1.4 asOf earlier → `recorded_only`. | Pure string dates, no clock. | equal treated as older; always current; always recorded-only |
| T42d-U2.1 to U2.3 | **D9 program check.** U2.1 stated form equal, containing or contained by the form of the program name or any alias → `match`; U2.2 a different program → `mismatch`; U2.3 no name stated → `not_stated`. | Names and aliases fabricated; punctuation and case ignored. | a mismatch downgraded; a missing name flagged |
| T42d-U2.4 to U2.7 | **D9 suffix check.** U2.4 the stored number, normalised to upper-case letters and digits, ends with the read suffix → `match`; U2.5 it does not → `mismatch`; U2.6 the membership has no stored number and the screenshot shows a suffix → `not_stated`; U2.7 no suffix read → `not_stated`. | Stored numbers include dashes and spaces; the suffix has 3 and 4 characters. | formatting breaking a match; a numberless membership warned |
| T42d-U2.8 to U2.10 | **D9 unit check.** U2.8 read unit differs from the membership's current unit → `mismatch`; U2.9 with no observation the program's default unit is the comparison; U2.10 no balance/unit read → `not_stated`. | Four units tried. | comparing against the wrong unit; a unitless read warned |
| T42d-U2.11 | **Parity with 42c2.** For a table of fabricated names and aliases, the screenshot program check gives the same answer as `programCheck` from `lib/domain/loyaltyRead.ts`. | Containment both ways, punctuation, empty, long names. | the two rules drifting |
| T42d-U3 | **No key, nothing sent.** `readLoyaltyScreenshot` with no usable key and a fake client counting calls: result `{ ok: false, code: 'api_error' }`, zero calls, no client built. | Unset and blank key. | a request sent without a key |
| T42d-U4 | **One bounded request, only the image.** With a fake client: exactly one `messages.create`; the user message has exactly two content blocks, an image block whose base64 decodes to the input bytes with the given `media_type`, then one text block; the system prompt is `SCREENSHOT_SYSTEM_PROMPT`, which says the image is untrusted (matches `untrusted` and `never follow`) and asks for no name, address or full number; `output_config.format.schema` deep-equals `READ_SCHEMA`; request options carry `maxRetries` 0 and a timeout from `readTimeoutSeconds`; no household string (a canary program name, member name, number, id) appears anywhere in the request body. | Canaries are passed through the test's world so a leak is visible. | household data sent; a hidden retry; a different schema; an unbounded call |
| T42d-U5 | **Every failure classified, none leaks.** Rate limit → `rate_limited`; connection timeout → `timeout`; other thrown error → `api_error`; `stop_reason` refusal → `refused`; empty or invalid JSON text → `bad_output`. Captured logs contain none of: the error text canary, the image base64, the key, the model's text. | Fake errors carry canary text. | an error text or image in a log; a throw escaping |
| T42d-U6 | **Success returns the model's object untouched, logs only model and tokens.** The raw answer (with injected keys) is returned as `reading` unchanged; the one `info` line has fields limited to `time`, `level`, `scope`, `message`, `model`, `inputTokens`, `outputTokens`. | Fake usage numbers. | cleaning in the wrong layer; a value in a log |
| T42d-U7 | **Read answer schema.** Accepts a full `read`, a `read` with everything null (nothing readable), `disabled` and `error` with each code. Refuses: an unknown key (`name`, `memberNumber`, `image`, `subject`); `error` without a code; a code on a non-error outcome; balance without unit; a balance not canonical for its unit (fraction on a whole unit, one or three decimals on `usd`, a sign, grouping); `disabled` or `error` carrying data or a non-`not_stated` check; `unitCheck` other than `not_stated` with a null unit; a suffix that is not four bullets plus 3 or 4 characters; arrays above their maxima. | Table of valid and invalid objects. | a loose schema that would let a name or image through |
| T42d-U8 | **Confirm request schema.** Accepts `{ asOf, balance, unit }` valid for its unit. Refuses `source` (any value), `image`, extra keys, a bad calendar date, a non-canonical balance, a missing key; the first issue's message never contains the submitted value. | Same canonical table as the typed schema. | a client claiming a source; echoing input |
| T42d-U9 | **Panel `screenshotDue`.** Accepts `[]` and strictly ascending positive integers; refuses a missing key, a repeat, a descending pair, `0`, a negative, a fraction, `null`. | Table. | a null-for-none; duplicates |
| T42d-U10 | **Envelope and exports.** The read response wrapper accepts a success carrying a valid answer and a failure envelope; `LOYALTY_SCREENSHOT_OUTCOMES` is exactly `read`, `disabled`, `error`; the typed observation request still refuses `source: screenshot`. | Namespace import; each export is read by name. | a renamed export; the typed refusal loosened |
| T42d-U11 | **Capture path (source scan).** `LoyaltyScreenshotCapture.tsx` (or the client it imports) imports `shrinkReceipt` from `@/lib/receiptUpload`, sends the resulting Blob with `Content-Type: image/jpeg` to the membership's screenshot route, and holds no `FormData`, browser storage, cache or second encoder; the file input is created per tap and the Blob is not stored in component state after the request. | Reads the source text. | a second encoder; the image kept in the browser |
| T42d-U12 | **Form wording (source scan).** Each pinned string occurs exactly once in the new components: `Update from screenshot`, `Save balance`, `Save anyway`, `The screenshot looks like a different program.`, `The member number on the screenshot does not match this membership.`, `The unit differs from the one on file.`, `This is older than the balance on file. It will be recorded but will not replace it.`, `Nothing could be read from that screenshot. Enter the balance by hand.`, `Screenshot reading is not set up. Enter the balance by hand.`, `The screenshot could not be read right now. Try again, or enter the balance by hand.`; the form calls `screenshotStanding` and the older warning is conditioned on its result; `Save anyway` is conditioned on a `mismatch`; confirm is disabled while saving; a null balance leaves the field empty (no `?? 0`, no `|| 0`). | Reads the source text. | a block instead of a warning; a zero pre-fill; a missing older-than warning |
| T42d-U13 | **Needs-a-screenshot section (source scan).** `Needs a screenshot` and `The inbox is not bringing balances for this program.` each occur once in the new component; the section renders only when `screenshotDue` is non-empty; it is a separate element from the existing queue block, whose strings `Needs attention: ` and `Nothing needs attention` are still present once in `LoyaltyInboxReadPanel.tsx` and not conditioned on the new list. | Reads the source text. | the queue's carried wording changed or suppressed |

### Integration scenarios (route handlers and the panel, throwaway DB, fabricated data)
Day arithmetic is Postgres `CURRENT_DATE - n`, written by the test; `T` is 45. "Due" is membership membership-id membership in `inboxRead.screenshotDue` from the real overview, and coverage is whatever `inboxRead.coverage` says for the program in the same response.

| Id | Observable rule | Setup and assertion | Catches |
|---|---|---|---|
| T42d-I1.1 | **R1.** Program with no sender domain; current observation 46 days old → due. | One membership. | a stale, serverless-inbox membership never prompted |
| T42d-I1.2 | **R2 boundary.** Same, observation exactly 45 days old → not due. | | `>=` instead of `>` |
| T42d-I1.3 | **R3.** No domain, no observation → due. | | "—" never prompted |
| T42d-I1.4 | **R4 negative control.** Domain, coverage `yes`, domain last seen 3 days ago, observation 200 days old → not due. | A reads row in `applied` state carrying a balance. | a program the inbox serves being nagged |
| T42d-I1.5 | **R5.** Domain, coverage `yes`, last seen 46 days ago, observation 100 days old → due. | | an inbox gone quiet not noticed |
| T42d-I1.6 | **R6 boundary.** As R5 with last seen exactly 45 days ago → not due. | | boundary off by one |
| T42d-I1.7 | **R7.** Domain, coverage `no` (newest settled read carried no balance), last seen 3 days ago, observation 46 days old → due. | A `no_balance` reads row. | coverage ignored |
| T42d-I1.8 | **R8 negative control.** As R7 with observation 10 days old → not due. | | an old-balance test applied without an age test |
| T42d-I1.9 | **R9.** Domain, coverage `not_read` (nothing read), observation 46 days old → due. | | `not_read` treated as `yes` |
| T42d-I1.10 | **R10.** Domain, coverage `yes`, `last_seen_on` null, observation 100 days old → due. | | null date treated as recent |
| T42d-I1.11 | **R11 per membership.** One program, no domain, two memberships (current observation 46 days old; 3 days old) → only the old one is due. | | program-level instead of membership-level |
| T42d-I1.12 | **R13 no duplicate.** A program with three sender domains and one due membership → listed once. | | a JOIN on domains repeating the id |
| T42d-I1.13 | **Shape and agreement.** For the whole world above in one overview: `screenshotDue` is strictly ascending; every id exists; the answer from `GET /api/v1/loyalty` parses with `LoyaltyOverviewResponseSchema`; the owner and the second user get identical `screenshotDue`; each due decision agrees with the `coverage` entries shown in the same response; a membership whose current observation is dated tomorrow is not due; the overview was produced with no ledger row read (the existing panel guard). | Both users. | mixed snapshots; a viewer-dependent list |
| T42d-I2 | **Read route: caller first, then the membership, then the body.** No credential → 401 and a read-scope token → 403 `INSUFFICIENT_SCOPE`, neither pulling the body stream (a flag on the stream's `pull`); a malformed id → 400; an unknown membership → 404 `NOT_FOUND`; in all four the fake reader was called 0 times and no row anywhere changed. | A body stream that records whether it was read. | the body read before authorisation; a paid call for a nonexistent membership |
| T42d-I3 | **Read route: the image check.** An empty body → 400 `INVALID_INPUT`; text bytes claiming `image/jpeg` → 400; a body one byte over `MAX_RECEIPT_BYTES` → 413 with code `INVALID_INPUT`; a body of exactly `MAX_RECEIPT_BYTES` bytes with a JPEG signature → accepted (outcome `disabled` with no key); PNG and WebP signatures accepted; a body whose stream errors while being read → 400 `INVALID_INPUT` with a fixed sentence echoing nothing. In every refusal the reader was called 0 times. | Generated bytes. | the header trusted over the bytes; an oversize image sent to the model; a failed body read starting a read |
| T42d-I4 | **No key, nothing sent.** With `ANTHROPIC_API_KEY` unset and a fake SDK constructor counting calls: a valid image → 200, outcome `disabled`, `errorCode` null, every data field null, arrays empty, all checks `not_stated`; the constructor and the reader were never called; the answer parses with `LoyaltyScreenshotReadResponseSchema`. | | an outbound request without a key |
| T42d-I5 | **A read is cleaned and compared, and leaks nothing.** Key set (a canary value), the fake answers a full raw object: program name matching the membership's, a printed full member number in `memberNumberSuffix`, a grouped balance, a unit, a date, an expiry warning, an instrument, plus injected keys. → 200 `read`; `balance` is the canonical text, `unit`, `asOf` as read; `maskedSuffix` is four bullets plus the last four characters only; the three checks `match`; the arrays are the cleaned ones; the response body contains neither the full printed number, nor the membership's stored number, nor the member's display name, nor any injected key's value, nor the key canary. A comma-decimal balance (`12,50`) and a balance with a unit missing come back null (never rounded). A zero balance comes back as `0`. | Canaries for number, name, injected text. | the clean pass skipped; a full number or name in the answer; rounding; a zero turned into null |
| T42d-I6 | **Disagreements are reported, alone and together, and never block.** Reads built to differ in program only, suffix only, unit only, and all three: the matching check is `mismatch`, the others as expected, status 200 each; a read that states no program, no suffix, no unit gives `not_stated`; a membership with no stored number plus a read suffix gives `not_stated`; nothing was written in any case. | Four memberships (one without a number). | a mismatch refused; a mismatch hidden; a numberless membership warned |
| T42d-I7 | **A failed read is an answer, not an error.** The fake returns each of `rate_limited`, `timeout`, `api_error`, `refused`, `bad_output`, and once throws: HTTP 200, outcome `error`, that code (a throw is `api_error`), every data field null, all checks `not_stated`; the model's own text (a canary) appears nowhere in the response or logs. | | a 500; an error text echoed |
| T42d-I8 | **The read stores and logs nothing.** Around the calls of I4 to I7: the row count of every table in the `public` schema is unchanged (including `receipt_captures`, `loyalty_observations`, `loyalty_inbox_reads`, `loyalty_inbox_read_state`), `GET /api/v1/loyalty` shows the same balance and observation count for the membership before and after, and the captured logs contain none of: the image's base64, the printed number, the stored number, the suffix, a balance, the member's name, the key, the model's text. Log lines carry only the fields `time`, `level`, `scope`, `message` plus `model`, `inputTokens`, `outputTokens` or `code` and `status`. | Every table counted by catalog query. | an observation written on read; the image or a proposal stored; a value logged |
| T42d-I9 | **Confirm route: caller first; strict body; nothing written on refusal.** No credential 401, read-scope token 403, malformed id 400, unknown membership 404; bodies with `source` (any value), `image`, extra keys, a non-canonical balance for the unit, a third `usd` decimal, a fraction on a whole unit, a bad date, an as-of two days after `CURRENT_DATE` → 400, and the error text echoes nothing submitted. After each refusal `loyalty_observations` is unchanged. | | a client choosing its source; a future date accepted; echoing |
| T42d-I10 | **Confirm appends one `screenshot` observation; newest as-of wins.** A valid body → 201, the membership view; the new row's `source` is `screenshot` and its balance, unit and as-of are the confirmed values (exact text); the member number is absent from the response. With no prior observation, with an earlier current as-of, and with an equal current as-of, the view's balance is the new one and its source `screenshot`. With a strictly later current as-of, the row is stored and the view's balance, unit, as-of and source are the previous reading's. The typed route afterwards still writes `typed` and still refuses `source: screenshot` with 400. One row per confirm, never two. | Both users confirm. | source `typed`; an older reading becoming current; two rows; a typed regression |
| T42d-I11 | **Confirm clears the prompt; an older one does not.** A due membership (46 days old, no domain) confirmed with today's as-of leaves `screenshotDue`; a second due membership confirmed with an as-of 50 days old stays in it (the older row is recorded but not current); a due membership with no observation confirmed with today's leaves it too. The member number canary is in none of the responses or logs. | Two memberships. | the prompt never clearing; an older reading clearing it |

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | The caller is resolved before anything is read | no credential; a read-scope token; the body stream is never pulled and the reader never called | T42d-I2, T42d-I9 |
| 2 | Only bytes that are a JPEG, PNG or WebP within `MAX_RECEIPT_BYTES` are sent | empty body; text bytes labelled `image/jpeg`; one byte over the bound; an erroring stream | T42d-I3 |
| 3 | Nothing is sent without a key | no `ANTHROPIC_API_KEY`: constructor and reader never called | T42d-U3, T42d-I4 |
| 4 | Only the image and a fixed instruction go to Anthropic | a request body that holds a canary program name, member name, number, id or balance | T42d-U4 |
| 5 | The model's output is never trusted | injected keys, a full printed number, a comma-decimal balance, a balance with no unit | T42d-I5, T42d-I7 |
| 6 | A full member number and a member name never leave the server | the printed number and the stored number and the display name in the read and confirm answers and in logs | T42d-I5, T42d-I8, T42d-I11 |
| 7 | The read stores nothing and the image is not kept | row counts of every public table before and after; no observation; no capture row | T42d-I8, command 14 |
| 8 | A disagreement warns and never blocks | program, suffix and unit mismatches alone and together answer 200 and are written nowhere | T42d-I6, T42d-U12 |
| 9 | A client cannot choose an observation's source | `source` of any value, `image`, extra keys on the confirm body; `source: screenshot` on the typed route | T42d-I9, T42d-I10, T42d-U8, T42d-U10 |
| 10 | A balance that does not fit its unit is no balance | `12,50`, a third `usd` decimal, a fraction on a whole unit, a sign, a missing unit | T42d-I5, T42d-I9, T42d-U7, T42d-U8 |
| 11 | An as-of more than one day ahead is refused at confirm | an as-of two days after `CURRENT_DATE` | T42d-I9 |
| 12 | An older reading never becomes current; an equal date does | strictly older as-of; equal as-of | T42d-U1.3, T42d-U1.4, T42d-I10 |
| 13 | A program the inbox is bringing balances for is never prompted | coverage `yes`, seen 3 days ago, balance 200 days old | T42d-I1.4 |
| 14 | The staleness boundary is exact | 45 days old not due, 46 due; seen 45 days ago still bringing | T42d-I1.2, T42d-I1.6 |
| 15 | A membership with no reading is prompted, and "—" is not 0 | no observation, no domain; a null balance leaves the form field empty | T42d-I1.3, T42d-U12 |
| 16 | A due list is per membership and has no repeats | two memberships of one program; a program with three domains | T42d-I1.11, T42d-I1.12, T42d-U9 |
| 17 | An older screenshot does not clear a due membership | confirmed with an as-of 50 days old | T42d-I11 |
| 18 | The panel stays one snapshot of exactly five statements | the carried `T42c4-I6` | command 8 |
| 19 | 42c's queue wording is untouched | `Needs attention: n`, `Nothing needs attention` and H15's pinned strings | T42d-U13, command 11 |
| 20 | The typed path and the receipts feature are unchanged | `T42a-C3`; `apps/web/app/api/v1/receipts/**`, `receipt*.ts` diff empty | command 8, command 15 |
| 21 | No migration, no new table, no stored image | `migrations`, `db` diff empty | commands 7 and 15 |
| 22 | No share target | `app/manifest.ts` diff empty | commands 14 and 15 |
| 23 | Stubs and today's code fail every scenario | no-op routes, rules, reader, contracts, components; today's panel code | command 17 |
| 24 | Existing tests and fixtures untouched except the three contracts-test lines | any other test or fixture diff | commands 12 and 16 |

## Evidence required
- `EVIDENCE.md` at `plan/tasks/P8-42d-loyalty-screenshot/EVIDENCE.md` with the verbatim output of every acceptance command (numbers inside assertion diffs redacted) and the docs under `node_modules/next/dist/docs/` read for route handlers and reading a request body, if any.
- **The due-rule table, observed:** one row per T42d-I1.1 to I1.12 case with the membership age in days, the program's coverage value and last-seen age, the decision (due or not), and a PASS; plus the same rows from command 17 Part A on today's code (every one failing). Booleans, codes and day counts only.
- **The disagreement table, observed:** T42d-I6's cases with the three check values and the HTTP status. Codes only.
- **The stub run (command 17):** each scenario title shown `failed` on an assertion against its stub, and the checksum line proving restoration.
- **Mutation evidence (command 20), at least 16 single-line breaks**, each shown failing the named scenario and reverted: M1 treat an equal as-of as recorded-only (T42d-U1.3, T42d-I10); M2 make every confirmed reading current (T42d-U1.4, T42d-I10); M3 turn the 45-day boundary into `>=` (T42d-I1.2); M4 ignore coverage in the due rule (T42d-I1.4); M5 ignore last-seen (T42d-I1.5); M6 drop the no-observation case (T42d-I1.3); M7 join on sender domains so an id repeats (T42d-I1.12); M8 emit the list unsorted or for the wrong membership (T42d-I1.11, T42d-I1.13); M9 write the confirmed row as `typed` (T42d-I10); M10 take `source` from the request body (T42d-I9); M11 let the read route write an observation or a capture row (T42d-I8); M12 log the base64 or a number (T42d-I8, T42d-U5); M13 add the member's program name to the model request (T42d-U4); M14 remove `maxRetries` 0 or the timeout (T42d-U4); M15 emit the stored number or the full printed suffix (T42d-I5); M16 treat a mismatch as a match (T42d-U2.2, T42d-I6); M17 refuse a mismatching confirm (T42d-I6, T42d-U12); M18 skip `cleanReading` on the model's answer (T42d-I5); M19 resolve the caller after reading the body (T42d-I2); M20 accept an oversize image (T42d-I3); M21 remove `Save anyway` gating (T42d-U12); M22 pre-fill a missing balance with 0 (T42d-U12).
- The accepted residuals restated, one sentence each: (1) the confirm route is stateless, so a client can write a `screenshot` row without a read; the label is provenance for the honest path and carries no extra trust, as typed entry can write any value; (2) a membership of a program the inbox serves is not prompted even if its own number is never matched by the mail (forwarding health covers it); (3) a screenshot that shows no date gets the device's calendar day in the form and the person can change it.

## Failure modes to test
- **Sign, rounding, landscape:** none apply to ledger data. Any rounded, signed, grouped-in-storage or float-converted balance is a defect (a comma-decimal value read as a grouped whole number; a grouped value kept with its comma; `usd` with one or three decimals).
- **Unit confusion:** a unit guessed when the screenshot shows none (the clean pass nulls a balance with no recognised unit); miles written into a points membership with no warning (`unitCheck`); a `usd` credit confirmed as a whole unit.
- **As-of:** an older screenshot becoming current; an equal date losing the tie; an as-of two days ahead accepted; a missing as-of replaced by a JS date in server code; the device's day used on the server.
- **Due rule:** off by one at 45 and 46; coverage `no` and `not_read` mixed up; `yes` with no last-seen date treated as recent; a JOIN on `loyalty_sender_domains` repeating a membership; `NOT IN` against a null; an observation dated tomorrow producing a negative age that reads as due; the current observation taken as the last inserted row instead of the reducer's; the list emitted with ids in arrival order; a second panel statement added so `T42c4-I6` breaks; a viewer-dependent list.
- **Privacy:** the image, its base64, the printed number or name reaching a log, a response, a table, a queue or the model request beyond the one image; the full stored number returned in the comparison result; the injected `name` key of the model's raw answer surviving the clean pass; an error text echoed; a read-scope token allowed to spend money or write.
- **Request handling:** the body read before the caller is resolved; a stream error treated as an empty image; the header trusted over the magic bytes; the bound enforced after the model call; a 413 returning a different code from the receipts route's `INVALID_INPUT`; a second size constant that drifts.
- **Disabled and failed reads:** no key sending a request; a thrown reader becoming a 500; `empty_message` surfacing as a code (the screenshot reader cannot produce it); `null` outcomes rendered as 0; the form left unusable after a failure.
- **UI:** the confirm button enabled while saving (double tap writes two rows); the older-than-on-file notice missing or showing for an equal date; `Save anyway` shown without a mismatch; the queue's carried wording (`Nothing needs attention`) suppressed or rewritten by the new section; the new section shown with an empty list; the button count on `/travel` not equal to memberships plus due entries.
- **Determinism and vacuity:** a scenario relying on timing instead of a gate; a trigger, spy or env change left behind; a scenario that passes against a no-op stub or today's code (command 17); a baseline "failure" that is a setup error (command 17 rejects those messages); an assertion only on the response and not on stored state; a leftover `ZQ42D` row (command 8).
- **Tooling traps:** a carried line that moved (guards fail loudly); `370` substitution touching another token; `process.argv[1]` read as `[2]` under `node -e`; a comma-grouped number in a `sed` range; a relative restore path after a `cd`; unquoted `[id]` in a path under a glob.

## Rollback
1. Revert the task's commit(s): the two routes, `domain/loyaltyScreenshot.ts`, the additions to `loyaltyReader.ts`, `loyaltyInboxRead.ts` and `loyaltyStore.ts`, the client and components, the registry lines, the H16 step, the six test files and the contracts change (including the three test lines) go together.
2. There is **no migration, no `down` and no CSV restore**: the task adds no table, column or constant in the database.
3. Rows written while the change was live stay valid. An observation with source `screenshot` is an ordinary row the existing CHECK allows and the existing badge already renders; after a revert it still wins or loses by as-of exactly as before. No image, proposal or log of a read exists to clean up.
4. After a revert the panel loses `screenshotDue` and the page loses "Update from screenshot" and "Needs a screenshot"; typed edits, the inbox, the read and the queue are unaffected.
## Amendments (orchestrator)

- **A0 (G0, 2026-11-24).** One example in "Failure modes to test" was written as comma-grouped figures, which this
  spec's own command 19 refuses. It now names the shapes in words. No rule changed.
- **A1b (G1, 2026-11-24).** `T42a-U7` in `packages/contracts/loyalty.test.ts` counts the exported `*ResponseSchema`
  names (`expect(responses.length).toBe(9)`); the new `LoyaltyScreenshotReadResponseSchema` makes it 10. That one line
  changes to `toBe(10)`, so A1's exact diff is now 2 removed and 3 added lines; command 16 checks both changed lines.
- **A2 (G2 cycle 1, before code, 2026-11-24).** Six existing tests pin the loyalty route set at fourteen files and the
  surface script's last line at `OK H1-H15`: `T42a-U8` (`apps/web/lib/loyalty.test.ts`), `T42a-C10`, `T42b-I10`,
  `T42b2-I9`, `T42c1-I10` and `T42c2-I12` (the five `apps/web/app/api/v1/loyalty/*.test.ts` files). The two new routes
  and H16 make them fail, so no implementation could pass commands 3 and 8 under the old Non-goal (42c2 edited the same
  pins when it added routes). The orchestrator made the edits, nothing else in those files: fourteen to sixteen in five
  places, the two route paths added to `LOYALTY_ROUTE_FILES`, the confirm route added to the two membership-view lists
  (it answers a membership view, so `numeric-only`), and `OK H1-H15` to `OK H1-H16` in `T42a-U8`. Command 16 pins that
  diff by its sha256; command 15 admits the six files. The implementer does not edit them. Separately, command 6 lets
  the one row-type line of the panel's counts statement in `loyaltyInboxRead.ts` change, so `screenshotDue` can be typed
  there; every other line of the two files stays additions-only. Totals unchanged (unit 1456, integration 402).
- **A3 (G2 cycle 1, 2026-11-24).** A2 missed one more pin: `T42c2-I9` (`loyaltyRead.test.ts`) lists the panel's exact
  keys. `'screenshotDue'` is added to that list, nothing else; command 16's A2 checksum is the new diff's.

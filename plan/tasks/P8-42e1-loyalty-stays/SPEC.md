
# P8-42e1-loyalty-stays — hotel confirmations and cancellations from the loyalty inbox become stays; this year's counted nights per hotel membership; a "Hotel stays" section on /travel; a typed fallback

**Roadmap item:** ROADMAP.md §5 Phase 8 step 42e (first half); `plan/LOYALTY-ROADMAP.md` §4 A, §5 `loyalty_stays`, §6 42e, §7. Origin: `plan/tasks/P8-42e1-loyalty-stays/ITEM.md` (binding). "42c2 line n", "42c3 line n" and "42d line n" mean line n of the FROZEN SPEC.md of P8-42c2-loyalty-inbox-read, P8-42c3-loyalty-read-forwards and P8-42d-loyalty-screenshot. HEAD at spec time is `88e0737`.
**Status:** FROZEN (G0 2026-11-24, amendment A0)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec holds no money-looking figure, no balance, no member number and no real confirmation code. Tests use fabricated `ZQ42E` data only: program names `ZQ42E …`, sender domains on `.test` or `example.*`, confirmation codes made of letters and digits generated in the test (for example `ZQ42EAB12`), and mail built in code. A quoted digit-only string of four or more digits, or a quoted decimal with two to four places, is forbidden in the new test files (command 16). Dates are `YYYY-MM-DD` or day offsets from Postgres `CURRENT_DATE`. Command 21 scans this spec; it strips the migration timestamp and 64-hex digests first. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way. No `sed` range is a comma-grouped number. `git show` takes repo-relative paths. Restore traps use absolute paths. `tsc` runs with `--incremental false`.

## Goal
Every hotel confirmation, change and cancellation that reaches the loyalty inbox is read once by Claude in a second, separate read (booking read) that extracts only: which kind of booking mail it is, the program's member-number suffix as printed, the property name, check-in and check-out dates, the confirmation code and whether it was paid with an award (points or certificate). A cleaned booking becomes a stay on the right membership, or is held for one tap when it cannot be placed with confidence. A later mail for the same program and confirmation code updates the stay; a cancellation marks it cancelled and never deletes it. `/travel` shows, per hotel membership, this calendar year's counted nights (whole nights of stays that are not cancelled and whose check-out is on or before today and in this year), the upcoming stays and this year's completed stays, the held bookings with one-tap choices, and a typed way to add or correct a stay. The balance read, auto-apply, queue, retry, lock, retention and the screenshot path are unchanged.

### Decisions the item delegated to this spec
Each is binding; the short reason is for the reviewer.

**D1 — Scope cut: hotel stays only; flights are 42e1b.** No segments table, no flight fields, no flight list. The read still classifies a flight mail as kind `flight` and records it without extracting anything, so 42e1b can reset exactly those rows and read them. *Why:* flights feed no 42e1 figure, need a second table and multi-leg parsing, and add no new decision; the machinery (second read, dedupe, cancel, attribution, hold, typed, supersession) is fully exercised by stays. The page heading is `Hotel stays`, not "Stays & flights", until 42e1b.

**D2 — A second read, not a wider schema.** `READ_SCHEMA` and `READ_SYSTEM_PROMPT` are unchanged. A new schema `BOOKING_SCHEMA`, a new fixed prompt and a new reader `createBookingReader` are added to `apps/web/lib/loyaltyReader.ts` (additions only; it stays the only SDK importer). *Why:* `READ_SCHEMA` is pinned by 42c2 and 42d tests and fixtures; widening it would change what every balance read asks and force re-reading balances for old mail. Cost: one more model call per stored hotel-program message, stated and accepted (a household reads tens of messages a month).

**D3 — Already-read messages get a booking read without re-reading balances.** The booking read has its own table, `loyalty_inbox_booking_reads`, keyed by the message's `dedupe_key`. Its candidate set is: stored messages with bytes, whose program has kind `hotel`, with no booking-read row or one in `retry`, oldest received first, at most `LOYALTY_READ_MAX_PER_RUN`. Whether the balance read already settled the message is irrelevant, and nothing in `loyalty_inbox_reads`, `loyalty_observations` or the balance reader is touched. *Why:* a confirmation that prints a balance line must still become a stay; skipping messages the balance read settled would silently miss stays. Mail older than the 30-day raw retention cannot be read; a stay is only as old as the mail kept.

**D4 — Separate run, lock and daily step.** `lib/loyaltyBookingRead.ts` exports `readStoredBookings(env?)` (resolves, never rejects) and `runLoyaltyBookingsDaily()`. It takes its own advisory lock (key text `b8:loyalty-bookings:read`, distinct from the poll's and the balance read's). `scheduler.ts` imports and calls `runLoyaltyBookingsDaily()` directly after `runLoyaltyReadDaily()` and before the digest. `readStoredMail`, `runLoyaltyReadDaily` and `apps/web/lib/loyaltyInboxRead.ts` are not edited. There is no new on-demand route. *Why:* the 42c2 integration tests count connections per attempt and mock only `createMailReader`; a second pass inside the balance run would break them. The item's within-a-day exit is met by the daily job.

**D5 — Retry, failure and bounds mirror 42c2.** Attempts at most `LOYALTY_READ_MAX_ATTEMPTS`; the attempt is committed before the model is called; `refused` and `empty_message` are terminal at once; a rate limit stops the run; `LOYALTY_READ_STOP_AFTER` consecutive `timeout` or `api_error` results stop it; the run budget `LOYALTY_READ_RUN_BUDGET_SECONDS` starts no new message; the bound on one call is the reader timeout plus five seconds. With no `ANTHROPIC_API_KEY` the run is `disabled` and writes nothing. Booking-read rows are purged by `received_on` strictly older than `LOYALTY_READ_RETENTION_DAYS` days, pending included, by `runLoyaltyBookingsDaily`; stays are never purged by it. *Why:* one retry policy for one kind of cost.

**D6 — Dedupe and update: program plus normalised confirmation code.** A code is normalised to its letters and digits, upper-cased; it is valid with 4 to 20 characters. `loyalty_stays` is UNIQUE on `(program_id, confirmation_code)`. A later confirmation or change for the same pair updates the same row (dates, property, award flag); the same code in another program is another row; codes differing only by case, spaces or dashes are the same row. A booked mail with no valid code or with unusable dates is stored as nothing (booking-read state `no_booking`). *Why:* the code is the only identifier a hotel gives for a booking; a change email keeps it.

**D7 — Cancellation semantics.** A `hotel_cancelled` mail for an existing stay sets `state = 'cancelled'`; the row, its dates and its code stay. A cancelled stay is in no count and in no list. A cancellation for a code with no stay creates a cancelled stay when the cancellation itself carries valid dates, and otherwise nothing (`no_booking`). *Why:* never delete evidence; a cancellation mail that arrives before its confirmation is rare and, if it states dates, can still guard against a late confirmation.

**D8 — Supersession, one rule for mail and typed.** A stay stores `source` (`typed` or `email`), `evidence_received_on` (the received date of the mail that last decided it, NULL for a stay never touched by mail) and `evidence_key` (that mail's `dedupe_key`, not a foreign key, since mail is purged first). An incoming mail applies to an existing stay exactly when: the stay has no `evidence_received_on`; or the mail's `received_on` is strictly later; or it is equal and the mail is a cancellation; or it is equal, the mail is a booking and the stay is booked. It does not apply (booking-read state `stale`) when the mail's received date is earlier, or equal and the stay is cancelled and the mail is a booking. An applied mail sets source `email` and replaces dates, property, award and state, but never the membership (the first attribution is sticky). A typed write replaces dates, property, award and state, sets source `typed`, and KEEPS `evidence_received_on` and `evidence_key`, so an older re-forwarded mail cannot undo a correction and only a strictly later mail supersedes it. A typed stay with no evidence is superseded by the first mail for its code. *Why:* arrival order is not event order (a re-forward of an old confirmation after a cancellation must not resurrect the stay), and the newest-by-event-date principle is the one the observations use.

**D9 — Attribution: the forwarder and the suffix decide; otherwise it is held.** Inputs: the message's `member_id` (set only when attribution is `matched`), the memberships of the program, the cleaned printed suffix, the program check (`programCheck` from `lib/domain/loyaltyRead.ts`), and the not-mine list. Decision in this order:
1. Program check `mismatch` → hold, reason `program_mismatch`.
2. Let F be the forwarder's membership in this program (exists only when `member_id` is set and that member has one). Suffix present: `matchSuffix` unique match M: if F exists and F is not M → hold `forwarder_conflict`; else place on M. Suffix present, unmatched: if the pair (program, suffix) is in `loyalty_inbox_not_mine` → settled, state `not_mine_known`, nothing stored; else hold `unmatched_suffix`. Suffix present, ambiguous → hold `ambiguous_suffix`.
3. No suffix: F exists → place on F; otherwise hold `no_suffix`.
The suffix match is the 42c2 rule (`cleanReading`'s `keepSuffix`, `matchSuffix`), reused by import, not re-implemented. *Why:* it is 42c2's rule, with one addition: a confirmation often prints no member number, so a forwarder the poll already attributed is enough where nothing contradicts it.

**D10 — The hold is one tap, listed in the bookings payload, not in the balance queue.** A held booking is a `pending` booking-read row carrying its cleaned booking as a fixed-key JSON object (kind, property, checkIn, checkOut, code, award) until resolved, then the object is cleared. `POST /api/v1/loyalty/inbox/bookings/[id]` takes one of: `{ action: 'place', membershipId }` (the membership must belong to the item's program; applies the booking by the D6/D8 rules; state `placed_by_hand`), `{ action: 'not_mine' }` (records the pair (program, suffix) in `loyalty_inbox_not_mine` idempotently when there is a suffix, and resolves every other pending booking of that program and suffix to `not_mine`), `{ action: 'ignore' }`. A second action on a resolved item is 409 `ITEM_RESOLVED`; two simultaneous places make one stay. The held items are listed in the new `LoyaltyBookings` payload (field `queue`), rendered inside the stays section. *Why (deviation from ITEM, which said "the existing Needs-attention queue"):* that panel is strict and pinned (`T42c2-I9`'s key list, `T42c4-I6`'s five statements, the contracts test's `EMPTY_READ`, the strings `Needs attention: n`), and its items carry a balance that `loyalty_inbox_reads` CHECKs require for a pending row. The vocabulary, the `not_mine` table, the error code and the one-tap shape are reused.

**D11 — The nights rule and "this year".** Year and today are Postgres `CURRENT_DATE`. A stay is counted exactly when `state = 'booked'`, `check_out <= CURRENT_DATE` and `EXTRACT(YEAR FROM check_out) = EXTRACT(YEAR FROM CURRENT_DATE)`. A counted stay contributes its whole `nights` (`check_out - check_in`) to the year of its CHECK-OUT, so a stay from 30 December to 2 January counts wholly in the new year once checked out. A hotel membership's `nightsThisYear` is the sum of its counted stays, an integer, or NULL when it has no counted stay (shown "—", never 0). "Qualifying" means every counted night; the page says program-specific rules are not applied. Nights are derived by the database, never typed: `nights = check_out - check_in`, at least 1 and at most `LOYALTY_STAY_MAX_NIGHTS` (60). *Why:* the item says check-out on or before today; crediting at check-out is the common rule and avoids splitting a stay; a zero for a program whose mail never arrives would be a wrong zero.

**D12 — Typed fallback.** `POST /api/v1/loyalty/stays` with a strict body `{ membershipId, confirmationCode, checkIn, checkOut, property, state, award }` (`property` string or null; `award` boolean or null) creates a stay (201) or, when the program and normalised code already exist on that same membership, updates it (200), by D8. The membership must be of a program of kind `hotel` (else 400 `INVALID_INPUT`); a code recorded under another membership of the program is 400 `INVALID_INPUT` with a fixed sentence. A typed write can set `state` to `cancelled` (the only way to cancel by hand); nothing deletes. Write scope required. *Why:* an upsert by code keeps one dedupe rule; a code is therefore required for typed stays.

**D13 — Masking and where a code appears.** The code is stored in full normalised form. Every payload carries `maskedCode`, produced by the same masking function member numbers use (four bullets then the last 4 characters when the code has 8 or more, the last 3 when it has 6 or 7, nothing when 5 or fewer). No route returns the full code, so no payload, log, push, mail or agent context holds one. *Why:* identifiers enable social engineering; there is no tap-to-copy requirement for codes.

**D14 — What is stored from the model.** Only: kind (enum), the cleaned suffix (3 or 4 characters), the cleaned code, two dates, a property name, an award flag. The property name is the one free-text value: trimmed, whitespace collapsed, 1 to 80 characters, no `<`, `>` or control character, else NULL. No guest name, address, phone, card digits, price or total has a column, a key in the schema or a place in the prompt. Residual: a property field is model text; the clean pass bounds it, React escapes it.

**D15 — Award flag.** `award` is true when the mail states a points or certificate payment, false when it states cash, NULL when it states nothing. It is stored and shown nowhere else in 42e1 (42e2 makes it a redemption).

## Non-goals
The reviewer enforces each as a defect if present.
- **No flights, segments, flight list or segments table** (D1). A `flight` kind is recorded and nothing is extracted.
- **No charge matching, no ledger read** (42e2). No `transactions`, `accounts`, `account_valuations` or `visibleTransactions` in any new code.
- **No redemption, no cash price, no total, no card digits, no guest name** stored or shown; the award flag is a flag only. No instrument is marked used. No elite target (42e2). Transfers (42f), alerts and digest (42g), the agent tool (42h) and 42c2's N3 are out of scope.
- **No change to what 42c and 42d do**: `READ_SCHEMA`, `READ_SYSTEM_PROMPT`, `createMailReader`, `decideReading`, `cleanReading`, the balance queue, `apps/web/lib/loyaltyInboxRead.ts` (byte-identical), `apps/web/lib/loyaltyInbox.ts`, `apps/web/lib/domain/loyaltyRead.ts` and `loyaltyInbox.ts`, the screenshot routes and reader, the observations routes. Edits to `loyaltyReader.ts` are additions only.
- **No change to `LoyaltyOverviewSchema`, `LoyaltyInboxReadPanelSchema` or `GET /api/v1/loyalty`'s shape** (the bookings are a separate payload and a separate loader).
- **No new on-demand booking-read route and no extra read button.** No new dependency, no new environment variable, no change to `package.json`, lockfile, `eslint.config.*` or `vitest*.mts`.
- **No route returns a full confirmation code; no tap-to-copy of codes.** No cancelled-stays list on the page (cancelled stays are stored and uncounted).
- **No deletion of a stay**, by route, by purge or by migration code.
- **No program-specific qualifying rule** (suites, bonuses, partial nights, status tiers); the page says so.
- **No fixture directory** is created or edited; `apps/web/lib/fixtures` is byte-identical.
- **No log line carries a code, a suffix, a property, a date, a name, mail text, an error text, model output or a key**; only counts, fixed codes, the model name and token counts. No `console.` call.
- **No second `raw_mail` reader beyond `lib/loyaltyBookingRead.ts`**; the non-test files naming `raw_mail` are exactly `loyaltyInbox.ts`, `loyaltyInboxRead.ts`, `loyaltyBookingRead.ts`.
- **No existing test, fixture or script edited** except the exact pin lines named in command 15 and the additions to the surface script and registry named in commands 12 and 14.

## Contracts touched
G1 **runs** (contract-guardian): the scope-guard hook blocks every other agent from `packages/contracts/**`, `migrations/**` and `db/**`. Every line below belongs to G1, including the one contracts-test line. The implementer does not edit them.

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<timestamp>_loyalty_stays.sql` (name must contain `loyalty_stays`; the timestamp is greater than that of the 42c2 migration `..._loyalty_inbox_read.sql`, the latest existing, and follows the same numbering) | UP: creates `loyalty_stays` and `loyalty_inbox_booking_reads` (columns, constraints, indexes in "Table design" below); adds one UNIQUE index `(id, program_id)` on `loyalty_memberships` as the target of a composite foreign key. DOWN: drops `loyalty_inbox_booking_reads`, then `loyalty_stays`, then that index; touches no other row | additive (new tables, one new index, nothing altered or dropped); the down is NOT lossless and says so |
| `db/schema.sql` | the same two tables and the index, with comments, in step with the migration | additive |
| `packages/contracts/loyalty.ts` | NEW consts `LOYALTY_STAY_MAX_NIGHTS = 60`, `LOYALTY_STAY_STATES = ['booked', 'cancelled']`, `LOYALTY_STAY_SOURCES = ['typed', 'email']`, `LOYALTY_BOOKING_KINDS = ['hotel_booked', 'hotel_cancelled', 'flight', 'none']`, `LOYALTY_BOOKING_HOLD_REASONS = ['no_suffix', 'unmatched_suffix', 'ambiguous_suffix', 'forwarder_conflict', 'program_mismatch']`, `LOYALTY_BOOKING_ACTIONS = ['place', 'not_mine', 'ignore']`; NEW enum schemas for each; NEW `LoyaltyStaySchema` (strict: `id`, `membershipId`, `programId`, `property` nullable, `maskedCode` (the existing masked-member-number schema), `checkIn`, `checkOut`, `nights` (int 1..max, equal to the dates' difference), `state`, `source`, `award` boolean nullable); NEW `LoyaltyStayCreateRequestSchema` (strict `{ membershipId, confirmationCode, checkIn, checkOut, property, state, award }`; no `source`, no `nights`, no `id` key; `checkOut` after `checkIn`; at most the max nights; code valid after normalisation; error text never echoes input); NEW `LoyaltyBookingQueueItemSchema` (strict: `id`, `programId`, `receivedOn`, `reason`, `maskedSuffix` nullable, `property` nullable, `checkIn`, `checkOut`, `maskedCode`, `state` booked/cancelled, `candidateMembershipIds` ascending no repeat, empty with no suffix); NEW `LoyaltyBookingNightsSchema` (strict `{ membershipId, nightsThisYear: int ≥ 1 or null }`); NEW `LoyaltyBookingsSchema` (strict `{ year: int, nights: array, upcoming: array of stays, completed: array of stays, queue: array at most `LOYALTY_READ_QUEUE_LIMIT` newest first then id descending }`; `upcoming` and `completed` hold only `booked` stays; `nights` has one entry per membership of a hotel-kind program, membership ids strictly ascending); NEW `LoyaltyBookingResolveRequestSchema` (strict discriminated union on `action`: `place` requires `membershipId`; `not_mine` and `ignore` forbid it); NEW `LoyaltyBookingResolveSchema` (`{ id, state }` with state in `placed_by_hand`, `not_mine`, `ignored`); NEW `LoyaltyStayResponseSchema` and `LoyaltyBookingResolveResponseSchema` (envelopes); NEW types for each | additive |
| `packages/contracts/loyalty.test.ts` | exactly one removed line containing `expect(responses.length).toBe(10);` and one added line containing `toBe(12);` (T42a-U7 counts the exported `*ResponseSchema` names) | additive (test follows the exports) |
| `apps/web/lib/loyaltyBookings.test.ts`-style new tests | none in contracts; new tests live under `apps/web` | n/a |

Unchanged on purpose: `LoyaltyErrorCodeSchema` (the typed route uses `INVALID_INPUT`, `NOT_FOUND`, `INSUFFICIENT_SCOPE`; resolve uses `ITEM_RESOLVED`), `LoyaltyOverviewSchema`, `LoyaltyInboxReadPanelSchema`, `LOYALTY_OBSERVATION_SOURCES`, every `LOYALTY_READ_*` and `LOYALTY_INBOX_*` constant.

### Table design (binding; names are fixed so commands can check them)
**`loyalty_stays`** — columns, sorted: `award` BOOLEAN NULL; `check_in` DATE NOT NULL; `check_out` DATE NOT NULL; `confirmation_code` TEXT NOT NULL CHECK `^[A-Z0-9]{4,20}$`; `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(); `evidence_key` TEXT NULL CHECK `^[0-9a-f]{64}$`; `evidence_received_on` DATE NULL; `id` SERIAL PK; `membership_id` INTEGER NOT NULL; `nights` INTEGER GENERATED ALWAYS AS (check_out - check_in) STORED; `program_id` INTEGER NOT NULL REFERENCES loyalty_programs(id) (no ON DELETE); `property` TEXT NULL CHECK (trimmed, 1 to 80 characters, no `<`, `>` or control character); `source` TEXT NOT NULL CHECK in `typed`, `email`; `state` TEXT NOT NULL CHECK in `booked`, `cancelled`; `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(). Constraints: UNIQUE `(program_id, confirmation_code)`; CHECK `nights BETWEEN 1 AND 60`; CHECK `(evidence_key IS NULL) = (evidence_received_on IS NULL)`; CHECK `source <> 'email' OR evidence_key IS NOT NULL`; composite FOREIGN KEY `(membership_id, program_id)` REFERENCES `loyalty_memberships (id, program_id)` (no ON DELETE), so a stay's program always equals its membership's. Index `(membership_id, check_out)`. *Why:* the unique pair is the dedupe rule; the composite key stops a stay filed under a membership of another program; nothing cascades, history is kept; nights is derived once, in the database.
**`loyalty_inbox_booking_reads`** — columns, sorted: `attempts` SMALLINT NOT NULL 0..3; `booking` JSONB NULL (fixed keys `kind`, `property`, `checkIn`, `checkOut`, `code`, `award`, enforced by CHECK as the 42c2 JSON columns are; NOT NULL exactly while `pending`); `dedupe_key` TEXT NOT NULL UNIQUE CHECK 64 lower-case hex; `id` SERIAL PK; `kind` TEXT NULL CHECK in the four booking kinds (NULL exactly while `retry` or `failed`); `last_error_code` TEXT NULL (the six codes of `loyalty_inbox_reads`; set exactly while `retry` or `failed`); `membership_id` INTEGER NULL REFERENCES loyalty_memberships(id); `program_check` TEXT NULL (match, mismatch, not_stated; set exactly when read); `program_id` INTEGER NOT NULL REFERENCES loyalty_programs(id); `read_on` DATE NULL (set exactly when read); `reason` TEXT NULL (the five hold reasons; set exactly for `pending`, `placed_by_hand`, `not_mine`, `ignored`); `received_on` DATE NOT NULL; `resolved_on` DATE NULL (NULL exactly while `retry`, `failed`, `pending`); `state` TEXT NOT NULL CHECK in `retry`, `failed`, `none`, `flight`, `no_booking`, `stale`, `recorded`, `pending`, `placed_by_hand`, `not_mine_known`, `not_mine`, `ignored`; `stay_id` INTEGER NULL REFERENCES loyalty_stays(id); `suffix` TEXT NULL CHECK `^[A-Z0-9]{3,4}$`. `stay_id` is set exactly for `recorded` and `placed_by_hand` when a stay was written or updated. Indexes: `(received_on)`, `(program_id, received_on)`, partial `(received_on DESC, id DESC) WHERE state = 'pending'`. *Why:* a mirror of `loyalty_inbox_reads` with the same crash-safe attempt row, no balance, and the booking object held only while it waits for a person.
No column in either table has a name matching the forbidden words of command 7.

## Conventions this task must honor
- **Sign:** no ledger amount exists in this task; no price, total or balance is read, stored or shown, so the ledger sign convention is not consulted. Nights are non-negative integers, at least 1 per stay. A stay whose check-out is not strictly after its check-in is not a stay.
- **Rounding:** none. Nights are a date difference computed once by the database; the year total is an integer sum. No JS date arithmetic, no `Date`, no float.
- **Landscape and exclusions:** not applicable. No ledger row is read or written, so `landscape`, `hidden` and `exclude_from_budget` are never consulted; nothing feeds net worth or `computeNetWorth()`. `/travel` stays `numeric-only` because the overview it already loads derives a fee date from a ledger row; the new routes are `no-transaction-data`.
- **Null semantics:** a hotel membership with no counted stay shows `—`, never 0; `nightsThisYear` is null, not 0, in the payload. An unread field is null; `property` null is shown as `Property not stated`; `award` null means not stated, not false. A section with no data renders its empty text, never a zero count.
- **Dates and clock:** "today" and "this year" are Postgres `CURRENT_DATE`. None of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `setHours(`, `getTimezoneOffset`, `toLocaleDateString`, `toLocaleTimeString`, `parseFloat`, `parseInt`, `toFixed`, `Math.round` appears in any added non-test line (command 16). Date validity uses the existing `isCalendarDate`; date order is `YYYY-MM-DD` string comparison; the night count in pure code uses integer day arithmetic on the date parts, not a Date object.
- **Identifiers:** the confirmation code is an identifier: stored in full, masked everywhere, never in a log, push, mail, agent context or API v1 payload. The member-number suffix is the 42c2 fragment (at most four characters). The household member's name appears only where the page already shows it.
- **Determinism:** no live Anthropic, Plaid or mailbox, no non-loopback socket, no `b8_finance`; the model is faked by mocking `createBookingReader` or injecting a client; Postgres is the throwaway `b8_p42a_throwaway`; day arithmetic is Postgres `CURRENT_DATE` with offsets.

## Toolchain prerequisites
All commands run under `/bin/bash` 3.2 from the repo root. The orchestrator measures every row at G0; a mismatch is a G0 FAIL and the numbers in commands 3 and 9 are corrected before freezing.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql` and local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB `b8_p42a_throwaway` at head (migrations through the 42c2 one), no `ZQ42E` rows, new tables absent | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42E%')||','||(select count(*) from household_members where display_name like 'ZQ42E%')||','||(select count(*) from loyalty_sender_domains where domain like '%zq42e%')||','||coalesce(to_regclass('public.loyalty_stays')::text,'none')"` → `0,0,0,none` | filled at G0 |
| T3 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → `Test Files  116 passed (116)`, `Tests  1456 passed (1456)` | filled at G0 |
| T4 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, at most 5 warnings | filled at G0 |
| T5 | Integration baseline total 402 on the unmodified tree | **yes** | existing | `O="$(mktemp)"; (cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") \|\| true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r.testResults.flatMap(f=>f.assertionResults).length)' "$O"` → `402` | filled at G0 |
| T6 | `tsc` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Node 22 or later | **yes** | local | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T8 | Port 3198 free; surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`; then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → last line `OK H1-H16`, `exit=0` | filled at G0 |
| T9 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T10 | Frozen carried lines sit where stated. 42c2 SPEC prefixes: 251 `set -e; O="$(mktemp)"; npm run lint`, 255 `echo "OK lint 0 errors`, 269 `set -e; B="$(git merge-base HEAD main)"`, 278 `echo "OK dependencies"`, 374 `set -e; U=postgresql://localhost/b8_p42a_throwaway`, 376 `[ "$(Q "SELECT string_agg(table_name`, 392 `echo "OK schema"`, 397 `set -e; unset ANTHROPIC_API_KEY`, 398 `for TZV in UTC Pacific/Auckland`, 407 `node -e 'const r=JSON.parse(require("fs")`, 408 `LEFT="$(psql `, 409 `[ "$LEFT" = `, 410 `echo "OK no fixture rows left"`, 416 `set -e; unset ANTHROPIC_API_KEY`, 420 `bash -c `, 426 `set -e; unset ANTHROPIC_API_KEY`, 440 `BODY="$(sed -n `, 574 `set -e; D=apps/web/lib/fixtures/loyalty-read; I=`, 605 `echo "OK fixtures pinned and covered"`. 42c3 SPEC prefixes: 182 `set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN`, 183 `for TZV in UTC Pacific/Auckland; do O=`, 256 `set -e; D=apps/web/lib/fixtures/loyalty-read-forwards`, 288 `echo "OK new fixtures pinned and covered"`. Line 407 of 42c2 holds the digits `370` exactly twice. Line 376 holds the exact table list exactly once | **yes** | frozen | `S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; for n in 251 255 269 278 374 376 392 397 398 407 408 409 410 416 420 426 440 574 605; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done`; `S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; for n in 182 183 256 288; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-70; done`; `sed -n '407p' plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md \| grep -o 370 \| wc -l \| tr -d ' '` → `2`; `sed -n '376p' plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md \| grep -o 'loyalty_programs,loyalty_sender_domains' \| wc -l \| tr -d ' '` → `1` | filled at G0 |
| T11 | Fixture pins hold on the unmodified tree | **yes** | existing | command 13's first six statements on the unmodified tree → `OK new fixtures pinned and covered`, `OK fixtures pinned and covered` | filled at G0 |
| T12 | The non-test files naming `raw_mail` under lib, app, components, scripts are exactly two at HEAD | **yes** | existing | `grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts \| grep -vE '\.test\.ts$\|gifts-surface-check\.mjs$\|/fixtures/' \| sort \| tr '\n' ' '` → `apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts ` | filled at G0 |
| T13 | Unit config collects `lib/**/*.test.ts`; integration config collects `app/api/v1/**/*.test.ts` and runs files serially | **yes** | existing | `grep -c "'lib/\*\*/\*.test.ts'" apps/web/vitest.config.mts` → `1`; `grep -c "'app/api/v1/\*\*/\*.test.ts'" apps/web/vitest.integration.config.mts` → `1`; `grep -c 'fileParallelism: false' apps/web/vitest.integration.config.mts` → `1` | filled at G0 |
| T14 | Under `set -e`, a leading `!` does not abort when the negated command succeeds; this spec writes no `! cmd` guard | **yes** (hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T15 | Work happens on `main`, uncommitted, HEAD is the 42d-era commit, so `git diff HEAD` is exactly this task | **yes** | adjudicated at G0 | `[ "$(git merge-base HEAD main)" = "$(git rev-parse HEAD)" ]; echo "exit=$?"` → `exit=0`; `git status --short \| grep -v ' plan/' \| wc -l \| tr -d ' '` → `0` | filled at G0 |
| T16 | No iCloud-evicted (dataless) files in the checked trees | **yes** (hazard) | n/a | `find apps/web packages migrations db node_modules -flags +dataless -type f -not -path "*/.next/*" -not -path "node_modules/react-native*" -not -path "node_modules/@react-native*" -not -path "node_modules/@expo*" -not -path "node_modules/expo*" \| wc -l` → `0`, re-checked before each gate run | filled at G0 |
| T17 | A browser or jsdom renderer | **NO** | n/a. UI is proven by pure functions, `renderToStaticMarkup`, source-scan tests and the HTTP surface script (H17) | n/a | n/a |
| T18 | Live Anthropic, Plaid, a real mailbox, non-loopback sockets, `b8_finance`, the owner's ledger | **NO** | n/a | n/a | n/a |
| T19 | `LOYALTY_IMAP_*` and `ANTHROPIC_*` unset in the gate shell | **yes** | n/a | `bash -c 'ANTHROPIC_API_KEY=x; unset ANTHROPIC_API_KEY; [ -z "${ANTHROPIC_API_KEY:-}" ]'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T20 | **Test-interference probe.** No existing integration test leaves a row in the new tables once the daily job step exists. Prediction only: the 42c1 and 42c2 files call `runDailyJob` with the real scheduler | **yes** | measured after G2's first full run | after the full integration run of command 9: `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_inbox_booking_reads)\|\|','\|\|(select count(*) from loyalty_stays)"` → `0,0`. A non-zero result is a G0/G2 amendment (a carried test's setup is touched), never silently accepted | filled at G0 |
| T21 | `scheduler.ts` names `runLoyaltyReadDaily` exactly twice at HEAD (import and call) | **yes** | existing | `grep -c 'runLoyaltyReadDaily' apps/web/lib/scheduler.ts` → `2` | filled at G0 |
| T22 | The six route-count pins are where stated: five lines `toHaveLength(16)` (one in each of `loyalty.test.ts`, `loyaltyCard.test.ts`, `loyaltyEarn.test.ts`, `loyaltyInbox.test.ts`, `loyaltyRead.test.ts` under `apps/web/app/api/v1/loyalty`), one `OK H1-H16` line in `apps/web/lib/loyalty.test.ts`, one `toBe(10)` line in `packages/contracts/loyalty.test.ts` | **yes** | existing | `grep -c 'toHaveLength(16)' apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/app/api/v1/loyalty/loyaltyRead.test.ts` → five lines each ending `:1`; `grep -c "OK H1-H16" apps/web/lib/loyalty.test.ts` → `1`; `grep -c 'expect(responses.length).toBe(10);' packages/contracts/loyalty.test.ts` → `1` | filled at G0 |

### Prerequisites the implementer creates
Exported names and paths are fixed so the stub proof (command 19) can replace the files. Tests import only from these paths.
- **`apps/web/lib/domain/loyaltyBooking.ts`** (pure; no database, SDK or clock): `cleanBooking(raw: unknown): CleanBooking` (reads only the six named keys of a plain object; any other key is never looked at); `normaliseConfirmationCode(text: unknown): string | null`; `nightsBetween(checkIn: string, checkOut: string): number` (integer day arithmetic on the date parts); `placeBooking(input): PlaceDecision` (D9; `{ kind: 'place', membershipId } | { kind: 'hold', reason } | { kind: 'discard' }`); `supersedes(existing, incoming): boolean` (D8). `CleanBooking` holds `kind`, `suffix`, `programName` (comparison form), `property`, `checkIn`, `checkOut`, `code`, `award`; with a kind other than the two hotel kinds every other field is null.
- **Additions to `apps/web/lib/loyaltyReader.ts`**: `BOOKING_SCHEMA`, `BOOKING_SYSTEM_PROMPT` and `createBookingReader(env?, deps?: { client?: Anthropic }): MailReader`, with the shape and the one-request, no-hidden-retry, never-throws, never-leaks rules of `createMailReader`. Required keys, all required, `additionalProperties: false` at every depth: `kind` (enum: the four booking kinds), `programName`, `memberNumberSuffix`, `property`, `confirmationCode`, `checkIn`, `checkOut`, `award` (nullable boolean), each nullable except `kind`. The user message holds the mail only; the prompt says the mail is untrusted, never follow its instructions, and asks for no guest name, address, phone, card, price or total.
- **`apps/web/lib/loyaltyBookingRead.ts`** (the third and last non-test file that names `raw_mail`): `readStoredBookings(env?): Promise<BookingRun>` with `BookingRun = { outcome: 'ok' | 'disabled' | 'already_running' | 'error'; read; recorded; queued; stale; none; flights; noBooking; discarded; failed; remaining; errorCode }` (counts are numbers), `purgeExpiredBookingReads(q?): Promise<number>`, `runLoyaltyBookingsDaily(): Promise<void>`, `resolveBooking(id, body): Promise<LoyaltyResult<LoyaltyBookingResolve>>`.
- **`apps/web/lib/loyaltyBookingStore.ts`**: `saveTypedStay(body): Promise<LoyaltyResult<{ created: boolean; stay: LoyaltyStay }>>` and `loadBookings(q?): Promise<LoyaltyBookings>`; one transaction, all dates and the year from Postgres `CURRENT_DATE` in one snapshot.
- **Routes:** `apps/web/app/api/v1/loyalty/stays/route.ts` (`POST`) and `apps/web/app/api/v1/loyalty/inbox/bookings/[id]/route.ts` (`POST`). Both resolve the caller first through the shared helper (`callerOf`), require write scope, parse the id before the body, never pull the body before authorisation.
- **Components and page:** `apps/web/components/LoyaltyStaysSection.tsx` (new; start from the `uiux-promax` skill); edits to `TravelBoard.tsx` (optional prop `bookings?: LoyaltyBookings`; section rendered only when provided and non-empty by D-rule below) and `apps/web/app/travel/page.tsx` (loads `loadBookings()` beside `loadOverview()` and passes it). `scheduler.ts` gains the import and one call.
- **Seven new test files**, no others (command 18): unit `apps/web/lib/domain/loyaltyBooking.test.ts` (7 tests), `apps/web/lib/loyaltyBookingReader.test.ts` (3), `apps/web/lib/loyaltyBookingContract.test.ts` (3; it uses `import * as loyalty from '@b8/contracts/loyalty'` and reads schemas as `loyalty.<Name>`, so a missing export fails with an assertion-class `TypeError`, not an import error), `apps/web/lib/loyaltyBookingUi.test.ts` (2); integration `apps/web/app/api/v1/loyalty/loyaltyBookingRead.test.ts` (10) and `apps/web/app/api/v1/loyalty/loyaltyBookings.test.ts` (5). That is 15 unit and 15 integration tests: three unit files hold 7+3+3+2 = 15, two integration files hold 10+5 = 15. (Unit files: four. Integration files: two. Total new files: six.)
- The tests copy the helpers they need (including a small mail builder for a fabricated RFC 822 message); none imports from another `*.test.ts`. They create only `ZQ42E` rows and remove every row, trigger, spy and environment change they make, including rows in the two new tables.

### Description of the "Hotel stays" section (what must be observable)
The section renders exactly when `bookings` is provided and (`nights.length + upcoming.length + completed.length + queue.length` is greater than zero). Pinned strings, each occurring exactly once in `LoyaltyStaysSection.tsx` and its client: `Hotel stays`, `Add a stay`, `Save stay`, `Upcoming`, `Completed this year`, `nights counted in`, `No stay counted yet`, `Property not stated`, `Stays that need a membership`, `Add to this membership`, `Not mine`, `Ignore`, `Cancelled stays are not counted.`, `Program-specific qualifying rules are not applied; every night of a completed stay counts.`. Each hotel membership shows `<program> · <member>`, then `<n> nights counted in <year>` or `—` with `No stay counted yet`. A stay row shows its masked code, never the code. The form's submit is disabled while saving and sends `state` only as `booked` or `cancelled`.

## Acceptance commands
All run from the repo root under `bash` (macOS `/bin/bash` 3.2). `U=postgresql://localhost/b8_p42a_throwaway`. No command uses a leading `!` as a guard (T14). Every command that runs tests first unsets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_PROFILE`; a command that touches the database or the surface refuses a set `LOYALTY_IMAP_` variable. File lists come from git. Run order: 1, 2, 3, then 19 early (it needs the tree complete), then the rest.

The shared first line of every carried command is:
`S=<frozen SPEC path>; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }`

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | a type error anywhere, including the new tests |
| 2 | Lint, carried (42c2 lines 251 to 255) | `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, then the 15 new unit scenarios in two time zones | `OK unit 120 files 1471 tests`, then two lines `OK 15 scenarios … TZ=<zone>` | a missing or failing scenario; an existing unit test broken |
| 4 | Carried unit scenarios: 42c3 oracle, 42c2 U1 to U6, the 26 of 42d | five `OK` lines (two per zone for 42c3, two for 42c2, one for 42d) | a regression in the text path, the pure rules or the screenshot path |
| 5 | Dependencies and importers (42c2 269 to 278) plus additions-only, untouched-file and `raw_mail` guards | `OK dependencies`, then `OK additions only` | a dependency, a new SDK importer, an edit to `loyaltyInboxRead.ts`, a removed line in `loyaltyReader.ts`, a fourth `raw_mail` file |
| 6 | Migration up-down-up with refusals | `OK migration up-down-up` | a wrong column, a missing CHECK, a `down` that harms earlier tables |
| 7 | Schema carried with the new table list substituted, no forbidden column, `db/schema.sql` in step | `OK schema`, then `OK new tables` | a table or column missing, a forbidden column, the schema file out of step |
| 8 | Contracts diff confined and addition-only; exports present once | `OK contracts` | a changed existing export, a missing new export |
| 9 | Integration: 42c2's block with its total set to 417, then carried and new families present once, then leak checks | `OK 417 tests, … T42c2-I1-I14 each present once and passed`, `OK T42c3-I1-I3, T42c4-I1-I6, T42d-I1.1-I1.13, T42d-I2-I11 and T42e1-I1-I15 each present once and passed in their files`, `OK no fixture rows left`, `OK no ZQ42E rows or test triggers left`, `OK new tables empty` | any prior scenario regresses; a leaked row; T20 failing |
| 10 | Integration stability, carried (42c2 lines 416 to 420) | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 11 | Regression block, carried (42c2 lines 426 to 440) | the carried OK lines, ending `OK classes` | a 42a to 42c guarantee disturbed |
| 12 | Surface over real HTTP with H17 | `H1 PASS` to `H17 PASS` each once, `OK H1-H17`, `OK surface` | any page or route behaviour changed; H17 absent or failing |
| 13 | Fixture pins carried (42c3 block; 42c2 block with the post-42c4 digest); nothing changed | `OK new fixtures pinned and covered`, `OK fixtures pinned and covered`, `OK no fixture changed` | any fixture touched |
| 14 | Registry diff is exactly the two new route lines; the travel page class unchanged | `OK registry` | a wrong class, a missing or extra line |
| 15 | The seven existing-test pins changed by exact diff, nothing else | `OK pins exact` | an unrelated test edit; a pin left at the old count |
| 16 | Source guards | `OK source guards` | a clock or float, `console.`, an error text, a ledger read, a figure in a new test, an extra observation writer, a full code in a payload type |
| 17 | Scope guard | `OK scope` | a file outside the allowed set changed |
| 18 | Existing tests untouched except the pins; census exact | `OK census exact` | a wrong set or count of new tests |
| 19 | Baseline and stub proof | `OK stubs fail every scenario`, `OK tree restored` | a vacuous scenario passing against a no-op; a setup error counted as failure; a tree not restored |
| 20 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error |
| 21 | This spec's public-safety scan | `OK spec has no money-looking text` | a figure or long number |
| 22 | Mutation evidence | `OK mutation evidence rows <n>` with n at least 20 | fewer recorded mutations |

**#2 (lint, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 251 255 'set -e; O="$(mktemp)"; npm run lint' 'echo "OK lint 0 errors'
```
(In this block `RUN` is the carried helper; its first inner call is not used. The implementer copies the carried helper line given above exactly, not this one-line variant; the G0 reviewer compares.)

**#3 (unit totals, then the 15 new unit scenarios).** Ids: `T42e1-U1` to `T42e1-U15`, each title starting `T42e1-U<n>:` exactly once, in four files.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +120 passed \(120\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1471 passed \(1471\)' "$O")" = 1 ]
echo "OK unit 120 files 1471 tests"
for TZV in UTC Pacific/Auckland; do O2="$(mktemp)"
(cd apps/web && TZ=$TZV npx vitest run lib/domain/loyaltyBooking.test.ts lib/loyaltyBookingReader.test.ts lib/loyaltyBookingContract.test.ts lib/loyaltyBookingUi.test.ts --reporter=json --outputFile="$O2") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];for(let i=1;i<=15;i++){const m=t.filter(x=>x.title.startsWith("T42e1-U"+i+":"));if(m.length!==1||m[0].status!=="passed")bad.push("U"+i+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||t.length!==15||r.testResults.length!==4){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"tests="+t.length,"files="+r.testResults.length);process.exit(1)}console.log("OK 15 scenarios T42e1-U1..U15 each present once and passed; TZ="+process.argv[2])' "$O2" "$TZV"
done
```

**#4 (carried unit scenarios).** The 42c3 and 42c2 blocks are carried exactly as 42d's commands 4 and 5 carried them:
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 182 183 'set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN' 'for TZV in UTC Pacific/Auckland; do O='
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 397 398 'set -e; unset ANTHROPIC_API_KEY' 'for TZV in UTC Pacific/Auckland'
O3="$(mktemp)"; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
(cd apps/web && npx vitest run lib/domain/loyaltyScreenshot.test.ts lib/loyaltyScreenshotReader.test.ts lib/loyaltyScreenshotContract.test.ts lib/loyaltyScreenshotUi.test.ts --reporter=json --outputFile="$O3") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||t.length!==26||r.testResults.length!==4){console.log("FAIL 42d scenarios",bad.join(";"),"tests="+t.length);process.exit(1)}console.log("OK 26 scenarios of 42d still pass")' "$O3"
```

**#5 (dependencies carried; additions only; the untouched file; the `raw_mail` set).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 269 278 'set -e; B="$(git merge-base HEAD main)"' 'echo "OK dependencies"'
f=apps/web/lib/loyaltyReader.ts
[ -n "$(git diff --name-only HEAD -- "$f")" ] || { echo "FAIL $f unchanged"; exit 1; }
if git diff -U0 HEAD -- "$f" | grep -E '^-[^-]'; then echo "FAIL a line was removed or edited in $f"; exit 1; fi
for n in 'export const READ_SCHEMA' 'export function createMailReader' 'export const BOOKING_SCHEMA' 'export const BOOKING_SYSTEM_PROMPT' 'export function createBookingReader'; do [ "$(grep -cF "$n" "$f")" = 1 ] || { echo "FAIL $n not exactly once"; exit 1; }; done
[ -z "$(git diff --name-only HEAD -- apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/domain/loyaltyRead.ts apps/web/lib/domain/loyaltyInbox.ts)" ] || { echo "FAIL a frozen 42c file changed"; exit 1; }
R="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$R" = "apps/web/lib/loyaltyBookingRead.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts " ] || { echo "FAIL raw_mail namers: $R"; exit 1; }
[ "$(git diff -U0 HEAD -- apps/web/lib/scheduler.ts | grep -E '^[+-][^+-]' | wc -l | tr -d ' ')" = 2 ] || { echo "FAIL scheduler diff is not exactly two added lines"; exit 1; }
[ "$(git diff -U0 HEAD -- apps/web/lib/scheduler.ts | grep -E '^\+[^+]' | grep -cF 'runLoyaltyBookingsDaily')" = 2 ] || { echo "FAIL scheduler lines"; exit 1; }
echo "OK additions only"
```
The scheduler's two added lines are the import line and the awaited call; comments sit on lines the diff counts too, so the implementer puts the explanatory comment in `loyaltyBookingRead.ts` and not in `scheduler.ts`, or the count above becomes the amendment's job.

**#6 (migration: shape, refusals, down/up).** Uses throwaway rows named `ZQ42E Mig`.
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
MIG(){ DATABASE_URL="$U" npm run "$1" >/dev/null 2>&1; }
COLS(){ Q "SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\"), 'none') FROM information_schema.columns WHERE table_schema='public' AND table_name='$1'"; }
R(){ if Q "$1" 2>/dev/null; then echo "FAIL the database accepted: $1"; exit 1; fi; }
MIG migrate:up
LATEST="$(Q "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")"
case "$LATEST" in *loyalty_stays*) ;; *) echo "FAIL the migration name must contain loyalty_stays"; exit 1;; esac
TS="${LATEST%%_*}"; PREV="$(ls migrations | grep '_loyalty_inbox_read\.sql$' | cut -d_ -f1)"; [ -n "$PREV" ]; [ "$TS" -gt "$PREV" ]
[ "$(COLS loyalty_stays)" = "award,check_in,check_out,confirmation_code,created_at,evidence_key,evidence_received_on,id,membership_id,nights,program_id,property,source,state,updated_at" ]
[ "$(COLS loyalty_inbox_booking_reads)" = "attempts,booking,dedupe_key,id,kind,last_error_code,membership_id,program_check,program_id,read_on,reason,received_on,resolved_on,state,stay_id,suffix" ]
[ "$(COLS loyalty_memberships)" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier" ]
Q "INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42E Mig Hotel', 'hotel', 'points'), ('ZQ42E Mig Other', 'hotel', 'points')"
Q "INSERT INTO household_members (display_name) VALUES ('ZQ42E Mig')"
Q "INSERT INTO loyalty_memberships (member_id, program_id) SELECT m.id, p.id FROM household_members m, loyalty_programs p WHERE m.display_name='ZQ42E Mig' AND p.name IN ('ZQ42E Mig Hotel', 'ZQ42E Mig Other')"
MS="SELECT ms.id, p.id FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42E Mig Hotel'"
SI="INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source, evidence_key, evidence_received_on, award, property)"
Q "$SI SELECT ms.id, p.id, 'ZQ42EAB12', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, 'ZQ42E Inn' FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42E Mig Hotel'"
[ "$(Q "SELECT nights FROM loyalty_stays WHERE confirmation_code='ZQ42EAB12'")" = 2 ]
Q "$SI SELECT ms.id, p.id, 'ZQ42EAB13', CURRENT_DATE - 9, CURRENT_DATE - 7, 'cancelled', 'email', repeat('a',64), CURRENT_DATE - 8, true, NULL FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42E Mig Hotel'"
RI="INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code)"
Q "$RI SELECT repeat('b',64), id, CURRENT_DATE, 'retry', 1, 'timeout' FROM loyalty_programs WHERE name='ZQ42E Mig Hotel'"
SEL="FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42E Mig Hotel'"
while IFS= read -r T; do R "$SI SELECT ms.id, p.id, $T $SEL"; done <<'EOF'
'ZQ42EAB12', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, NULL
'ZQ4', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, NULL
'zq42eab14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 3, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 3, CURRENT_DATE - 5, 'booked', 'typed', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 70, CURRENT_DATE - 5, 'booked', 'typed', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'maybe', 'typed', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'import', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'email', NULL, NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', repeat('a',64), NULL, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, CURRENT_DATE, NULL, NULL
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, '<b>x</b>'
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', NULL, NULL, NULL, ' padded '
'ZQ42EAB14', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed', repeat('A',64), CURRENT_DATE, NULL, NULL
EOF
R "INSERT INTO loyalty_stays (membership_id, program_id, confirmation_code, check_in, check_out, state, source) SELECT ms.id, op.id, 'ZQ42EAB15', CURRENT_DATE - 5, CURRENT_DATE - 3, 'booked', 'typed' FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id, loyalty_programs op WHERE p.name='ZQ42E Mig Hotel' AND op.name='ZQ42E Mig Other'"
R "UPDATE loyalty_stays SET check_out = check_in WHERE confirmation_code = 'ZQ42EAB12'"
R "UPDATE loyalty_stays SET nights = 9 WHERE confirmation_code = 'ZQ42EAB12'"
while IFS= read -r T; do R "$RI SELECT $T FROM loyalty_programs WHERE name='ZQ42E Mig Hotel'"; done <<'EOF'
repeat('b',64), id, CURRENT_DATE, 'retry', 1, 'timeout'
repeat('c',63), id, CURRENT_DATE, 'retry', 1, 'timeout'
repeat('c',64), id, CURRENT_DATE, 'maybe', 1, 'timeout'
repeat('c',64), id, CURRENT_DATE, 'failed', 4, 'timeout'
repeat('c',64), id, CURRENT_DATE, 'retry', 1, NULL
repeat('c',64), id, CURRENT_DATE, 'retry', 1, 'oops'
repeat('c',64), id, CURRENT_DATE, 'retry', 0, 'timeout'
EOF
R "INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, booking, kind, program_check, read_on) SELECT repeat('d',64), id, CURRENT_DATE, 'none', 1, '{\"kind\":\"none\"}'::jsonb, 'none', 'not_stated', CURRENT_DATE FROM loyalty_programs WHERE name='ZQ42E Mig Hotel'"
R "INSERT INTO loyalty_inbox_booking_reads (dedupe_key, program_id, received_on, state, attempts, reason, suffix, kind, program_check, read_on) SELECT repeat('e',64), id, CURRENT_DATE, 'pending', 1, 'no_suffix', 'ab', 'hotel_booked', 'match', CURRENT_DATE FROM loyalty_programs WHERE name='ZQ42E Mig Hotel'"
R "DELETE FROM loyalty_programs WHERE name='ZQ42E Mig Hotel'"
MIG migrate:down
for t in loyalty_stays loyalty_inbox_booking_reads; do [ "$(Q "SELECT coalesce(to_regclass('public.$t')::text, 'none')")" = none ]; done
for t in loyalty_inbox_reads loyalty_inbox_messages loyalty_observations loyalty_memberships loyalty_inbox_not_mine; do [ "$(Q "SELECT to_regclass('public.$t') IS NOT NULL")" = t ]; done
[ "$(COLS loyalty_memberships)" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier" ]
[ "$(Q "SELECT count(*) FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name LIKE 'ZQ42E Mig%'")" = 2 ]
MIG migrate:up
[ "$(COLS loyalty_stays)" = "award,check_in,check_out,confirmation_code,created_at,evidence_key,evidence_received_on,id,membership_id,nights,program_id,property,source,state,updated_at" ]
[ "$(Q "SELECT count(*) FROM loyalty_stays")" = 0 ]
Q "DELETE FROM loyalty_memberships WHERE program_id IN (SELECT id FROM loyalty_programs WHERE name LIKE 'ZQ42E Mig%')"
Q "DELETE FROM loyalty_programs WHERE name LIKE 'ZQ42E Mig%'"
Q "DELETE FROM household_members WHERE display_name='ZQ42E Mig'"
echo "OK migration up-down-up"
```
The `down` drops the data of both tables; the table list shows the stays rows inserted above vanish with it, and the row of `loyalty_memberships` survives (the second count). A leading-`!` guard is not used; `R` is the absence assertion.

**#7 (schema carried with the table list substituted; the new tables; forbidden columns; schema file in step).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md
case "$(sed -n '374p' "$S")" in 'set -e; U=postgresql://localhost/b8_p42a_throwaway'*) ;; *) echo "FAIL 42c2 line 374 moved"; exit 1;; esac
case "$(sed -n '376p' "$S")" in '[ "$(Q "SELECT string_agg(table_name'*) ;; *) echo "FAIL 42c2 line 376 moved"; exit 1;; esac
case "$(sed -n '392p' "$S")" in 'echo "OK schema"'*) ;; *) echo "FAIL 42c2 line 392 moved"; exit 1;; esac
A=374; Z=392; BODY="$(sed -n "${A},${Z}p" "$S")"
OLD='loyalty_programs,loyalty_sender_domains"'
NEW='loyalty_programs,loyalty_sender_domains,loyalty_stays"'
[ "$(printf '%s' "$BODY" | grep -oF "$OLD" | wc -l | tr -d ' ')" = 1 ]
OLD2='loyalty_earn_rules,loyalty_inbox_messages'
NEW2='loyalty_earn_rules,loyalty_inbox_booking_reads,loyalty_inbox_messages'
[ "$(printf '%s' "$BODY" | grep -oF "$OLD2" | wc -l | tr -d ' ')" = 1 ]
BODY="${BODY//$OLD/$NEW}"; BODY="${BODY//$OLD2/$NEW2}"
bash -c "$BODY"
U=postgresql://localhost/b8_p42a_throwaway; Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
FORBID='subject|body|snippet|content|header|text|from|local|recipient|member_number|raw|address|password|secret|token|prompt|output|response|guest|name|phone|card|price|total|amount|rate|cost'
[ "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('loyalty_stays','loyalty_inbox_booking_reads') AND column_name ~* '$FORBID'")" = 0 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_stays' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '\(\"?program_id\"?, \"?confirmation_code\"?\)'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_inbox_booking_reads' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '\(\"?dedupe_key\"?\)'")" = 1 ]
[ "$(Q "SELECT string_agg(confdeltype::text, ',') FROM pg_constraint WHERE conrelid='loyalty_stays'::regclass AND contype='f'")" = "a,a" ]
[ "$(Q "SELECT string_agg(confdeltype::text, ',') FROM pg_constraint WHERE conrelid='loyalty_inbox_booking_reads'::regclass AND contype='f'")" = "a,a,a" ]
for t in loyalty_stays loyalty_inbox_booking_reads; do
  B="$(awk -v t="$t" '$0 ~ "^CREATE TABLE (IF NOT EXISTS )?" t "[ (]" {f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
  [ -n "$B" ] || { echo "FAIL db/schema.sql lacks $t"; exit 1; }
done
for c in award check_in check_out confirmation_code evidence_key evidence_received_on nights property source state; do awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_stays[ (]/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql | grep -q "$c" || { echo "FAIL schema.sql stays lacks $c"; exit 1; }; done
for c in dedupe_key state attempts last_error_code kind reason suffix booking stay_id membership_id program_check read_on resolved_on; do awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_inbox_booking_reads[ (]/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql | grep -q "$c" || { echo "FAIL schema.sql booking reads lacks $c"; exit 1; }; done
[ "$(git ls-files migrations | xargs grep -ln 'loyalty_stays\|loyalty_inbox_booking_reads' | grep -vc '_loyalty_stays')" = 0 ]
echo "OK new tables"
```
(The foreign-key delete types are `a` (no action) on both tables: stays has the composite key and the program key; booking reads has program, membership and stay. The G0 reviewer re-measures these three strings against the guardian's schema.)

**#8 (contracts diff).**
```
set -e; B="$(git rev-parse HEAD)"; C=packages/contracts/loyalty.ts
[ "$(git diff --name-only "$B" -- packages | LC_ALL=C sort | tr '\n' ' ')" = "packages/contracts/loyalty.test.ts packages/contracts/loyalty.ts " ]
[ -z "$(git ls-files -o --exclude-standard packages)" ]
if git diff -U0 "$B" -- "$C" | grep -E '^-[^-]' | grep -vE '^-[[:space:]]*(\*|//|/\*)'; then echo "FAIL a non-comment line was removed or edited in $C"; exit 1; fi
for n in LOYALTY_STAY_MAX_NIGHTS LOYALTY_STAY_STATES LOYALTY_STAY_SOURCES LOYALTY_BOOKING_KINDS LOYALTY_BOOKING_HOLD_REASONS LOYALTY_BOOKING_ACTIONS LoyaltyStaySchema LoyaltyStayCreateRequestSchema LoyaltyBookingQueueItemSchema LoyaltyBookingNightsSchema LoyaltyBookingsSchema LoyaltyBookingResolveRequestSchema LoyaltyBookingResolveSchema LoyaltyStayResponseSchema LoyaltyBookingResolveResponseSchema; do [ "$(grep -cE "^export const $n\b" "$C")" = 1 ] || { echo "FAIL $n not exported exactly once"; exit 1; }; done
for n in LoyaltyStay LoyaltyStayCreateRequest LoyaltyBookingQueueItem LoyaltyBookings LoyaltyBookingResolveRequest LoyaltyBookingResolve; do [ "$(grep -cE "^export type $n =" "$C")" = 1 ] || { echo "FAIL type $n"; exit 1; }; done
[ "$(grep -cE 'LOYALTY_STAY_MAX_NIGHTS = 60' "$C")" = 1 ]
[ "$(grep -cE "LOYALTY_OBSERVATION_SOURCES = \['typed', 'import', 'email', 'screenshot'\] as const" "$C")" = 1 ]
[ "$(grep -cE '^[[:space:]]*screenshotDue: ' "$C")" = 1 ]
echo "OK contracts"
```

**#9 (integration: 42c2's block with total 417; carried and new families; leak checks).** The only edit to carried line 407 is replacing its two `370` with `417` (370, plus 3 from 42c3, 6 from 42c4, 23 from 42d, 15 here). T5 measures the unmodified total; the orchestrator corrects 417 before freezing if it differs.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }
U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; export O U
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
G 407 "node -e 'const r=JSON.parse(require(\"fs\")"; G 408 'LEFT="$(psql '; G 409 '[ "$LEFT" = '; G 410 'echo "OK no fixture rows left"'
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
L407="$(sed -n '407p' "$S")"
[ "$(printf '%s' "$L407" | grep -o '370' | wc -l | tr -d ' ')" = 2 ]
bash -c "${L407//370/417}"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];const one=(title)=>{const m=t.filter(x=>x.title.startsWith(title));if(m.length!==1||m[0].status!=="passed")bad.push(title+"="+m.map(x=>x.status).join("/")+"("+m.length+")")};const inFile=(re,file,n)=>{const f=r.testResults.filter(x=>x.assertionResults.some(a=>re.test(a.title)));if(f.length!==1||!f[0].name.endsWith("apps/web/app/api/v1/loyalty/"+file))bad.push(String(re)+" files="+f.length);else if(f[0].assertionResults.filter(a=>re.test(a.title)).length!==n)bad.push(String(re)+" count")};for(let i=1;i<=3;i++)one("T42c3-I"+i+":");for(let i=1;i<=6;i++)one("T42c4-I"+i+":");for(let i=1;i<=13;i++)one("T42d-I1."+i+":");for(let i=2;i<=11;i++)one("T42d-I"+i+":");for(let i=1;i<=15;i++)one("T42e1-I"+i+":");inFile(/^T42c3-I\d+:/,"loyaltyReadForwards.test.ts",3);inFile(/^T42c4-I\d+:/,"loyaltyReadRobust.test.ts",6);inFile(/^T42d-I1\.\d+:/,"loyaltyScreenshotDue.test.ts",13);inFile(/^T42d-I\d+:/,"loyaltyScreenshot.test.ts",10);const ids=[1,2,3,4,5,6,7,9,10,11];const a=r.testResults.filter(x=>x.name.endsWith("apps/web/app/api/v1/loyalty/loyaltyBookingRead.test.ts"));const b=r.testResults.filter(x=>x.name.endsWith("apps/web/app/api/v1/loyalty/loyaltyBookings.test.ts"));if(a.length!==1||a[0].assertionResults.length!==10)bad.push("loyaltyBookingRead.test.ts count");if(b.length!==1||b[0].assertionResults.length!==5)bad.push("loyaltyBookings.test.ts count");if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("OK T42c3-I1-I3, T42c4-I1-I6, T42d-I1.1-I1.13, T42d-I2-I11 and T42e1-I1-I15 each present once and passed in their files")' "$O"
bash -c "$(sed -n -e 408p -e 409p -e 410p "$S")"
LEFT2="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "select (select count(*) from loyalty_programs where name like 'ZQ42E%' or name like 'ZQ42D%')||','||(select count(*) from household_members where display_name like 'ZQ42E%' or display_name like 'ZQ42D%')||','||(select count(*) from loyalty_sender_domains where domain like '%zq42e%' or domain like '%zq42d%')||','||(select count(*) from pg_trigger where tgname like 'zq42e%' or tgname like 'zq42d%')||','||(select count(*) from pg_proc where proname like 'zq42e%' or proname like 'zq42d%')")"
[ "$LEFT2" = "0,0,0,0,0" ] || { echo "FAIL ZQ42 leftovers: $LEFT2"; exit 1; }
echo "OK no ZQ42E rows or test triggers left"
LEFT3="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "select (select count(*) from loyalty_inbox_booking_reads)||','||(select count(*) from loyalty_stays)")"
[ "$LEFT3" = "0,0" ] || { echo "FAIL rows left in the new tables: $LEFT3"; exit 1; }
echo "OK new tables empty"
```

**#10 (integration stability, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 416 420 'set -e; unset ANTHROPIC_API_KEY' 'bash -c '
```

**#11 (regression block, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 426 440 'set -e; unset ANTHROPIC_API_KEY' 'BODY="$(sed -n '
```
This block re-runs 42c1's TZ-pinned contracts-and-UI test files, including `packages/contracts/loyalty.test.ts` (one edited line), and the 42b class block.

**#12 (surface over real HTTP; 42d's command 11 rewritten for H17).** The carried 42d line expects `OK H1-H16`; this is the same check with 17 steps.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
OUT="$(mktemp)"; SRC=apps/web/scripts/gifts-surface-check.mjs
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
node "$SRC" > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ] || { echo "FAIL H$i not exactly once"; exit 1; }; done
[ "$(tail -1 "$OUT")" = "OK H1-H17" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
[ "$(grep -cE "LOYALTY_IMAP_(HOST|PORT|TLS|USER|PASSWORD)" "$SRC")" -ge 5 ]
[ "$(grep -cF 'ANTHROPIC_API_KEY' "$SRC")" -ge 1 ]
[ "$(grep -cF "current = 'H17'" "$SRC")" = 1 ]
[ "$(grep -cF '/api/v1/loyalty/stays' "$SRC")" -ge 2 ]
[ "$(grep -cF '/api/v1/loyalty/inbox/bookings/' "$SRC")" -ge 2 ]
if git diff -U0 HEAD -- "$SRC" | grep -E '^-[^-]' | grep -vE 'H1-H16|H16'; then echo "FAIL the script lost a line other than the summary or header mention of H16"; exit 1; fi
echo "OK surface"
```
**H17 must assert, over real HTTP for both people, with no `ANTHROPIC_API_KEY` in the server's environment.** Setup by `psql`: a hotel program `ZQ42E Surface Hotel` with one membership (a member-number canary), and one `pending` booking-read row whose JSON object carries a confirmation-code canary, a suffix and dates, with candidate memberships. Then: (a) the stays route answers 401 with no credential, 403 with a read-scope token, 400 for a body holding `source`, `nights`, an extra key, a code of three characters, a check-out not after the check-in and a non-hotel membership, and 201 for a valid typed completed stay (check-out three days before today, two nights) and a valid typed upcoming stay; a second POST with the same code answers 200 and updates the same row; (b) after that, `/travel` for the owner and for the second user contains `Hotel stays` exactly once and `2 nights counted in <year>` (year from `psql`) exactly once, contains `Upcoming` and `Completed this year`, contains the masked code and never the code canary or the member-number canary, and the two users' pages show identical section text; (c) the resolve route answers 401, 403, then 200 `placed_by_hand` for `place` on the membership, a second place answers 409, and the stay then appears; (d) a typed POST with `state: cancelled` for the completed stay leaves `/travel` showing `—` and `No stay counted yet` for that membership and the stay absent from both lists, while `psql` shows the row still present with `state` cancelled; (e) H15's and H16's pinned `expectAbsent` phrases stay absent and H16's control count assertion is not disturbed (H17 runs after it); (f) the canaries appear in no response of the step, including every API answer.

**#13 (fixture pins, carried; nothing changed).** Identical to 42d's command 12:
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

**#14 (registry).**
```
set -ef; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs
D="$(git diff -U0 HEAD -- "$R" | grep -E '^[+-][^+-]' | LC_ALL=C sort | tr '\n' '|')"
E="+  { file: 'app/api/v1/loyalty/inbox/bookings/[id]/route.ts', classes: ['no-transaction-data'] },|+  { file: 'app/api/v1/loyalty/stays/route.ts', classes: ['no-transaction-data'] },|"
[ "$D" = "$E" ] || { echo "FAIL registry diff is not exactly the two route lines: $D"; exit 1; }
p="{ file: 'app/travel/page.tsx', classes: ['numeric-only'] },"; [ "$(grep -cF -- "$p" "$R")" = 1 ]
p="'app/travel/page.tsx': { cls: 'numeric-only', url: () => '/travel' },"; [ "$(grep -cF -- "$p" "$X")" = 1 ]
[ "$(grep -cF "app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts', classes: ['numeric-only']" "$R")" = 1 ]
echo "OK registry"
```
`T41b-W4` in the unit suite proves the registry lists exactly the `route.ts` files on disk.

**#15 (the seven pin edits, by exact diff).** The edits are made at G1/G2 by the orchestrator (the five integration files and `apps/web/lib/loyalty.test.ts`) and by contract-guardian (the contracts test), before any implementation, as 42d did.
```
set -f; B="$(git rev-parse HEAD)"; L=apps/web/app/api/v1/loyalty
CHANGED="$(git diff --name-only "$B" -- '*.test.ts' '*.test.tsx' '*.test.mts' | LC_ALL=C sort | tr '\n' ' ')"
[ "$CHANGED" = "apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/app/api/v1/loyalty/loyaltyRead.test.ts apps/web/lib/loyalty.test.ts apps/web/lib/loyaltyReadUi.test.ts packages/contracts/loyalty.test.ts " ] || { echo "FAIL changed tracked tests: $CHANGED"; exit 1; }
for f in $L/loyalty.test.ts $L/loyaltyCard.test.ts $L/loyaltyEarn.test.ts $L/loyaltyInbox.test.ts $L/loyaltyRead.test.ts; do
  [ "$(git diff -U0 "$B" -- "$f" | grep -cE '^-[^-]')" = 1 ] || { echo "FAIL $f removed lines"; exit 1; }
  [ "$(git diff -U0 "$B" -- "$f" | grep -cE '^\+[^+]')" = 1 ] || { echo "FAIL $f added lines"; exit 1; }
  [ "$(git diff -U0 "$B" -- "$f" | grep -E '^-[^-]' | grep -cF 'toHaveLength(16);')" = 1 ] || { echo "FAIL $f removed line is not the sixteen pin"; exit 1; }
  [ "$(git diff -U0 "$B" -- "$f" | grep -E '^\+[^+]' | grep -cF 'toHaveLength(18);')" = 1 ] || { echo "FAIL $f added line is not the eighteen pin"; exit 1; }
done
LT=apps/web/lib/loyalty.test.ts
[ "$(git diff -U0 "$B" -- "$LT" | grep -cE '^-[^-]')" = 1 ] || { echo "FAIL $LT removed lines"; exit 1; }
[ "$(git diff -U0 "$B" -- "$LT" | grep -cE '^\+[^+]')" = 3 ] || { echo "FAIL $LT added lines"; exit 1; }
[ "$(git diff -U0 "$B" -- "$LT" | grep -E '^-[^-]' | grep -cF 'OK H1-H16')" = 1 ]
[ "$(git diff -U0 "$B" -- "$LT" | grep -E '^\+[^+]' | grep -cF 'OK H1-H17')" = 1 ]
[ "$(git diff -U0 "$B" -- "$LT" | grep -E '^\+[^+]' | grep -cF "'app/api/v1/loyalty/stays/route.ts',")" = 1 ]
[ "$(git diff -U0 "$B" -- "$LT" | grep -E '^\+[^+]' | grep -cF "'app/api/v1/loyalty/inbox/bookings/[id]/route.ts',")" = 1 ]
RU=apps/web/lib/loyaltyReadUi.test.ts
[ "$(git diff -U0 "$B" -- "$RU" | grep -E '^[+-][^+-]' | tr '\n' '|')" = "-  ...actionProblems(sources, 'not_mine', 'Not mine'),|-  ...actionProblems(sources, 'ignore', 'Ignore'),|+  ...actionProblems(sources.filter((s) => s.file !== 'components/LoyaltyStaysSection.tsx'), 'not_mine', 'Not mine'),|+  ...actionProblems(sources.filter((s) => s.file !== 'components/LoyaltyStaysSection.tsx'), 'ignore', 'Ignore'),|" ] || { echo "FAIL $RU changed beyond A3"; exit 1; }
CT=packages/contracts/loyalty.test.ts
[ "$(git diff -U0 "$B" -- "$CT" | grep -cE '^-[^-]')" = 1 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -cE '^\+[^+]')" = 1 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^-[^-]' | grep -cF 'expect(responses.length).toBe(10);')" = 1 ]
[ "$(git diff -U0 "$B" -- "$CT" | grep -E '^\+[^+]' | grep -cF 'expect(responses.length).toBe(12);')" = 1 ]
echo "OK pins exact"
```
Note that `T42c2-I9`'s panel key list, `T42c4-I6`, `EMPTY_READ` and the `screenshotDue` lines are deliberately NOT in this list: they are untouched, and command 9 proves their tests still pass.

**#16 (source guards).** Several guards fail on today's tree on purpose (the new files do not exist).
```
set -ef; B="$(git rev-parse HEAD)"
NEW="apps/web/app/api/v1/loyalty/stays/route.ts apps/web/app/api/v1/loyalty/inbox/bookings/[id]/route.ts apps/web/lib/domain/loyaltyBooking.ts apps/web/lib/loyaltyBookingRead.ts apps/web/lib/loyaltyBookingStore.ts apps/web/components/LoyaltyStaysSection.tsx"
CHG="apps/web/lib/loyaltyReader.ts apps/web/lib/scheduler.ts apps/web/components/TravelBoard.tsx apps/web/app/travel/page.tsx"
TESTS="apps/web/lib/domain/loyaltyBooking.test.ts apps/web/lib/loyaltyBookingReader.test.ts apps/web/lib/loyaltyBookingContract.test.ts apps/web/lib/loyaltyBookingUi.test.ts apps/web/app/api/v1/loyalty/loyaltyBookingRead.test.ts apps/web/app/api/v1/loyalty/loyaltyBookings.test.ts"
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
for f in $NEW $TESTS; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|parseInt|toFixed|Math\.round'
for f in $NEW $CHG $TESTS; do
  [ ! -f "$f" ] && continue
  if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi
  if added "$f" | grep -nE '^[[:space:]]*(//|/\*|\*)' | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment of $f"; exit 1; fi
done
for f in $NEW $CHG; do
  if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
  if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
  if added "$f" | grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+(transactions|accounts|account_valuations)([^[:alnum:]_]|$)|visibleTransactions'; then echo "FAIL a ledger read in $f"; exit 1; fi
done
for f in apps/web/components/LoyaltyStaysSection.tsx apps/web/components/TravelBoard.tsx apps/web/app/travel/page.tsx; do
  if added "$f" | grep -nE 'raw_mail|member_number|dangerouslySetInnerHTML|innerHTML|process\.env|@/lib/db'; then echo "FAIL forbidden text in $f"; exit 1; fi
done
if grep -nE 'confirmation_code|confirmationCode' apps/web/components/LoyaltyStaysSection.tsx | grep -vE 'name=|ariaLabel|label'; then echo "FAIL a component refers to the full code"; exit 1; fi
[ "$(grep -cE "from '@anthropic-ai/sdk'" apps/web/lib/loyaltyBookingRead.ts apps/web/lib/loyaltyBookingStore.ts apps/web/lib/domain/loyaltyBooking.ts | grep -vc ':0$')" = 0 ]
[ "$(added apps/web/lib/loyaltyReader.ts | grep -c 'maxRetries: 0')" -ge 2 ]
if grep -nE 'INSERT INTO loyalty_observations' $NEW; then echo "FAIL a booking file writes observations"; exit 1; fi
if grep -nE 'DELETE FROM loyalty_stays' $NEW; then echo "FAIL a booking file deletes stays"; exit 1; fi
if grep -nE 'DELETE FROM loyalty_inbox_reads|UPDATE loyalty_inbox_reads|INSERT INTO loyalty_inbox_reads' $NEW; then echo "FAIL a booking file touches the balance reads table"; exit 1; fi
[ "$(grep -cE "'Hotel stays'|>Hotel stays<|Hotel stays" apps/web/components/LoyaltyStaysSection.tsx)" -ge 1 ]
for IT in $TESTS; do
  if grep -nE "['\"][-]?[0-9]+\.[0-9]{2,4}['\"]" "$IT"; then echo "FAIL a decimal figure literal in $IT"; exit 1; fi
  if grep -nE "['\"][0-9]{4,}['\"]" "$IT"; then echo "FAIL a digit-only quoted string of four or more digits in $IT"; exit 1; fi
done
echo "OK source guards"
```

**#17 (scope guard).**
```
set -f; B="$(git rev-parse HEAD)"; [ "$B" = "$(git merge-base HEAD main)" ]
CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
OUT="$(grep -vE '^(apps/web/app/api/v1/loyalty/loyalty(Card|Earn|Inbox|Read)?\.test\.ts|apps/web/lib/loyalty\.test\.ts|apps/web/lib/loyaltyReadUi\.test\.ts|packages/contracts/loyalty\.ts|packages/contracts/loyalty\.test\.ts|migrations/[0-9]+_loyalty_stays\.sql|db/schema\.sql|apps/web/lib/loyaltyReader\.ts|apps/web/lib/scheduler\.ts|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/scripts/gifts-surface-check\.mjs|apps/web/lib/domain/loyaltyBooking(\.test)?\.ts|apps/web/lib/loyaltyBooking(Read|Store|Reader\.test|Contract\.test|Ui\.test)\.ts|apps/web/app/api/v1/loyalty/stays/route\.ts|apps/web/app/api/v1/loyalty/inbox/bookings/\[id\]/route\.ts|apps/web/app/api/v1/loyalty/loyaltyBookingRead\.test\.ts|apps/web/app/api/v1/loyalty/loyaltyBookings\.test\.ts|apps/web/components/LoyaltyStaysSection\.tsx|apps/web/components/TravelBoard\.tsx|apps/web/app/travel/page\.tsx)$' "$CH" || true)"
[ -z "$OUT" ] || { echo "OUTSIDE THE ALLOWED SET:"; echo "$OUT"; exit 1; }
for f in packages/contracts/loyalty.ts db/schema.sql apps/web/lib/loyaltyReader.ts apps/web/lib/scheduler.ts apps/web/lib/domain/loyaltyBooking.ts apps/web/lib/loyaltyBookingRead.ts apps/web/lib/loyaltyBookingStore.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/scripts/gifts-surface-check.mjs apps/web/components/LoyaltyStaysSection.tsx apps/web/components/TravelBoard.tsx apps/web/app/travel/page.tsx; do grep -qxF "$f" "$CH" || { echo "MISSING $f"; exit 1; }; done
[ "$(grep -cE '^migrations/' "$CH" | tr -d ' ')" = 1 ] || { echo "FAIL not exactly one migration file"; exit 1; }
[ -z "$(git diff --name-only "$B" -- apps/web/package.json package.json package-lock.json 'apps/web/vitest*' 'apps/web/eslint*' eslint.config.mjs evals apps/web/app/manifest.ts apps/web/lib/receipt.ts apps/web/lib/receiptReader.ts apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/domain/loyaltyRead.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/domain/loyaltyScreenshot.ts apps/web/lib/fixtures apps/web/app/api/v1/loyalty/memberships apps/web/app/api/v1/receipts)" ] || { echo "FAIL a frozen file changed"; exit 1; }
echo "OK scope"
```

**#18 (census).**
```
set -f; B="$(git rev-parse HEAD)"
NEW="$(git ls-files -o --exclude-standard | grep -E '\.test\.(ts|tsx|mts)$' | sort | tr '\n' ' ')"
[ "$NEW" = "apps/web/app/api/v1/loyalty/loyaltyBookingRead.test.ts apps/web/app/api/v1/loyalty/loyaltyBookings.test.ts apps/web/lib/domain/loyaltyBooking.test.ts apps/web/lib/loyaltyBookingContract.test.ts apps/web/lib/loyaltyBookingReader.test.ts apps/web/lib/loyaltyBookingUi.test.ts " ] || { echo "FAIL the set of new test files is wrong: $NEW"; exit 1; }
cnt(){ [ "$(grep -cE "^[[:space:]]*(it|test)\(" "$1")" = "$2" ] || { echo "FAIL $1 does not hold exactly $2 tests"; exit 1; }; [ "$(grep -cE "^[[:space:]]*(it|test)\('T42e1-$3" "$1")" = "$2" ] || { echo "FAIL $1 titles do not all start T42e1-$3"; exit 1; }; }
cnt apps/web/lib/domain/loyaltyBooking.test.ts 7 U
cnt apps/web/lib/loyaltyBookingReader.test.ts 3 U
cnt apps/web/lib/loyaltyBookingContract.test.ts 3 U
cnt apps/web/lib/loyaltyBookingUi.test.ts 2 U
cnt apps/web/app/api/v1/loyalty/loyaltyBookingRead.test.ts 10 I
cnt apps/web/app/api/v1/loyalty/loyaltyBookings.test.ts 5 I
echo "OK census exact"
```

**#19 (baseline and stub proof).** Part A swaps each NEW source file for the smallest plausible no-op and each CHANGED file for `HEAD`'s version, then runs every new scenario: each must fail on an assertion, not a setup error. The stubs export the names fixed in "Prerequisites the implementer creates" (`cleanBooking` returns `{ kind: 'none', … null }`, `normaliseConfirmationCode` returns null, `nightsBetween` returns 0, `placeBooking` returns `{ kind: 'discard' }`, `supersedes` returns true; `readStoredBookings` returns an all-zero `ok` run, `purgeExpiredBookingReads` returns 0, `runLoyaltyBookingsDaily` resolves, `resolveBooking` returns `{ ok: false, code: 'NOT_FOUND' }`; `saveTypedStay` returns `{ ok: false, code: 'INVALID_INPUT' }`, `loadBookings` returns an empty payload; routes answer 200 with `data: null`; the component returns null). Part B restores everything by absolute path and proves it by checksum. `[` and `]` in route paths are quoted throughout.
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
    domain) printf '%s\n' "export const cleanBooking = () => ({ kind: 'none', suffix: null, programName: null, property: null, checkIn: null, checkOut: null, code: null, award: null });" "export const normaliseConfirmationCode = () => null;" "export const nightsBetween = () => 0;" "export const placeBooking = () => ({ kind: 'discard' });" "export const supersedes = () => true;" > "$2";;
    read) printf '%s\n' "export const readStoredBookings = async () => ({ outcome: 'ok', read: 0, recorded: 0, queued: 0, stale: 0, none: 0, flights: 0, noBooking: 0, discarded: 0, failed: 0, remaining: 0, errorCode: null });" "export const purgeExpiredBookingReads = async () => 0;" "export const runLoyaltyBookingsDaily = async () => {};" "export const resolveBooking = async () => ({ ok: false, code: 'NOT_FOUND' });" > "$2";;
    store) printf '%s\n' "export const saveTypedStay = async () => ({ ok: false, code: 'INVALID_INPUT' });" "export const loadBookings = async () => ({ year: 2000, nights: [], upcoming: [], completed: [], queue: [] });" > "$2";;
    comp) printf '%s\n' "export default function LoyaltyStaysSection() { return null; }" > "$2";;
  esac; }
restore(){ while IFS= read -r f; do [ -n "$f" ] && cp "$K/$f" "$ROOT/$f"; done < "$K/list"; : > "$K/list"; }
trap restore EXIT
SETUP='ECONNREFUSED|Cannot find module|Failed to resolve|SyntaxError|is not defined|is not a function|is not a constructor|ENOENT'
check(){ node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const want=process.argv[2].split(" ");const bad=[];for(const w of want){const m=t.filter(x=>x.title.startsWith(w+":"));if(m.length!==1||m[0].status!=="failed"){bad.push(w+"="+m.map(x=>x.status).join("/")+"("+m.length+")");continue}if(new RegExp(process.argv[3]).test(m[0].failureMessages.join(" ")))bad.push(w+" failed on a setup error, not an assertion")}if(bad.length){console.log("FAIL",bad.join(","));process.exit(1)}console.log("ok "+want.length+" scenarios fail as required")' "$1" "$2" "$SETUP"; }
swap domain apps/web/lib/domain/loyaltyBooking.ts
swap read apps/web/lib/loyaltyBookingRead.ts
swap store apps/web/lib/loyaltyBookingStore.ts
swap route "apps/web/app/api/v1/loyalty/stays/route.ts"
swap route "apps/web/app/api/v1/loyalty/inbox/bookings/[id]/route.ts"
swap comp apps/web/components/LoyaltyStaysSection.tsx
swap head apps/web/lib/loyaltyReader.ts
swap head apps/web/lib/scheduler.ts
swap head apps/web/components/TravelBoard.tsx
swap head apps/web/app/travel/page.tsx
swap head packages/contracts/loyalty.ts
OU="$(mktemp)"; (cd apps/web && npx vitest run lib/domain/loyaltyBooking.test.ts lib/loyaltyBookingReader.test.ts lib/loyaltyBookingContract.test.ts lib/loyaltyBookingUi.test.ts --reporter=json --outputFile="$OU") || true
OI="$(mktemp)"; (cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyBookingRead.test.ts app/api/v1/loyalty/loyaltyBookings.test.ts --reporter=json --outputFile="$OI") || true
restore
check "$OU" "T42e1-U1 T42e1-U2 T42e1-U3 T42e1-U4 T42e1-U5 T42e1-U6 T42e1-U7 T42e1-U8 T42e1-U9 T42e1-U10 T42e1-U11 T42e1-U12 T42e1-U13 T42e1-U14 T42e1-U15"
check "$OI" "T42e1-I1 T42e1-I2 T42e1-I3 T42e1-I4 T42e1-I5 T42e1-I6 T42e1-I7 T42e1-I8 T42e1-I9 T42e1-I10 T42e1-I11 T42e1-I12 T42e1-I13 T42e1-I14 T42e1-I15"
echo "OK stubs fail every scenario"
[ "$S0" = "$(SNAP)" ] || { echo "FAIL the implementer's tree was not restored"; exit 1; }
echo "OK tree restored"
```
Every scenario is expected to fail against these stubs; a scenario that a constant stub could satisfy is a vacuous scenario and a G0 FAIL, to be rewritten rather than dropped from the list. Because the stubs replace the migration-independent code only, the migration remains applied; the integration scenarios therefore also fail for the right reason (nothing is written by the stubs), not because tables are missing.

**#21 (this spec's public-safety scan).**
```
set -e; S=plan/tasks/P8-42e1-loyalty-stays/SPEC.md; T="$(mktemp)"; sed -E 's/[0-9a-f]{64}//g; s/1793[0-9]{9}//g' "$S" > "$T"
if grep -nE '\$[0-9]{3,}|\$[0-9]{1,3},[0-9]{3}|\$[0-9]+\.[0-9]{2}' "$T"; then echo "FAIL a dollar figure in the spec"; exit 1; fi
if grep -nE '[0-9]{1,3}(,[0-9]{3})+' "$T"; then echo "FAIL a thousands-separated figure in the spec"; exit 1; fi
BAD="$(grep -oE '[0-9]{6,}' "$T" | sort -u || true)"
[ -z "$BAD" ] || { echo "FAIL a long number in the spec: $BAD"; exit 1; }
if grep -nEi 'member number [0-9]|balance of [0-9]' "$T"; then echo "FAIL a balance or number stated in the spec"; exit 1; fi
echo "OK spec has no money-looking text"
```

**#22 (mutation evidence).** The implementer records in `plan/tasks/P8-42e1-loyalty-stays/EVIDENCE.md` one row per deliberate single-line break: `| M<n> | <file and change in words> | <failing test id> | FAIL | reverted, green |`.
```
set -e; E=plan/tasks/P8-42e1-loyalty-stays/EVIDENCE.md
[ -f "$E" ]
N="$(grep -cE '^\| M[0-9]+ \|.*\| FAIL \|.*reverted' "$E")"
[ "$N" -ge 20 ] || { echo "FAIL only $N mutation rows with FAIL and reverted"; exit 1; }
for id in T42e1-U1 T42e1-U2 T42e1-U3 T42e1-U6 T42e1-U7 T42e1-U8 T42e1-U9 T42e1-U10 T42e1-I1 T42e1-I2 T42e1-I3 T42e1-I4 T42e1-I5 T42e1-I6 T42e1-I7 T42e1-I8 T42e1-I9 T42e1-I10 T42e1-I12 T42e1-I13 T42e1-I14; do grep -qF "$id" "$E" || { echo "FAIL no mutation row names $id"; exit 1; }; done
if grep -nE '\$[0-9]{3,}|[0-9]{1,3}(,[0-9]{3})+' "$E"; then echo "FAIL EVIDENCE.md holds a money-looking figure"; exit 1; fi
echo "OK mutation evidence rows $N"
```

### What was not carried, and why
- 42c2's #5 (its migration command) is not carried: it requires the latest migration name to contain `loyalty_inbox_read`, which this task's migration breaks by design. Command 6 replaces it.
- 42c2's #6 is carried with two literal substitutions of its table list (command 7), because the new tables change that list; it is the only carried line edited besides line 407's total.
- 42d's #3 to #8 and #15 to #17 pin 42d's own change set; their intent is rewritten as commands 3, 5, 8, 15, 16, 17 and 18.
- The 42d `T42d-I1.1`..`I11` and `T42d-U1`..`U13` are asserted present and passed (commands 4 and 9), so the panel, the screenshot routes and the five-statement snapshot are re-proven on the new tree.

## Scenarios
Fixture canary `ZQ42E`. Each integration scenario seeds what it asserts on and removes it, including rows in `loyalty_stays` and `loyalty_inbox_booking_reads`; fault or interleave means are installed and removed in a `finally`. The model is faked by mocking `createBookingReader` in `@/lib/loyaltyReader` (or injecting a client in reader unit tests); its raw answers are fabricated objects, including injected keys (`guestName`, `address`, `phone`, `cardLast4`, `total`) and a full printed member number in the suffix field. A message is a fabricated RFC 822 text built in the test and stored with `INSERT INTO loyalty_inbox_messages`. Captured console lines are the whole file's, each a JSON line with `level`, `scope`, `message`. A hotel program is `kind = 'hotel'`; one airline-kind program is seeded where the scenario says so.

### Unit scenarios (no database)
| Id | Observable rule | Setup and assertion | Catches |
|---|---|---|---|
| T42e1-U1 | **cleanBooking, kinds and injection (D14).** Only the four kinds are accepted; an unknown or missing `kind`, a non-object, an array and `null` all give kind `none` with every other field null. A flight kind keeps every other field null (nothing is extracted from a flight). Injected keys (`guestName`, `address`, `phone`, `cardLast4`, `total`) never appear in the result, and a reading of `keys(result)` is exactly the eight clean fields. | Table of raw objects; the keys are compared with a fixed list. | the model's extra keys surviving; a flight extracting fields |
| T42e1-U2 | **Dates and nights (D6, D11).** A date that is not a real calendar date (`2026-02-30`, `2026-13-01`, `2026-1-1`, a date with time) is null; when either date is null or check-out is not strictly after check-in, BOTH dates are null; more than `LOYALTY_STAY_MAX_NIGHTS` nights gives both null; exactly 60 nights is kept and 61 is not; `nightsBetween` is 1 for adjacent days, counts across a month end, across a year end, across 29 February of a leap year (one more than the same days in a common year) and is never computed through a Date object (the test also asserts the result is identical under two `TZ` values). | Table; run under both time zones. | a `<=` off by one; a leap-year error; a time-zone dependence |
| T42e1-U3 | **Confirmation code (D6, D13).** `normaliseConfirmationCode` upper-cases and drops every non-letter, non-digit (`zq42e-ab 12` → `ZQ42EAB12`); returns null for fewer than 4 or more than 20 characters after normalisation, for null, a number, an object, an empty string and a string of only punctuation; two spellings differing in case, spaces or dashes give the same result; a non-ASCII letter is dropped and cannot create a match. | Table. | a code kept with punctuation; a short code accepted; a duplicate split by formatting |
| T42e1-U4 | **Property and award (D14, D15).** The property is trimmed, whitespace-collapsed, kept at 80 characters or fewer, and null when it holds `<`, `>`, a control character or a newline, is empty after trimming, or is 81 characters (it is never cut); `award` is true only for the boolean `true`, false only for the boolean `false`, null for anything else (the strings `"true"`, `"yes"`, `1`). | Table. | markup stored; a truncated name; a string coerced to true |
| T42e1-U5 | **Reader answer to a clean booking.** A `hotel_booked` raw answer with a valid code and dates yields those fields; a `hotel_booked` answer with no usable code is returned with `code` null (the pass later stores nothing); suffix goes through the 42c2 `keepSuffix` (a full printed number keeps its last four characters only). | Fabricated answers. | a full number surviving; a missing code accepted |
| T42e1-U6 | **Attribution decision (D9).** One table row per case, input (program check, suffix, suffix match result, forwarder membership, not-mine hit) and the exact decision: program `mismatch` holds `program_mismatch` even when everything else would place; unique suffix match with no forwarder places on the match; unique match equal to the forwarder's membership places; unique match different from the forwarder's holds `forwarder_conflict` (negative control: it must NOT place on either); no suffix with a forwarder places on the forwarder; no suffix and no forwarder holds `no_suffix`; an unmatched suffix not on the not-mine list holds `unmatched_suffix`; an unmatched suffix on the not-mine list is `discard`; an ambiguous suffix holds `ambiguous_suffix`, with no forwarder and with a forwarder (the forwarder never breaks an ambiguity); a suffix present with the forwarder having no stored number and no match holds `unmatched_suffix` (the forwarder alone does not place a mail that printed a number). | Pure table. | a guess; a forwarder overriding a contradicting number; an ambiguity resolved by order |
| T42e1-U7 | **Supersession (D8).** `supersedes(existing, incoming)` for the full grid of existing state (booked or cancelled), existing evidence date (none, earlier, equal, later than the incoming) and incoming kind (booked or cancelled): applies with no evidence; applies for a strictly later mail whatever the existing state (a later booking re-books a cancelled stay); applies for an equal date when the mail cancels; applies for an equal date when both are booked; does NOT apply for an equal date when the stay is cancelled and the mail is a booking; does NOT apply for an earlier mail whatever the state. | Grid of 16 rows. | a re-forwarded old confirmation resurrecting a cancelled stay; ordering by arrival |
| T42e1-U8 | **Reader: nothing sent without a key, one bounded request, mail only.** With no usable key and a fake client counting calls: result `{ ok: false, code: 'api_error' }`, zero calls. With a key and a fake client: exactly one `messages.create`; the user message is one text block holding the mail inside the fence; the system prompt is `BOOKING_SYSTEM_PROMPT`, matching `untrusted` and `never follow`, and asking for no guest name, address, phone, card, price or total; `output_config.format.schema` deep-equals `BOOKING_SCHEMA`; options carry `maxRetries` 0 and a timeout from `readTimeoutSeconds`; no household canary (program name, member name, number, id) appears anywhere in the request body. | Canaries passed through the test's world. | a request without a key; household data sent; a hidden retry |
| T42e1-U9 | **Reader: every failure classified, none leaks, the success is untouched.** Rate limit → `rate_limited`; connection timeout → `timeout`; other error → `api_error`; refusal stop → `refused`; empty or invalid text → `bad_output`; the captured logs contain none of the error-text canary, the mail text, the key, the model's text, a code or a date. A success returns the model's object unchanged as `reading` and logs only `model`, `inputTokens`, `outputTokens`. | Fake errors carry canary text. | a throw escaping; an error text or a value in a log; cleaning in the wrong layer |
| T42e1-U10 | **Schemas: `BOOKING_SCHEMA` is closed and `READ_SCHEMA` is untouched.** `BOOKING_SCHEMA` lists exactly the eight keys, all required, `additionalProperties: false` at every depth, `kind` enumerating exactly the four kinds, and has no property whose name matches `name|address|phone|card|price|total|amount|guest`. `READ_SCHEMA`'s property list equals the 42c2 seven keys and its `required` list equals the same seven (a widened `READ_SCHEMA` fails here). | Plain assertions on the exported constants. | the balance schema widened; an open schema |
| T42e1-U11 | **Contracts: stay and bookings payload.** `LoyaltyStaySchema` accepts a full stay and one with null `property` and null `award`; refuses an unknown key (`confirmationCode`, `code`, `guestName`, `price`, `source: 'x'`), a `maskedCode` that is not four bullets plus 0, 3 or 4 characters (a six-letter code is refused), a nights value that is not the difference of its dates, a state other than the two, nights above the maximum. `LoyaltyBookingsSchema` accepts empty arrays; refuses a null array, a repeated or descending membership id in `nights`, a `nightsThisYear` of 0 or negative or fractional, a queue longer than `LOYALTY_READ_QUEUE_LIMIT`, an unordered queue, candidates not ascending, a `completed` or `upcoming` stay that is cancelled. | Tables of valid and invalid objects. | a full code in a payload; a zero where null is meant |
| T42e1-U12 | **Contracts: requests.** `LoyaltyStayCreateRequestSchema` accepts a valid body; refuses `source`, `nights`, `id`, any extra key, a missing key, a code with fewer than 4 or more than 20 characters after normalisation, a check-out not after check-in, more than the maximum nights, a bad calendar date, a state other than `booked` or `cancelled`, a non-boolean award; the first issue's message never contains a submitted value. `LoyaltyBookingResolveRequestSchema` accepts `place` with a positive integer `membershipId`, `not_mine` and `ignore` with no other key; refuses `place` without or with a non-integer id, and `ignore` or `not_mine` with a `membershipId`. | Tables. | a client choosing its source or nights; echoing input |
| T42e1-U13 | **Contracts: exports and the pinned family.** Each new export is read by name from the namespace and present; `LOYALTY_BOOKING_KINDS`, `LOYALTY_BOOKING_HOLD_REASONS`, `LOYALTY_BOOKING_ACTIONS`, `LOYALTY_STAY_STATES`, `LOYALTY_STAY_SOURCES` equal their listed values in order; `LOYALTY_STAY_MAX_NIGHTS` is the integer 60; the two response wrappers accept a success envelope with a valid data object and a failure envelope; `LoyaltyErrorCodeSchema` options are unchanged (the twelve of today, no new one); `LOYALTY_OBSERVATION_SOURCES` is unchanged. | Namespace import. | a renamed export; a new error code added by stealth |
| T42e1-U14 | **Section wording and behaviour (source scan).** Each pinned string of "Description of the Hotel stays section" occurs exactly once in `LoyaltyStaysSection.tsx` and its client code; the submit is disabled while saving; the form sends no `source` key and no `nights` key; `award` and `property` default to null when blank, never to `false` or an empty string; the nights line uses `—` for null and has no `?? 0` or `|| 0`; the hold buttons are conditioned on the queue being non-empty; no markup injection. | Reads the source text. | a zero shown for no data; a client choosing its fields |
| T42e1-U15 | **Board wiring and page (source scan and static render).** `TravelBoard` still renders (static markup) with only an `overview`: no `Hotel stays` text appears when `bookings` is not passed; with a fabricated `bookings` holding one hotel membership and one stay, `Hotel stays` appears once and the stay's masked code appears and a code canary does not; `app/travel/page.tsx` imports `loadBookings` and passes `bookings`, and does not import the database module or name `raw_mail`; the card order and the other sections' strings (`Certificates & credits`, the screenshot section) are still present. | `renderToStaticMarkup` with fabricated props; source text. | the board needing a new required prop; the code leaking into markup |

### Integration scenarios (route handlers, the read pass and the loader; throwaway DB; fabricated data)
Day arithmetic is Postgres `CURRENT_DATE ± n` written by the test. The fake reader is installed through the mocked `createBookingReader` and returns a queue of answers per message.

| Id | Observable rule | Setup and assertion | Catches |
|---|---|---|---|
| T42e1-I1 | **Candidates; no balance re-read (D3).** Six stored messages of hotel-kind programs and one airline-kind: never balance-read; with a balance-read row `applied`; with a balance-read row `no_balance`; with a balance-read row `pending`; one oversize with no bytes; one already booking-read (`none`); one airline-kind program. `readStoredBookings` calls the fake booking reader exactly for the first four and for no other; the mocked `createMailReader` is called 0 times; `loyalty_inbox_reads` and `loyalty_observations` row counts and the full contents of `loyalty_inbox_reads` are identical before and after; messages are read oldest received first; a run reads at most `LOYALTY_READ_MAX_PER_RUN`. | Counting fakes; snapshot of the two tables. | a booking read skipping already-read mail; balances re-read; an airline program read; the wrong order |
| T42e1-I2 | **A confirmation becomes a stay (D6, D9, D14).** One `hotel_booked` answer with a full set: stay row on the forwarder's membership, `source` `email`, `state` `booked`, `nights` equal to the date difference (checked in SQL), `evidence_received_on` the message's received date, `evidence_key` its `dedupe_key`, `award` as read; the booking-read row is `recorded` with `stay_id` set, `kind` `hotel_booked`, `booking` NULL; a `flight` answer is `flight` and creates no stay; a `none` answer is `none`; a booked answer with a null code or null dates is `no_booking`, creates nothing. | Messages with `attribution` matched and a registered member. | a stay with wrong nights; a flight stored; an unusable booking stored |
| T42e1-I3 | **Dedupe by program and code (D6).** A confirmation, then a change for the same code with new dates and property (a later received day): one row, updated, `updated_at` moved, dates and property new; the same code spelled with lower case and a dash in a second message: still one row; the same code in a different hotel program: a second row (negative control: two rows); the same normalised code twice in one run: one row. Row counts in `loyalty_stays` are asserted after each step. | Four messages. | a duplicate row; a cross-program merge; a case-sensitive code |
| T42e1-I4 | **Cancellation never deletes (D7).** A confirmation then a cancellation: the row is kept, `state` `cancelled`, dates unchanged, `loadBookings` lists it nowhere and counts none of it; a cancellation for an unknown code with valid dates creates a `cancelled` stay; a cancellation for an unknown code with no dates is `no_booking` and creates nothing; `DELETE` is never issued (a trigger installed in the test raises on `DELETE FROM loyalty_stays` and is dropped in `finally`; the run must not trip it). | Trigger. | a deleted stay; a cancelled stay still counted |
| T42e1-I5 | **Order independence (D8).** Cancelled then, by arrival, an OLDER-dated re-forwarded confirmation: stays cancelled, booking-read state `stale`; an equal-dated booking after a cancellation: stays cancelled; a strictly later booking after a cancellation: re-booked; an older cancellation after a newer booking: stays booked and `stale`; an equal-dated cancellation after a booking: cancelled. | Messages with chosen `received_on`. | arrival order treated as event order; a resurrected stay |
| T42e1-I6 | **Typed and mail supersede each other (D8, D12).** A typed stay, then a mail for its code: the stay carries the mail's fields, `source` `email`, evidence set. A mail-made stay, then a typed correction: typed fields, `source` `typed`, evidence date and key UNCHANGED; then an OLDER re-forwarded mail: `stale`, typed fields kept; then a strictly later mail: supersedes, `source` `email`. A typed stay under another membership of the program with the same code is refused (the typed route), and a mail for it never moves the membership (the first attribution is sticky). | Both routes and the pass. | a correction undone by an old mail; a membership silently moved |
| T42e1-I7 | **Attribution through the pass (D9, D10).** Cases built with real memberships, stored numbers and messages: forwarder only places; unique suffix places; unique suffix contradicting the forwarder holds `forwarder_conflict` and creates no stay; unmatched suffix holds; ambiguous holds; no suffix and no forwarder holds; program name mismatch holds; unmatched suffix on `loyalty_inbox_not_mine` is `not_mine_known` and appears nowhere; a held row has `booking` non-NULL with exactly the six keys and `reason` set; no held booking creates a stay or changes a count. | Memberships with and without numbers. | a guessed placement; a hold that leaks into the nights |
| T42e1-I8 | **The hold's one-tap actions (D10).** `place` with a membership of the item's program creates the stay by D6 and D8 (state `placed_by_hand`, `booking` cleared to NULL, `stay_id` set); `place` with a membership of another program is 400 `INVALID_INPUT` and changes nothing; `ignore` makes `ignored` and nothing else; `not_mine` inserts the (program, suffix) pair once (idempotent) and resolves the other pending bookings of that program and suffix; a second action is 409 `ITEM_RESOLVED`; two simultaneous `place` taps make exactly one stay and one 409; an unknown id is 404 `NOT_FOUND`; a malformed id is 400. No credential 401 and a read-scope token 403 before the body is pulled (a flag on the stream); neither reads the body nor writes. | Both users. | a tap placing in the wrong program; two stays from two taps; a body read before authorisation |
| T42e1-I9 | **Failures, retry, lock and disabled (D5).** With no key: `disabled`, nothing written, the fake reader never called, no booking-read row. With a key: the attempt row exists BEFORE the fake reader is called (observed from inside the fake); a throwing fake is `api_error`; `refused` is terminal at once; a code in `retry` is read again next run and `failed` on the third attempt; a rate limit stops the run and leaves later messages unread; three consecutive `timeout` or `api_error` results stop the run; two overlapping runs make one `already_running`; a `none` answer for a message that later gets a non-`none` answer from a second run does not happen (a message is read once). | Fakes with gates. | a hidden retry; a read without an attempt row; parallel runs |
| T42e1-I10 | **Privacy and logs (D13, D14).** The fake returns injected `guestName`, `address`, `phone`, `cardLast4`, `total` canaries and a full printed member number: none of them is in ANY column of `loyalty_stays` or `loyalty_inbox_booking_reads` (a scan of every text column of both tables for each canary), in `loadBookings`' result, in a typed-route answer, or in any captured log line; the full confirmation code is in no payload (`loadBookings`, both route answers) and no log; log lines carry only `time`, `level`, `scope`, `message` plus counts, `code`, `model`, `inputTokens`, `outputTokens`; a property canary with markup is stored as NULL. | Canaries for name, address, number, code. | a name stored; a code in a payload; a value logged |
| T42e1-I11 | **Daily step, retention and ordering (D4, D5).** `runLoyaltyBookingsDaily` resolves and never rejects when the reader throws or the database is down for it; `runDailyJob` calls it after the balance read step and before the digest (the order is observed through the mocks the 42c2 test also uses); booking-read rows received exactly `LOYALTY_READ_RETENTION_DAYS` days ago are kept and one day older are deleted, pending included; `loyalty_stays` rows of the same age are NOT deleted; the balance run's `inbox/read` route answers exactly what it did before and spends no booking-read call. | Offsets from `CURRENT_DATE`. | a purge reaching stays; a booking read inside the balance run |
| T42e1-I12 | **The nights rule (D11).** Per membership, with the day offsets below, `loadBookings().nights` equals exactly: a booked stay checking out today counts; checking out tomorrow does not (it is upcoming); a cancelled stay does not; a stay whose check-out is on 1 January of this year (from three nights earlier, so it began in the previous year) counts WHOLLY (three nights); a stay checking out on the last day of the previous year does not count; two counted stays sum; a different membership of the same program has its own figure; a membership of a non-hotel program has no entry; a hotel membership with no counted stay has `nightsThisYear` null (negative control: never 0). Year-boundary stays are seeded from `date_trunc('year', CURRENT_DATE)` so the expectations do not depend on the day the test runs. The same figure is read twice and is identical for the owner and the second user. | Direct inserts into `loyalty_stays`. | a zero for nothing; a stay split across years; a cancelled or future stay counted |
| T42e1-I13 | **The typed route (D12).** No credential 401, read-scope token 403, malformed body 400, none pulling the body before the caller; strict body refusals (any of `source`, `nights`, `id`, an extra key, a short code, check-out not after check-in, 61 nights, bad date, bad state, a non-hotel membership, an unknown membership 404 or 400 as the schema says) leave both tables unchanged; a valid body is 201 with `maskedCode` only and `source` `typed`; the same body again with a changed property is 200, the same id, one row; `state` `cancelled` cancels by hand and nothing deletes; a code recorded under another membership of the program is 400 with a fixed sentence that echoes nothing; both users succeed; the answer parses with `LoyaltyStayResponseSchema`. | Both users and a read token. | a client choosing its source; a deleted stay; echoing input |
| T42e1-I14 | **The loader (D11).** `loadBookings` parses with `LoyaltyBookingsSchema`; `upcoming` holds booked stays with check-out after today ordered by check-in then id; `completed` holds counted stays ordered by check-out descending then id; cancelled stays and last year's stays are in neither; the queue holds pending bookings newest received first then id descending, with `maskedSuffix` and `maskedCode` only and candidates ascending; every value is produced in one snapshot with `year` from Postgres; no ledger table is read (a trigger-free check: the function's SQL text, captured through the pool's query spy, names none of `transactions`, `accounts`, `account_valuations`); `GET /api/v1/loyalty` still parses with `LoyaltyOverviewResponseSchema` and its panel keys are unchanged. | Fabricated world; query spy. | a mixed snapshot; a ledger read; an unordered list |
| T42e1-I15 | **The page (D11, D13).** The `/travel` board rendered through `renderToStaticMarkup` with the real loader output for a world with one counted stay, one upcoming stay, one cancelled stay and one held booking: `Hotel stays` once; the nights line `2 nights counted in <year>` for the counted stay; the upcoming stay listed under `Upcoming`; the cancelled stay absent everywhere; `Stays that need a membership` present with the three one-tap labels; the masked code present and the code canary, the member-number canary and the held booking's code canary absent from the markup and from every route answer of the scenario; a world with a hotel membership and no stay shows `—` and `No stay counted yet`; a world with no hotel membership and no stay renders no `Hotel stays` text. | Real loader, fabricated rows. | a zero for no data; a cancelled stay shown; a code in markup |

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A cancelled stay is in no count and no list | a stay with state `cancelled` and a past check-out | T42e1-I12, T42e1-I14, T42e1-I15 |
| 2 | A stay that has not ended is not counted | check-out tomorrow | T42e1-I12 |
| 3 | A previous year's stay is not counted; a stay spanning New Year counts wholly in the year of its check-out | check-out on the last day of last year; check-in three nights before 1 January with that check-out | T42e1-I12 |
| 4 | No stay means "—", never 0 | a hotel membership whose only stay is cancelled or absent | T42e1-I12, T42e1-I15, T42e1-U14 |
| 5 | The same code in another program is another stay; the same code spelled differently is the same | a second hotel program with the same code; lower case plus a dash | T42e1-I3, T42e1-U3 |
| 6 | An older mail never undoes a newer fact, and an equal-dated booking never resurrects a cancellation | a re-forwarded old confirmation after a cancellation | T42e1-I5, T42e1-U7 |
| 7 | A typed correction is not undone by an older mail; only a strictly later mail supersedes it | an older re-forwarded mail after a typed edit | T42e1-I6 |
| 8 | A booking is never guessed onto a membership | a suffix contradicting the forwarder; an ambiguous suffix; no suffix and no forwarder; a program-name mismatch | T42e1-U6, T42e1-I7 |
| 9 | A held booking changes no count | a pending booking with valid dates | T42e1-I7, T42e1-I12 |
| 10 | The tap cannot place in another program | `place` with a membership of another program | T42e1-I8 |
| 11 | Nothing is sent to Anthropic without a key; only the mail and a fixed prompt go out | no `ANTHROPIC_API_KEY`; a household canary in the request | T42e1-U8, T42e1-I9 |
| 12 | The model's output is never trusted | injected `guestName`, `address`, `phone`, `cardLast4`, `total`, markup in the property, a full number in the suffix | T42e1-U1, T42e1-U4, T42e1-I10 |
| 13 | A full confirmation code is never emitted | the code canary in payloads, markup and logs | T42e1-U11, T42e1-I10, T42e1-I15, H17 |
| 14 | A flight is recorded and nothing is extracted from it | a flight answer with fields | T42e1-U1, T42e1-I2 |
| 15 | The balance read is not re-run and the balance tables are untouched | already-read messages | T42e1-I1 |
| 16 | The balance schema is not widened | a changed `READ_SCHEMA` | T42e1-U10 |
| 17 | The caller is resolved before anything is read | no credential; a read-scope token | T42e1-I8, T42e1-I13 |
| 18 | A client cannot choose its source or its nights | `source`, `nights`, `id` in a body | T42e1-U12, T42e1-I13 |
| 19 | Nothing deletes a stay | a `DELETE` trigger; the purge | T42e1-I4, T42e1-I11, command 16 |
| 20 | Retention reaches reads, not stays | rows at the retention boundary | T42e1-I11 |
| 21 | The panel, the overview and the screenshot path are unchanged | pinned keys and counts | command 9 (T42c2-I9, T42c4-I6, T42d-*), T42e1-I14 |
| 22 | Only the named pins change | any other test diff | command 15 |
| 23 | No ledger read | `transactions`, `accounts`, `visibleTransactions` in new code | T42e1-I14, command 16 |
| 24 | Stubs and today's code fail every scenario | no-op domain, read, store, routes, component; today's reader, scheduler, board, page, contracts | command 19 |
| 25 | The migration refuses what the rules forbid | a short or lower-case code, check-out not after check-in, 61 nights, a membership of another program, a source `import`, an email stay without evidence, a hold with a booking in a non-pending state | command 6 |

## Evidence required
- `plan/tasks/P8-42e1-loyalty-stays/EVIDENCE.md` with the verbatim output of every acceptance command (numbers inside assertion diffs redacted of any figure), and a note of the docs under `node_modules/next/dist/docs/` read for route handlers and for reading a request body.
- **The nights table, observed:** one row per T42e1-I12 case with the check-out offset, state, counted or not and the resulting per-membership value or null; plus the same rows from command 19 on stubs (every one failing). Booleans, integers and day counts only.
- **The decision table, observed:** one row per T42e1-U6 and T42e1-I7 case with the input flags and the decision (place, hold with reason, discard). Codes only.
- **The supersession grid, observed:** the 16 rows of T42e1-U7 with the result.
- **The migration up, down and up log** of command 6.
- **The stub run (command 19):** each scenario title shown `failed` on an assertion, and the checksum line proving restoration.
- **Mutation evidence (command 22), at least 20 single-line breaks**, each shown failing the named scenario and reverted: M1 count a cancelled stay (T42e1-I12, T42e1-I4); M2 use `<` instead of `<=` on check-out (T42e1-I12); M3 count by check-in year (T42e1-I12); M4 return 0 instead of null (T42e1-I12, T42e1-U14); M5 drop the (program, code) uniqueness so a change duplicates (T42e1-I3); M6 key dedupe on the raw code (T42e1-U3, T42e1-I3); M7 let an older mail apply (T42e1-I5, T42e1-U7); M8 let an equal-dated booking re-book a cancelled stay (T42e1-I5, T42e1-U7); M9 let a typed write clear the evidence date (T42e1-I6); M10 let a mail move a stay's membership (T42e1-I6); M11 place on the forwarder despite a contradicting suffix (T42e1-U6, T42e1-I7); M12 resolve an ambiguity by order (T42e1-U6, T42e1-I7); M13 skip the not-mine check (T42e1-I7); M14 place with a membership of another program (T42e1-I8); M15 resolve the caller after reading the body (T42e1-I8, T42e1-I13); M16 read only messages with no balance row (T42e1-I1); M17 call the balance reader from the booking pass (T42e1-I1); M18 store a guest-name key (T42e1-U1, T42e1-I10); M19 emit the full code (T42e1-U11, T42e1-I10); M20 log a code or date (T42e1-U9, T42e1-I10); M21 add a hidden retry or drop the timeout (T42e1-U8); M22 widen `READ_SCHEMA` (T42e1-U10); M23 delete a cancelled stay (T42e1-I4); M24 let the purge reach stays (T42e1-I11); M25 treat a flight as a stay (T42e1-I2); M26 skip the attempt row before the call (T42e1-I9).
- The accepted residuals, one sentence each: (1) the property name is model text, bounded by length and markup rules and escaped on render; (2) a cancellation that arrives before any confirmation and states no dates is lost; (3) mail older than the raw retention cannot be read, so history before this task is at most thirty days; (4) a statement mail that also carries a booking is read twice by design and costs one extra call; (5) the first attribution of a stay is sticky, so a wrong first placement is corrected by hand, not by later mail; (6) the typed route requires a confirmation code, so a stay with no code cannot be entered by hand.

## Failure modes to test
- **Sign, rounding, landscape:** none apply to ledger data; no amount exists. Any price, total, card digit or guest field stored, shown or logged is a defect.
- **Nights and dates:** an off-by-one at check-out equal to today or to the first day of the year; a stay split across years; nights computed in JS through a Date and moved by a time zone; a leap-day error; check-out equal to check-in accepted as a zero-night stay; more than 60 nights accepted; a cancelled or future stay counted; the year taken from a JS clock; the stay counted by check-in year.
- **Null versus zero:** a hotel membership with no counted stay showing 0; `nightsThisYear` 0 instead of null; `award` null shown as false; a null property shown as an empty string.
- **Dedupe and ordering:** a change email creating a second stay; the same code in two programs merged; a case or dash variant not matching; arrival order used as event order; a resurrected cancelled stay; a typed edit undone by an older mail; the evidence date cleared by a typed write; a stay moved to another membership by a later mail; two simultaneous taps making two stays; a `JOIN` on memberships or domains repeating a stay in a list where an `EXISTS` was needed.
- **Attribution:** a forwarder placing a mail whose suffix contradicts it; the forwarder breaking a suffix ambiguity; a not-mine pair ignored; a program-name mismatch placed; a membership of another program accepted by `place`.
- **The second read:** the balance reader called for already-read mail; the balance tables or `readStoredMail` touched; a booking read inside the balance run's lock; an airline-kind message read; a message read twice; a rate limit not stopping the run; a read without an attempt row; the attempt count not committed before the call; the third failure not terminal; a flight mail producing a stay; `refused` retried.
- **Privacy:** the confirmation code, a suffix, a property, a date, mail text, an error text, a name or a key in a log; the full code in any payload; a guest name, address, phone, card digits, price or total surviving the clean pass; an injected key stored; markup in the property rendered; the model request holding household data; a read-scope token spending money or writing.
- **Request handling:** the body read before the caller is resolved; a client-supplied `source` or `nights` accepted; an error text echoing a submitted value; a typed stay filed under a non-hotel membership; a typed stay under a membership of another program through a forged program id.
- **Schema and migration:** a CHECK missing (code shape, nights bounds, evidence pair, source/evidence link, pending-only booking object); the composite key absent so a stay can sit under another program's membership; a `down` that drops or alters an earlier table or column; a delete cascading a stay away; the table list pinned by 42c2 not updated; `db/schema.sql` out of step with the migration; a forbidden column name.
- **UI:** the section shown with nothing to show; a cancelled stay listed; a masked code that is not masked; the code in markup; `—` replaced by 0; the submit enabled while saving (double tap, two rows); `TravelBoard` requiring a new prop so existing renders break; the carried strings of the other sections changed.
- **Determinism and vacuity:** a scenario relying on timing instead of a gate; a trigger, spy or environment change left behind; a scenario that passes against a no-op stub (command 19); a baseline "failure" that is a setup error (command 19 rejects those messages); an assertion only on a response and not on stored state; a leftover `ZQ42E` row, or a row left in the two new tables (command 9); an existing test that drives the daily job leaving rows in the new tables (T20).
- **Tooling traps:** a carried line that moved (guards fail loudly); `370` substitution touching another token; the table-list substitution matching twice; `process.argv[1]` read as `[2]` under `node -e`; a comma-grouped number in a `sed` range; a relative restore path after a `cd`; an unquoted `[id]` in a path under a glob; `tsc` without `--incremental false`.

## Rollback
1. Revert the task's commit(s): the migration, `db/schema.sql`, the two routes, `domain/loyaltyBooking.ts`, `loyaltyBookingRead.ts`, `loyaltyBookingStore.ts`, the additions to `loyaltyReader.ts`, the two lines of `scheduler.ts`, the component, the board and page edits, the registry lines, the H17 step, the six test files and the seven pin edits (five route counts, the route list and `OK H1-H17`, the contracts-test line) go together. The pin edits revert with them, not before.
2. **Take the `\copy` backups of `loyalty_stays` first** (typed stays cannot be rebuilt from mail; email-made stays can only be rebuilt from the thirty days of mail still kept). Revert the application code, then run `npm run migrate:down`: it drops `loyalty_inbox_booking_reads`, then `loyalty_stays`, then the new index on `loyalty_memberships`, and touches no membership, observation, instrument, message or read row. The down is NOT lossless.
3. A re-up after a down starts with empty stay tables; the booking read re-reads whatever mail is still kept, within the thirty-day retention, on the next daily run. No image, proposal or ledger row exists to clean up.
4. After a revert the page loses the `Hotel stays` section; balances, the inbox, the balance read, the queue, the screenshot path and typed balance edits are unaffected.

## Amendments (orchestrator)
None yet. The orchestrator records here any G0 correction (a re-measured baseline, a moved carried line) and any amendment from T20's measurement.

Files read for this spec (absolute): /Users/andreianpilogov/Documents/b8/app/plan/tasks/P8-42e1-loyalty-stays/ITEM.md, /Users/andreianpilogov/Documents/b8/app/plan/LOYALTY-ROADMAP.md, /Users/andreianpilogov/Documents/b8/app/plan/tasks/P8-42d-loyalty-screenshot/SPEC.md, /Users/andreianpilogov/Documents/b8/app/plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md (lines 280 to 441), /Users/andreianpilogov/Documents/b8/app/apps/web/lib/loyaltyReader.ts, /Users/andreianpilogov/Documents/b8/app/apps/web/lib/loyaltyInboxRead.ts, /Users/andreianpilogov/Documents/b8/app/apps/web/lib/loyaltyStore.ts, /Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/loyaltyRead.ts, /Users/andreianpilogov/Documents/b8/app/apps/web/lib/scheduler.ts, /Users/andreianpilogov/Documents/b8/app/packages/contracts/loyalty.ts, /Users/andreianpilogov/Documents/b8/app/db/schema.sql, /Users/andreianpilogov/Documents/b8/app/apps/web/components/TravelBoard.tsx, /Users/andreianpilogov/Documents/b8/app/apps/web/app/travel/page.tsx, /Users/andreianpilogov/Documents/b8/app/apps/web/lib/loyalty.test.ts, /Users/andreianpilogov/Documents/b8/app/apps/web/scripts/gifts-surface-check.mjs.
- **A0 (G0, 2026-11-24).** Command 21 refused three things in this spec's own text: a `sed` range written with a comma
  (command 7's carried schema body now uses variables) and the migration's full timestamp, twice. The migration is now
  named by its pattern, and command 6 compares its timestamp with the 42c2 migration's, read from `migrations/`. No
  rule changed.
- **A1 (G1, 2026-11-24).** Command 6 meant to show a too-short confirmation code refused, but its example `ZQ42E1` has
  six characters, which the binding CHECK (4 to 20) accepts. The example is now `ZQ4` (three). No rule changed.
- **A2 (G1, 2026-11-24).** Contract-guardian kept the code normalisation and the night count as private helpers in
  `packages/contracts/loyalty.ts` (the spec fixes the export list). `normaliseConfirmationCode` and `nightsBetween` in
  `lib/domain/loyaltyBooking.ts` must give the same answers: non-ASCII letters and digits dropped before upper-casing,
  4 to 20 characters, integer days-from-civil arithmetic. T42e1-U2 and U3 cover the domain side; the duplication is a
  stated residual for G3.
- **A3 (G2 cycle 1, 2026-11-24).** `T42c2-U6` (`apps/web/lib/loyaltyReadUi.test.ts`) requires each of the balance
  queue's actions `not_mine` and `ignore` to be sent from exactly one place under `components/` and `app/travel`. The
  held-booking queue (D10) reuses that vocabulary on its own route, so the scan counted two. The orchestrator scoped those
  two checks to exclude `components/LoyaltyStaysSection.tsx` (two lines; `apply` unchanged). The booking queue's own
  actions are covered by T42e1-U14/U15 and I8. Command 15 checks the exact diff; command 17 admits the file.
- **A4 (G2, 2026-11-24).** Command 2's `RUN` helper began with a stray `G "$1" "$2" "$3" "$4"` call that tests line 251
  against the text "255", which can never match, so command 2 always failed before linting. The stray call is removed
  (1 occurrence(s)); the helper now matches the shared first line used by every other carried command.
- **A5 (G3 cycle 1, 2026-11-24) — mail never revives a cancelled stay.** REVIEW-1 N1: `received_on` is the date a
  message reached the loyalty inbox, not the date the hotel sent it, and hotel mail reaches the inbox by forwarding. So
  D8's "a strictly later booking after a cancellation re-books" lets a re-forward of an OLD confirmation resurrect a
  cancelled stay, defeating negative control 6. The rule changes, and supersedes D8 on this point only:
  1. An emailed `hotel_booked` never applies to a stay whose state is `cancelled`, whatever its received date; the
     booking-read row is `stale`. A genuinely re-made booking normally carries a new confirmation code, so it becomes a
     new stay. A cancelled stay is re-booked only by hand: a typed write (D12) or the hold's `place` action (D10),
     each of which may set state `booked`.
  2. Everything else in D8 is unchanged (an emailed cancellation still applies when not older; equal-dated rules; the
     typed/email interplay; the sticky membership).
  3. T42e1-U7's grid and T42e1-I5 change accordingly: "a strictly later booking after a cancellation" now stays
     cancelled and `stale`; I5 adds a re-forward of the original confirmation with a LATER `received_on` than the
     cancellation (the reviewer's scenario) and asserts it stays cancelled and its nights are not counted; I6 or I13
     asserts that a typed write can re-book a cancelled stay. The I5 title no longer claims "not its arrival".
  4. Stated residual: a re-forward of an old confirmation can still overwrite fields of a booked stay that a later
     typed correction set, if it arrives after that correction (D8's typed/email rule); the person retypes.
- **I1/I2 from REVIEW-1 resolved by the orchestrator:** both the throwaway and the production database use the libc
  provider with `en_US.UTF-8`; `[:cntrl:]` matches U+0085 and BEL but not soft hyphen, zero-width space or U+2028,
  the same as JS `\p{Cc}`. The property clean pass and the CHECK agree; no BLOCK.

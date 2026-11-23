# P8-42c2-loyalty-inbox-read — read each stored loyalty message with Claude as a proposal, auto-apply only what passes deterministic rules, queue the rest as one-tap items on /travel, and show per-program balance coverage

**Roadmap item:** ROADMAP.md §5 Phase 8 step 42c, second of two tasks (42c1 collects; 42c2 reads). Origin: `plan/tasks/P8-42c2-loyalty-inbox-read/ITEM.md` (binding) and `plan/LOYALTY-ROADMAP.md` §4 A, §6 (42c), §7. Predecessors: `plan/tasks/P8-42c1-loyalty-inbox/{SPEC,CONTRACT,GATES,NITS}.md`, P8-42b2, P8-42b, P8-42a2, P8-42a. "42c1 #n" means that spec's acceptance command n. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way, or reads stdin.
**Status:** FROZEN (G0 PASS 2026-11-22; amendment A1)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec contains no money-looking figure, no balance, no member number and no real name. It contains counts of things, days, percentages and character counts, which AGENTS.md allows. Every expected balance, every baseline reading, every member-number string and every reader output used by a test lives in the fabricated fixture directory `apps/web/lib/fixtures/loyalty-read/`, which the orchestrator writes at G0 and pins by SHA-256 in command 16. The implementer does not create, edit, reformat or delete anything in it. Every fixture carries the canary `ZQ42C2`. Command 18 scans this spec for money-looking text.

## Goal
Eight observable changes. Nothing else changes.

1. **Each stored message is read once by Claude, as a proposal.** The daily job (after the 42c1 poll, before the digest) and an on-demand route read every stored, readable, not-yet-read message from allowlisted senders. The model returns a JSON object in a fixed schema (program name, printed member-number suffix, balance and unit, as-of date, expiry warnings, instruments). A deterministic clean pass then nulls or drops anything malformed. The model is never asked for a name or a postal address, and no free-text field it returns is stored or shown.
2. **A reading becomes the membership's new balance without asking only when every rule holds** (the decision order is exact; see Conventions): the program name does not contradict the sender's program; the printed suffix matches exactly one membership of that program; the unit equals the stored balance's unit; the as-of date is strictly newer than the stored one and not in the future; a baseline exists; and the change is not implausibly large. Applying appends one `loyalty_observations` row with source `email`, through the same newest-wins path the typed readings use, so history, the earn comparison and the overview see it.
3. **Anything else that needs a human lands in a one-tap queue on `/travel`** with three actions: **apply** (choosing the membership when it is not unique), **not mine** (discard and remember that this suffix does not belong to the household) and **ignore**. Each item shows the program, the masked suffix, the proposed figure and date, and why it was not applied. Items leave the queue when resolved. The queue is not an alert: no push, no digest line, no dashboard card.
4. **Failures are classified, bounded and isolated.** No key, a rate limit, a timeout, a refusal or unusable output leaves a message unread (or terminally failed after three attempts) with a classified code. One bad message never blocks the others, and a stalled model call cannot hold the lock.
5. **Coverage, second half.** Per program on `/travel`, next to 42c1's "last seen": whether the last read statement carried a balance (`yes`, `no`, `not read yet`).
6. **Expiry warnings and instruments** are stored as extracted fields and shown on the membership line; no rule is evaluated over them (42g) and no `loyalty_instruments` row is created.
7. **Extracted fields outlive the raw mail on a stated schedule** (400 days by received date); the raw message is still deleted on 42c1's 30-day schedule.
8. **Gift surfaces are classified and proved.** Two new routes, `POST /api/v1/loyalty/inbox/read` and `POST /api/v1/loyalty/inbox/readings/[id]`, are registered `no-transaction-data`. `/travel` and the existing loyalty routes keep their classes. No ledger row is read or written.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No alert, push, digest line, dashboard card or sidebar change** for anything in this task (42g). No change to any digest, dashboard or push module. The queue and the readouts appear on `/travel` only.
- **No expiry rule is evaluated** and no `loyalty_instruments` row is written, changed or read by the read pipeline. Expiry warnings and instruments from mail are displayed, nothing more.
- **No membership, member, program, alias or sender domain is created or edited from mail.** The program of a message is the program of its allowlisted sender domain (42c1); the model's program name is only compared (see OQ4).
- **No name, postal address, full member number, e-mail address, Message-ID or header value is stored from a read.** The only member-number fragment stored is a suffix of 3 or 4 characters.
- **No free text from the model is stored or shown.** Extracted fields are enums, dates, bounded decimal text and the 3-or-4-character suffix. No raw model output, no prompt and no text sent to the model is stored or logged anywhere.
- **No regex, template or per-program parser extracts a balance from mail text** when Claude is unavailable. With no key nothing is read; nothing is guessed.
- **No stays, flights, redemptions or transfers** are extracted (42e, 42f), no screenshot path (42d), no statement-cycle learning (`LOYALTY_INBOX_SILENCE_DAYS` and forwarding health are untouched), no agent tool (42h).
- **No re-read of a successfully read message**, and no timer-driven re-read. The only explicit re-read is `retryFailed` (OQ18). There is no UI to re-read an applied, queued, stale or ignored message.
- **No undo of an automatically applied reading** and no UI to delete an observation. A wrong auto-applied reading is corrected the way any wrong balance is: a newer typed reading.
- **No cumulative-drift guard.** The 50 percent bound is per reading against the stored balance (stated residual risk, OQ17).
- **No change to 42c1 behaviour.** The poll, the purge, forwarding health, attribution and `LoyaltyInboxPollResponseSchema` and the overview's `inbox` object are unchanged. 42c1 files are edited additively only (command 13 asserts zero removed lines). 42c1's NITS N1 (an address edit racing a poll) and N2 are not folded in.
- **No change to the typed path.** `addObservation` still writes source `typed` only, and the newest-wins reduction is unchanged.
- **No new npm dependency and no change to `receiptReader.ts` or `categorySuggester.ts`.** The Anthropic SDK is already a dependency; the new reader is its third importer.
- **No streaming, no tool use, no web tools, no batch API and no SDK-level retry** in the reader. Retries are the pipeline's, counted, and bounded (OQ2).
- **No ledger read or write.** No new or changed file reads `transactions`, `accounts`, `account_valuations` or any ledger table; the earn estimate, the fee watch and `computeNetWorth` are untouched.
- **No JS clock, date arithmetic or float on the server path** (Conventions). No `console.` output. No library error text reaches a log, a response or a page.
- **No change to** `scripts/daily-job.ts`, `lib/jobHealthRead.ts`, `lib/logger.ts`, `lib/receiptReader.ts`, `lib/sync.ts`, `lib/netWorth.ts`, `lib/giftReadPath.ts`, `lib/domain/giftMask.ts`, the import script, the vitest configs, `evals/`, the root `package.json`, any applied migration, or any 42c1 fixture. The poll route file is unchanged.
- **No live Anthropic call, real mailbox or non-loopback socket in any test, command or script.** The reader is injected, or aimed at a loopback listener.
- **No existing test is weakened or deleted.** Existing tests are edited only as command 15 allows.

## Contracts touched
Expected: G1 applies (contract surface touched; lease required). The guardian writes the migration and the types; this spec fixes the names the acceptance commands query. Class per BUILD.md §9.2 is **additive** for every row.

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new timestamp greater than 1793000000000>_loyalty_inbox_read.sql` (the file name must contain `loyalty_inbox_read`) | Creates three tables with exactly these columns. **`loyalty_inbox_reads`** (one row per message ever attempted; `dedupe_key` is the 42c1 key, with no foreign key because the message row is purged first): `id`, `dedupe_key` (TEXT NOT NULL UNIQUE, CHECK 64 lower-case hex), `program_id` (INTEGER NOT NULL, FK to `loyalty_programs(id)`, no delete action), `received_on` (DATE NOT NULL), `state` (TEXT NOT NULL, one of `retry`, `failed`, `pending`, `applied`, `applied_by_hand`, `stale`, `no_balance`, `not_mine_known`, `not_mine`, `ignored`), `attempts` (SMALLINT NOT NULL, 0 to 3), `last_error_code` (TEXT, null or one of `rate_limited`, `timeout`, `api_error`, `refused`, `bad_output`, `empty_message`), `reason` (TEXT, null or one of `no_suffix`, `unmatched_suffix`, `ambiguous_suffix`, `program_mismatch`, `unit_mismatch`, `no_as_of`, `as_of_future`, `no_baseline`, `implausible_jump`), `suffix` (TEXT, null or 3 to 4 upper-case letters or digits), `balance` (NUMERIC, nullable), `unit` (TEXT, nullable, one of `points`, `miles`, `nights`, `usd`), `as_of` (DATE, nullable), `program_check` (TEXT, nullable, one of `match`, `mismatch`, `not_stated`), `membership_id` (INTEGER, nullable FK to `loyalty_memberships(id)`, no delete action), `observation_id` (INTEGER, nullable FK to `loyalty_observations(id)`, no delete action), `expiry_warnings` (JSONB NOT NULL DEFAULT empty array, array of at most 5), `instruments` (JSONB NOT NULL DEFAULT empty array, array of at most 10), `read_on` (DATE, nullable), `resolved_on` (DATE, nullable). CHECKs: `retry` requires 1 or 2 attempts and a last error code; `failed` requires at least 1 attempt and a last error code; `pending` requires a reason and no other state has one unless it was resolved from pending; every state other than `retry` and `failed` requires `program_check` and `read_on`; `applied` and `applied_by_hand` require `membership_id`, `observation_id`, `balance` and `unit`; `balance` and `unit` are both null or both non-null; balance is non-negative, below 1e12 and has the same per-unit scale as `loyalty_observations` (whole for `points`, `miles`, `nights`; exactly two decimals for `usd`); `resolved_on` is null exactly when the state is `retry`, `failed` or `pending`. **`loyalty_inbox_not_mine`**: `id`, `program_id` (NOT NULL FK, no delete action), `suffix` (TEXT NOT NULL, 3 to 4 upper-case letters or digits), `added_on` (DATE NOT NULL DEFAULT CURRENT_DATE), UNIQUE on (`program_id`, `suffix`). **`loyalty_inbox_read_state`**: `id` (SMALLINT PRIMARY KEY, CHECK equal to 1), `last_read_on` (DATE), `last_outcome` (null, `ok` or `error`), `last_error_code` (null or one of `rate_limited`, `timeout`, `api_error`, `store_failed`); the three columns are all null or set together, `ok` with a null code, `error` with a code; one row seeded by the migration. No column on these tables contains `subject`, `body`, `snippet`, `content`, `header`, `text`, `from`, `local`, `recipient`, `member_number`, `raw`, `address`, `password`, `secret`, `token`, `prompt`, `output`, `response`, `name`, `parsed` or `extract`, and no column is a keyword Postgres quotes in `pg_get_indexdef`. The `down` drops the three tables and touches nothing else (not lossless; Rollback). `loyalty_observations` and `loyalty_instruments` and every 42c1 table are unchanged (`email` is already an allowed observation source; instruments gain no source). | additive |
| `db/schema.sql` | Mirrors the migration. | additive |
| `packages/contracts/loyalty.ts` | New exported constants (names fixed; values in Conventions): `LOYALTY_READ_MAX_ATTEMPTS`, `LOYALTY_READ_MAX_PER_RUN`, `LOYALTY_READ_RETENTION_DAYS`, `LOYALTY_READ_JUMP_PERCENT`, `LOYALTY_READ_SUFFIX_MIN`, `LOYALTY_READ_SUFFIX_MAX`, `LOYALTY_READ_QUEUE_LIMIT`, `LOYALTY_READ_MAX_CHARS`, `LOYALTY_READ_TIMEOUT_SECONDS`, `LOYALTY_READ_RUN_BUDGET_SECONDS`, `LOYALTY_READ_STOP_AFTER`, `LOYALTY_READ_EXPIRY_MAX`, `LOYALTY_READ_INSTRUMENT_MAX`; and the enum arrays `LOYALTY_READ_STATES`, `LOYALTY_READ_REASONS`, `LOYALTY_READ_ERROR_CODES`, `LOYALTY_READ_RUN_ERROR_CODES` (`rate_limited`, `timeout`, `api_error`, `store_failed`), `LOYALTY_READ_OUTCOMES` (`ok`, `disabled`, `already_running`, `error`), `LOYALTY_READ_ACTIONS` (`apply`, `not_mine`, `ignore`), `LOYALTY_READ_EXPIRY_KINDS` (`points`, `miles`, `nights`, `usd`, `status`, `other`), `LOYALTY_READ_PROGRAM_CHECKS`, `LOYALTY_READ_COVERAGE` (`yes`, `no`, `not_read`). `LoyaltyErrorCodeSchema` gains `ITEM_RESOLVED`. `LoyaltyOverviewSchema` gains a required strict-object key `inboxRead` (shape in Conventions). New exported `LoyaltyInboxReadRequestSchema` (strict, optional `retryFailed` boolean), `LoyaltyInboxReadResponseSchema`, `LoyaltyInboxResolveRequestSchema` (discriminated on `action`; `membershipId` only with `apply`) and `LoyaltyInboxResolveResponseSchema`. The `inbox` object, `LoyaltyInboxPollResponseSchema` and every membership schema are unchanged. | additive |
| `packages/contracts/loyalty.test.ts` | One test added (`T42c2-U1`) and the edits command 15 allows. | additive (tests) |

The table, column and constant names are fixed because acceptance commands query or grep them. A guardian who wants a different shape must raise it before G0 freezes this spec.

### Fixed test seams (names the tests import or mock; everything else is the implementer's)
- `apps/web/lib/domain/loyaltyRead.ts` (pure: no database, no SDK, no `mailparser`, no `next`; its only imports are `@b8/contracts/loyalty` and sibling pure modules): the clean pass, suffix keeping, the decision function and the reason wording.
- `apps/web/lib/domain/loyaltyInbox.ts` (42c1's file, the only importer of `mailparser`) gains, additively, the function that turns stored raw bytes into the subject and text sent to the model (OQ3).
- `apps/web/lib/loyaltyReader.ts` (the only new or changed file that imports `@anthropic-ai/sdk` or names `ANTHROPIC_API_KEY`): exports `createMailReader(env, deps?)`, where `deps` may supply a fake SDK client object for unit tests, and `readerAvailable(env)`. A reader has exactly one operation: given `{ subject, text }`, resolve (never reject) to `{ ok: true, reading: unknown }` or `{ ok: false, code }` with a per-message code from `LOYALTY_READ_ERROR_CODES`.
- `apps/web/lib/loyaltyInboxRead.ts` (the only non-test file besides `lib/loyaltyInbox.ts` that names `raw_mail`): exports `readStoredMail`, `purgeExpiredReads` and `runLoyaltyReadDaily` (read then purge; resolves, never rejects). Tests inject a fake reader by mocking `createMailReader` in `@/lib/loyaltyReader`. Reading takes its own Postgres advisory lock, distinct from the poll's (key text `b8:loyalty-inbox:read`).
- The reader's input is exactly `{ subject: string | null, text: string }`. The fake in the tests records every input it receives.

## Conventions this task must honor
- **Sign:** every balance is a non-negative whole count (`points`, `miles`, `nights`) or a stored credit in `usd`; none is ever negated, absolute-valued or treated as a liability. A negative or signed printed figure is **rejected** (the balance becomes null), never sign-flipped. Zero is a real balance, distinct from null.
- **Rounding:** none, anywhere. A figure with more fractional digits than its unit's scale is rejected, never rounded or truncated. A `usd` figure with one fractional digit is padded with a zero (exact, not rounded). Comparisons are exact integer arithmetic in the unit's minor units (BigInt) or SQL NUMERIC, never a JS float. The jump check is a cross-multiplication with no division. No `parseFloat`, `toFixed` or `Math.round` of a balance. "Per step or once at the end" does not arise: no figure is derived from another.
- **Unit scales are P8-42a's:** whole numbers with no decimal point for `points`, `miles`, `nights`; exactly two decimals for `usd`; at most 12 integer digits. The balance is normalised by the same shared parser (`parseBalance` in `lib/domain/loyalty.ts`) that the typed path uses; there is no second parser.
- **Landscape + exclusions:** not applicable. No ledger row is read, so `landscape`, `hidden`, `exclude_from_budget` and gift holds are never consulted.
- **Null semantics:** a missing balance is null and renders nothing as a figure (never `0`, never the text `null`); a missing as-of renders `no date`; a missing suffix renders `no number shown`; "never read" is `lastRead: null` and renders `Not read yet`; coverage with nothing read is `not_read` and renders `not read yet`, never `no`; a count of zero renders as the number zero; an expiry warning with no amount shows no amount; an instrument with no expiry shows `no expiry stated`, never a date.

### Dates and "today"
"Today" is Postgres `CURRENT_DATE`. Calendar dates are `YYYY-MM-DD` text (`::text`). The server path uses no JS clock and no JS date arithmetic: none of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `setHours(`, `getTimezoneOffset`, `toLocaleDateString`, `toLocaleTimeString`, `parseFloat`, `toFixed`, `Math.round` appears in any file this task adds or in any line it adds to an existing file. `setTimeout` is allowed (timeouts and the run budget). The clean pass validates a calendar date, leap years included, without the JS `Date` object. "Strictly newer", "in the future", retention and the 400-day cut-off are compared in Postgres or on `YYYY-MM-DD` text by exact ordering, never by clock arithmetic.

### The decision order (exact; the first rule that fires decides)
For one cleaned reading of one stored message, with the message's program `P` (from its allowlisted sender domain):
- **Suffix match.** The printed suffix is kept as at most its last 4 letters or digits, upper-cased (non-alphanumeric characters such as mask bullets, spaces and dashes are dropped first); fewer than 3 remaining means "no suffix". A membership of `P` matches when its stored member number, upper-cased with non-alphanumerics removed, ends with the suffix. A membership with no stored number never matches. A membership of another program never matches. Exactly one match is the match; zero is "unmatched"; two or more is "ambiguous". An ambiguous suffix is **not** a match, and the first of several is never chosen.
- **Program check.** `not_stated` when the model gave no program name; otherwise `match` when, after lower-casing and removing non-alphanumerics, the stated name equals or contains, or is contained by, the name or any alias of `P`; otherwise `mismatch`.

Then:
1. **No balance** (balance null after cleaning, which includes a balance with no recognised unit): state `no_balance`. Never queued. `membership_id` is set to the unique match when there is one and the program check is not `mismatch`, else null. Expiry warnings and instruments are kept.
2. Program check `mismatch`: queue, reason `program_mismatch`.
3. No suffix: queue `no_suffix`. Unmatched: if (`P`, suffix) is in `loyalty_inbox_not_mine`, state `not_mine_known` (resolved, never queued), else queue `unmatched_suffix`. Ambiguous: queue `ambiguous_suffix`.
4. Unit differs from the unit of the matched membership's current reading (or, with no reading, from `P`'s default unit): queue `unit_mismatch`.
5. As-of missing: queue `no_as_of`. As-of more than one day after `CURRENT_DATE` (the same slack as the typed path): queue `as_of_future`.
6. A stored reading exists and the as-of is **not strictly newer** than the current reading's as-of (equal included): state `stale` (resolved, never queued, no observation).
7. No stored reading, or the stored balance is zero and the candidate is not zero: queue `no_baseline`.
8. The absolute difference from the stored balance, times 100, is **strictly greater** than `LOYALTY_READ_JUMP_PERCENT` times the stored balance (exactly 50 percent passes): queue `implausible_jump`. A candidate of zero against a positive stored balance is therefore queued.
9. Otherwise **apply**: one `loyalty_observations` row, source `email`, as-of from the reading, in the same transaction that sets the state `applied`, the `observation_id` and `membership_id`. The "stored reading" in rules 4 to 8 is the newest by the existing reduction (as-of descending, then `recorded_at`, then id), read inside that transaction with the membership row locked.

Queued items keep `membership_id` when exactly one membership matched (rules 2, 4, 5, 7, 8) and null otherwise.

### Constants (values fixed)
Attempts per message 3; messages per run 25; retention of extracted rows 400 days; jump percent 50; suffix minimum 3 and maximum 4 characters; queue list limit 50 (the total is also reported); characters of text sent 20000; per-call timeout 60 seconds (overridable by the optional `LOYALTY_READ_TIMEOUT_SECONDS`, a whole number 1 to 600, anything else meaning 60); run budget 300 seconds; stop after 3 consecutive transport failures; expiry warnings at most 5 and instruments at most 10 per message.

### What a read run does, in order
1. **Availability.** With `ANTHROPIC_API_KEY` unset or blank (trimmed), outcome `disabled`: nothing is read, no attempt is counted, nothing is written (including the state row), and the daily step is still green.
2. **The lock.** A Postgres session advisory lock on one dedicated client, taken by the route and the daily job alike, distinct from the poll's. Not taken: `already_running`, zero counts, no state change. Released on every path.
3. **Candidates.** Stored messages with bytes (not oversize) that have no `loyalty_inbox_reads` row, or a row in state `retry`, ordered by `received_on` then id, at most `LOYALTY_READ_MAX_PER_RUN`. With `retryFailed`, every `failed` row whose message still has its bytes is deleted first (returning it to unread with zero attempts). Rows whose bytes are gone are left alone.
4. **Per message, isolated.** The attempt is counted (committed) **before** the model is called, so a crash or a thrown reader still costs an attempt. The text is prepared (OQ3); no text means state `failed` with `empty_message` and no model call. The reader is called under a bound of its timeout plus 5 seconds. A result is cleaned and decided (above). A failure of any kind for one message, including an exception, is caught and recorded for that message; the next message is processed.
5. **Failure handling.** `refused` and `empty_message` are terminal at the first occurrence (state `failed`). `rate_limited`, `timeout`, `api_error` and `bad_output` leave the state `retry` until the third attempt, which makes it `failed`. `rate_limited` stops the run at once (outcome `error`, code `rate_limited`); `LOYALTY_READ_STOP_AFTER` consecutive `timeout` or `api_error` results stop the run (outcome `error`, that code). A run that has used `LOYALTY_READ_RUN_BUDGET_SECONDS` starts no new message (outcome `ok`, the rest stay unread). A database failure is outcome `error`, code `store_failed`.
6. **State and purge.** The `loyalty_inbox_read_state` row is set (`ok` or `error` with its code) for every run that was not `disabled` or `already_running`. Extracted rows received strictly before `CURRENT_DATE` minus `LOYALTY_READ_RETENTION_DAYS` are deleted (exactly 400 days old is kept; 401 is deleted), pending items included. `loyalty_inbox_not_mine` is never purged.
7. **Logs carry counts and codes only** (outcome, counts, error code, the model name and token counts). Never a subject, text, balance, suffix, member number, address, URL, host, key or library error text. The model's raw output is never logged or stored.

### The overview's `inboxRead` object and the two route shapes (exact, strict objects)
- `inboxRead`: `readable` (boolean; whether a key is set, never the key), `lastRead` (null or `{ on, outcome, errorCode }`; `on` a date, `outcome` `ok` or `error`, `errorCode` null or a run error code), `waiting` (count of retained stored messages with bytes that are unread or in `retry`), `failed` (count of retained rows in state `failed`), `needsAttentionTotal`, `needsAttention` (array of at most `LOYALTY_READ_QUEUE_LIMIT` items, newest `received_on` first, then id descending: `{ id, programId, maskedSuffix, balance, unit, asOf, receivedOn, reason, candidateMembershipIds }`), `coverage` (for each program that has a sender domain: `{ programId, balanceInLastStatement }`), `fromMail` (array of `{ membershipId, receivedOn, expiryWarnings: [{ what, expiresOn, amount }], instruments: [{ kind, expiresOn }] }`).
- `maskedSuffix` is null or the existing masked form (`LoyaltyMaskedMemberNumberSchema`: four bullets and 3 or 4 characters). It is the only member-number fragment any payload carries. `candidateMembershipIds` is computed at read time by matching the suffix against stored numbers in SQL; the full number never enters the payload.
- `balanceInLastStatement`: `yes` when the program's newest successfully read row (state not `retry` or `failed`, newest by `received_on` then id) has a non-null balance, `no` when it has none, `not_read` when no such row exists. Row state does not matter (a queued, stale or discarded row still carries or lacks a balance).
- `fromMail` has, per membership, the newest row (by `received_on`, then id) in state `applied`, `applied_by_hand`, `stale` or `no_balance` whose `membership_id` is that membership and whose expiry warnings or instruments are not both empty. Rows in state `pending` are excluded until resolved, so an unresolved or unmatched mail never decorates a membership.
- `POST /api/v1/loyalty/inbox/read` (body optional `{ retryFailed? }`) answers HTTP 200 for every outcome with `{ outcome, read, applied, queued, stale, noBalance, discarded, failed, remaining, errorCode }`. The counts are whole numbers (zero when nothing ran); `read` equals `applied + queued + stale + noBalance + discarded` (the contract refines this); `failed` counts messages whose attempt failed in this run; `remaining` counts messages still unread after the run; `errorCode` is null unless `outcome` is `error`.
- `POST /api/v1/loyalty/inbox/readings/[id]` with body `{ action: 'apply', membershipId? }`, `{ action: 'not_mine' }` or `{ action: 'ignore' }` answers 200 with `{ id, state }` where `state` is `applied_by_hand`, `not_mine` or `ignored`; 400 `INVALID_INPUT` for a malformed body or a membership that does not belong to the item's program or an as-of more than one day ahead; 404 `NOT_FOUND` for an unknown id; 409 `ITEM_RESOLVED` for a row that is not pending (already resolved, or never a queue item). Error messages never echo input. No credential is 401; a read-scope token is 403 `INSUFFICIENT_SCOPE`; the caller is resolved before anything else.
- No emitted object holds a message body, subject, text sent to the model, URL, address, Message-ID, key, member number or raw model output. A stray key is refused by the contract.

### Queue actions (exact)
- **apply:** requires a pending item. The membership is the item's unique match, or `membershipId` (required when the item has no unique match; the item's program's memberships are all allowed). It writes one `loyalty_observations` row (source `email`) with the item's balance and unit; the as-of is the item's, or the item's `received_on` when it has none (an explicit human decision, shown as such). An older as-of than the current one is written and does not become current (history), as on the typed path. A future as-of is refused. The item becomes `applied_by_hand` in the same transaction. Two simultaneous applies yield exactly one observation: one 200 and one 409 `ITEM_RESOLVED`.
- **not mine:** the item becomes `not_mine`; when it has a suffix, (program, suffix) is recorded in `loyalty_inbox_not_mine` (idempotent), and every other pending item of the same program and suffix whose reason is `unmatched_suffix` becomes `not_mine` too. No observation. The record suppresses a future read only when the suffix matches **no** membership; once a membership with that suffix exists, the record has no effect.
- **ignore:** the item becomes `ignored`. No observation, no record.

### Visible text
Case-sensitive, after removing every `<!-- -->` comment from the HTML. Dates are the Postgres text.

| Situation | `/travel` contains |
|---|---|
| the queue section | `Needs attention` |
| queue empty | `Nothing needs attention` |
| queue not empty | `Needs attention: ` the total, and per item the line `<program name> · <masked suffix or no number shown> · <balance> <unit> · as of <date or no date>` then `Why: <reason text>` |
| reason texts | `no_suffix` → `The mail shows too little of the number`; `unmatched_suffix` → `No membership ends with this number`; `ambiguous_suffix` → `More than one membership ends with this number`; `program_mismatch` → `The mail names a different program`; `unit_mismatch` → `The unit could not be confirmed against the stored balance`; `no_as_of` → `The mail has no date`; `as_of_future` → `The date is in the future`; `no_baseline` → `There is no earlier balance to compare with`; `implausible_jump` → `The balance changed by more than 50%` |
| item controls | `Apply`, `Not mine`, `Ignore`; when the item has no unique match also `Apply to` and `Choose a membership`, and the apply control is disabled until a membership is chosen |
| `readable` false | `Reading mail is not set up`, the text `ANTHROPIC_API_KEY`; and neither `Read stored mail now` nor `Try failed mail again` appears |
| `readable` true and `waiting` above zero | `Read stored mail now` and `Waiting to be read: ` the count |
| `failed` above zero | `Could not be read: ` the count; and, when `readable`, `Try failed mail again` |
| `lastRead` null | `Not read yet` |
| `lastRead` ok | `Last read: ` the date then ` · ok` |
| `lastRead` error | `Last read: ` the date then ` · failed (` the code `)` |
| program with a sender domain | `Balance in last statement: yes`, `Balance in last statement: no` or `Balance in last statement: not read yet` |
| membership expiry warning | `Expires ` the date `: ` then, when an amount exists, the amount and a space, then the label (`points`, `miles`, `nights`, `usd`, `status`, `something else`) |
| membership instrument | `From mail: ` the kind label (`free night`, `companion fare`, `travel credit`, `other`) then `, expires ` the date or `, no expiry stated` |

`Check inbox now` (42c1) keeps its condition and now runs, from the same single handler, the poll and then the read, whatever the poll's outcome. The new controls each have one handler. A `null` is never rendered as `0`, an empty string or the text `null`. Every value from the database is React-escaped text; the clean pass guarantees no markup reaches it.

### Process requirements for the implementer
Read the relevant guides under `node_modules/next/dist/docs/` (resolved from `apps/web`) before changing a client component or adding a route handler. Invoke the `uiux-promax` skill before designing the queue, and the `claude-api` skill before writing `loyaltyReader.ts` (model constants, structured output, fallbacks). Record the docs read in EVIDENCE.md. The phone-first tap-target rule of P8-42a2 applies (not smaller than the existing `min-h-8`).

## Toolchain prerequisites
All commands run under `bash` from the repo root. Baselines are the 42c1 close-out figures; the orchestrator measures each row at G0 and a mismatch is a G0 FAIL.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB at head `1793000000000_loyalty_inbox` with none of the new tables | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select name from pgmigrations order by id desc limit 1"` → `1793000000000_loyalty_inbox`, and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select coalesce(to_regclass('public.loyalty_inbox_reads')::text,'none')"` → `none` | filled at G0 |
| T3 | `npm run migrate:up` and `migrate:down` honour `DATABASE_URL` | **yes** | existing | `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up >/dev/null 2>&1; echo "exit=$?"` → `exit=0` | filled at G0 |
| T4 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → 108 files, 1421 tests | filled at G0 |
| T5 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, not above 5 warnings | filled at G0 |
| T6 | Integration baseline | **yes** | existing | 42c1 #8's body run on the unmodified tree → `OK 356 tests …` and failing set only the KNOWN titles | filled at G0 |
| T7 | `tsc` in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T8 | Node 22 or later with global `fetch` | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T9 | Port 3198 free and the surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H14`, `exit=0` | filled at G0 |
| T10 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T11 | The 42c1, 42b2, 42b and 42a2 SPEC lines extracted by commands 9 and 10 sit where stated | **yes** | frozen | `S=plan/tasks/P8-42c1-loyalty-inbox/SPEC.md; for n in 515 540 546 666 694; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done` → 515 starts `set -e; for TZV in UTC Pacific/Auckland`; 540 starts `set -e; S=plan/tasks/P8-42b2-card-earn-es`; 546 starts `RANGE="429,441"; BODY="$(sed -n "`; 666 starts `set -e; D=apps/web/lib/fixtures/loyalty-in`; 694 is `echo "OK fixtures pinned and covered"`; and `sed -n '332p' plan/tasks/P8-42b-card-annual-instruments/SPEC.md \| cut -c1-40` starts `set -e; R=apps/web/lib/giftSurfaceReg`, `sed -n '340p' …` is `echo "OK classes"`, `sed -n '153p' plan/tasks/P8-42a2-loyalty-nits/SPEC.md \| cut -c1-40` starts `set -e; S=plan/tasks/P8-42a-loyalty-` | filled at G0 |
| T12 | The extracted regression blocks of commands 9 and 10 pass on the unmodified tree | **yes** | existing | commands 9 and 10 run before the implementer starts | filled at G0 |
| T13 | 42c1 is committed: its migration, library, routes, components and fixtures are tracked and the tree is clean outside `plan/`, so `git merge-base HEAD main` equals `HEAD` and `git diff` against it is exactly this task's change | **yes** | the orchestrator commits 42c1 (or a baseline snapshot) before G0 freezes this spec | `git ls-files --error-unmatch migrations/1793000000000_loyalty_inbox.sql apps/web/lib/loyaltyInbox.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/app/api/v1/loyalty/inbox/poll/route.ts >/dev/null; echo "exit=$?"` → `exit=0`; `git status --short \| grep -v ' plan/' \| wc -l \| tr -d ' '` → `0`; `[ "$(git merge-base HEAD main)" = "$(git rev-parse HEAD)" ]; echo "exit=$?"` → `exit=0` | filled at G0 |
| T14 | No `ZQ42C`-prefixed rows exist | **yes** | n/a | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42C%')\|\|','\|\|(select count(*) from household_members where display_name like 'ZQ42C%')"` → `0,0` | filled at G0 |
| T15 | Under `set -e`, a leading `!` does NOT abort when the negated command succeeds; this spec writes no `! cmd` guard | **yes** (hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T16 | The fixture directory `apps/web/lib/fixtures/loyalty-read/` is on disk with `cases.json` and 6 `.eml` files and matches command 16's digest | **yes** | the orchestrator writes it from "Prerequisites the orchestrator creates" before G0 freezes | command 16's first lines on the written directory | filled at G0 |
| T17 | The installed Anthropic SDK honours `ANTHROPIC_BASE_URL` and a request option `maxRetries` | **yes** | existing | `grep -c "ANTHROPIC_BASE_URL" node_modules/@anthropic-ai/sdk/client.js` → at least `1` and `grep -c "maxRetries" node_modules/@anthropic-ai/sdk/client.js` → at least `1` | filled at G0 |
| T18 | `env -u` and `unset` are available; the commands unset every `ANTHROPIC_` variable and every `LOYALTY_IMAP_` variable they must not inherit | **yes** | n/a | `bash -c 'ANTHROPIC_API_KEY=x; unset ANTHROPIC_API_KEY; [ -z "${ANTHROPIC_API_KEY:-}" ]'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T19 | A browser or jsdom renderer | **NO** | n/a. Wording is proved over real HTTP (H15) and by source checks. | n/a | n/a |
| T20 | Live Anthropic, live Plaid, a real mailbox, any non-loopback socket, the dev database `b8_finance`, the owner's ledger | **NO** | n/a | n/a | n/a |
| T21 | Work happens on `main`, uncommitted, with nothing committed before G4 | **yes** | adjudicated at G0 | `git merge-base HEAD main` equals `git rev-parse HEAD` | filled at G0 |
| T22 | Postgres quotes keyword column names in `pg_get_indexdef`; index checks accept either spelling | **yes** (hazard) | n/a | `psql -d postgres -Atc "select pg_get_indexdef(i.indexrelid) from pg_index i limit 0"` runs | filled at G0 |

**The throwaway database is mutated by command 5 and left at the new head.** Commands 8, 9 and 11 run after it. If a regression block asserts a state this task legitimately changes, that is a conflict to name to the orchestrator, not to absorb. The known state-pinning commands are named below.

### Existing state this task changes (named, with the guarded edit each is allowed)
Each existing test or command below pins a state this task changes. Each may change in exactly the stated way; command 15 enforces it. Line numbers are on the tree after 42c1.
1. `packages/contracts/loyalty.test.ts` line 125, `expect(responses.length).toBe(7);` becomes `toBe(9)` (two new `…ResponseSchema` exports). The envelope loop below it applies to both and must pass unedited.
2. `packages/contracts/loyalty.test.ts` overview fixtures (the objects at lines 135, 222, 395 and 485 that carry `inbox:`): each may gain `inboxRead: <an identifier naming a fixture const>` and nothing else. The refusal of an overview without `cardAccounts` still passes.
3. `packages/contracts/loyalty.test.ts` lines 409 and 525 (the error-code lists and their exact-set assertions): each list gains the string `'ITEM_RESOLVED'` and nothing else.
4. `toHaveLength(12)` becomes `toHaveLength(14)` in `apps/web/app/api/v1/loyalty/loyalty.test.ts` line 506, `loyaltyCard.test.ts` line 603, `loyaltyEarn.test.ts` line 591 and `loyaltyInbox.test.ts` line 887 (the two new route files). Nothing else in them changes; line 888 of the last is unchanged.
5. `apps/web/lib/loyalty.test.ts`: `LOYALTY_ROUTE_FILES` gains exactly two elements (`'app/api/v1/loyalty/inbox/read/route.ts'` and `'app/api/v1/loyalty/inbox/readings/[id]/route.ts'`; added lines only), and line 397 becomes `OK H1-H15`.
6. `apps/web/lib/loyaltyStore.ts`: `loadOverview` gains `inboxRead` in its result. The only removed line allowed is the `const [members, programs, aliases, memberships, observations, instruments, watches, cardAccounts, inbox] = await Promise.all([` line; everything else is additions.
7. 42c1 commands not re-run as written, because they pin totals, head names or counts this task changes: #3 (unit totals), #4 (dependencies), #5 (latest migration name), #6 (table list), #8 (integration totals), #11 (surface, `OK H1-H14`), #12 (registry diff, which would now carry this task's two lines), #13 (the `raw_mail` and scheduler pins), #14, #15 and #17. Their intent is carried by commands 3 to 6, 8, 11 to 15 here. 42c1 #7, #10 and #16 are re-run by extraction in command 10, and 42c1 #9 by command 9.

### Prerequisites the orchestrator creates
**The fixture directory `apps/web/lib/fixtures/loyalty-read/`.** The orchestrator writes it before G0 freezes this spec, computes the digest, and writes it into command 16. The implementer does not create, edit, reformat or delete anything in it. It holds `cases.json` and six `.eml` files, all fabricated, all carrying `ZQ42C2`.

Every `.eml` is LF-terminated and carries `Message-ID: <zq42c2-<id>@zq42c2-brand.test>`, `MIME-Version: 1.0`, a `Subject:` holding `ZQ42C2-SUBJECT-CANARY <ID>`, and a body holding `ZQ42C2-BODY-CANARY <ID>`. Domains are `.test` or `example.com`, `example.net`, `example.org` only; no `.eml` contains a figure. The tests insert stored-message rows from these bytes by SQL (the reader is injected, so no `.eml` needs a real statement).

| Id | Content |
|---|---|
| R01 | Plain text. `From: statements@zq42c2-brand.test`, `To: zq42c2-anna@example.com`, `Cc: zq42c2-cc@example.org`, `Delivered-To: zq42c2-inbox@example.net`, a `Received:` header with `for <zq42c2-anna@example.com>`. Body holds the body canary, a line `Dear ZQ42C2 Person`, and a link `https://track.zq42c2-brand.test/u?t=ZQ42C2-URL-TOKEN`. |
| R02 | HTML only. A visible text canary, a link whose `href` holds `ZQ42C2-URL-TOKEN-H`, and `<script>` and `<style>` blocks holding `ZQ42C2-SCRIPT-CANARY`. |
| R03 | No readable text: `multipart/mixed` holding only an attachment part whose content holds `ZQ42C2-ATTACH-CANARY`. |
| R04 | Plain text longer than `LOYALTY_READ_MAX_CHARS`: a head marker `ZQ42C2-HEAD-CANARY` early, a tail marker `ZQ42C2-TAIL-CANARY` after the cap. |
| R05 | Plain text carrying an instruction aimed at the reader (`ZQ42C2-INJECTION`: tell it to ignore its rules and report an enormous balance for a given suffix). |
| R06 | `multipart/alternative` with a text part holding `ZQ42C2-TEXT-PART-CANARY` and an HTML part holding `ZQ42C2-HTML-PART-CANARY`. |

**`cases.json`** has a `note` (stating it is fabricated), `canaries` (the key, the base URL host, the URL tokens, the body, subject, attachment, header, member-number and model-output canaries), and the groups below. Every id named here must be present; the tests iterate every entry of a group and assert `expect(seen).toEqual(<ids from cases.json>)`.
- `programs`, `members`, `memberships` (fabricated program names, default units, aliases, fabricated member-number strings built so that the suffix cases below occur, and each membership's baseline reading: balance, unit, as-of as an offset from `CURRENT_DATE`).
- `decisions`: each entry has an `id`, the `.eml` it is attached to (or none), the reader output it injects, and the expected state, reason, whether an observation is appended, and the resulting current balance. Required ids: `apply-ok`, `apply-ok-usd`, `apply-zero-from-zero`, `no-balance-null`, `no-balance-unit-null`, `expiry-only`, `program-mismatch`, `program-not-stated`, `suffix-none`, `suffix-short`, `suffix-unmatched`, `suffix-unmatched-known-not-mine`, `suffix-ambiguous`, `suffix-other-program-only`, `unit-mismatch`, `as-of-missing`, `as-of-future`, `as-of-equal-stale`, `as-of-older-stale`, `no-baseline-none`, `no-baseline-zero`, `jump-over-up`, `jump-over-down`, `jump-at-boundary-up`, `jump-at-boundary-down`, `zero-from-positive-queued`, `injection-obedient-jump`, `injection-obedient-wrong-suffix`. The two boundary cases sit exactly on the 50 percent line and must pass; `jump-over-up` and `jump-over-down` sit one minor unit beyond it and must queue.
- `clean`: raw reader outputs and the expected cleaned result or field-level rejection. Required ids: `balance-plain`, `balance-thousands`, `balance-european-decimal`, `balance-whole-with-fraction`, `balance-usd-one-fraction`, `balance-usd-three-fractions`, `balance-negative`, `balance-signed-plus`, `balance-exponent`, `balance-too-many-digits`, `balance-text`, `unit-not-in-enum`, `unit-missing`, `date-impossible`, `date-leap-valid`, `date-wrong-shape`, `suffix-masked-forms`, `suffix-long-printed`, `extra-keys`, `markup-and-instruction-strings`, `expiry-over-cap`, `expiry-bad-kind`, `expiry-bad-date`, `instrument-bad-kind`, `instruments-over-cap`, `not-an-object`.
- `suffix`: printed forms and the kept suffix (mask characters, spaces, dashes, lower case, a printed full number, fewer than 3 characters).
- `jump`: baseline, candidate and unit with the expected verdict, for each unit scale, including zero baseline and zero candidate.
- `retry`: scripted reader behaviours per message (each failure code, a throw, a never-settling call, success) and the expected attempts and state. Required ids: `rate-limited-stops`, `timeout-retry`, `three-timeouts-stop`, `api-error-three-attempts`, `refused-terminal`, `bad-output-retry`, `empty-terminal`, `throw-counts-attempt`, `hang-bounded`, `isolation-after-failure`, `retry-failed-reset`.
- `retention`: the day offsets for the 399, 400 and 401 day rows.
- `surface`: the fabricated rows H15 seeds by SQL (a program with a domain, three memberships with chosen suffix collisions, pending items, a `no`/`yes`/`not_read` trio, one membership with extracted expiry and instrument fields) and the strings it expects.

## Acceptance commands
All run from the repo root under `bash` (macOS `/bin/bash` 3.2). `U=postgresql://localhost/b8_p42a_throwaway`. Dates come from Postgres, never the wall clock. No command uses a leading `!` as a guard (T15); absence is asserted with `if … then …; exit 1; fi` or a string comparison. No command puts a double-quoted brace pattern inside `"$( … )"`; patterns with braces or commas are kept in a variable. Commands that touch paths containing `[id]` run `set -f` first. Every source scan is scoped to this task's files or to lines this task adds. Every command that runs tests first unsets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_PROFILE` (the tests set what they need themselves). Run order: 1 to 4, then 5 (brings `$U` to the new head), then the rest. One literal is replaced by the orchestrator before G0 freezes: the digest in command 16.

**Amendment A4 (orchestrator, at G2, 2026-11-22).** The implementer reported these and did not route around them:
1. **Command 4's SDK-importer list left out `apps/web/app/api/v1/chat/route.ts`.** That file has imported the SDK since `6472c64`, and this task does not touch it. It is added to the expected list.
2. **Command 13 allowed only the reader to name `ANTHROPIC_API_KEY`.** But Visible text, T42c2-U6 and H15 require the page to print that literal when reading is not set up. `LoyaltyInboxReadPanel.tsx` is now allowed to carry the name. A new line refuses the panel if it reads `process.env` or uses the name as anything but text (an assignment, key or call).
3. **Command 13's two component scans never ran.** The block starts with `set -ef`, so `apps/web/components/*.tsx` never expanded and both scans checked nothing. When they do run, four pre-existing server components that legitimately import `@/lib/db` would fail the import scan. Both scans now run over the components this task adds or changes (`$TC`, from git), which must be non-empty. U6 still covers every component through the AST.
4. **The surface script sets `ANTHROPIC_API_KEY` blank instead of leaving it out.** `next dev` fills any unset variable from `.env.local`, which would let a local key back in. A blank key means `readable` is false, which H15's "absent" intends.
5. **Fixture defect (orchestrator's):** `cases.json` gives one person two memberships of one program, which `UNIQUE (member_id, program_id)` forbids. Tests and H15 seed one household member per fixture membership, and the fixture's `member` field is not used for that. The pin is unchanged.
6. **Mutation M3 under I3 survives,** because no `decisions` case has a suffix in the middle of a number. U3 catches it. M16 survives because `maxRetries: 0` is set in two places, and M16b, which removes both, fails I10. Both are accepted as recorded in EVIDENCE.md.

**Amendment A3 (orchestrator, at G2, 2026-11-22).** Reported by the implementer, not routed around. Command 13 banned the text `memberNumber` in the reader, domain, and two other named files. But "What the read asks for" requires the model's answer field `memberNumberSuffix`, and the pinned fixtures feed that key. So the reader must name it in the schema, and the clean pass must read it. The guard now deletes exactly the token `memberNumberSuffix` before searching. Any other `memberNumber` or `member_number` in those files still fails. The field carries only the printed tail, which `keepSuffix` cuts to at most 4 characters. No fixture or pin changes.

**Amendment A2 (orchestrator, at G1, 2026-11-22).** Rulings on the contract guardian's points:
1. **Counting an attempt before the model call.** The frozen state enum has no in-flight state, and every state needs an error code or a reading. Before calling the reader, the run writes the row as a crash would leave it: `retry` with the provisional code `api_error`, or `failed` when it is the third attempt. The real outcome then overwrites it. A crash or thrown reader therefore leaves `retry`/`api_error`, as the `throw-counts-attempt` fixture expects. No new state or code is added.
2. **Command 5's `stale` insert has no membership.** It is accepted as written, and `membership_id` stays unconstrained for `stale`. The decision code always sets it under rule 6, and T42c2-I3 asserts that.
3. **The observation delete in command 5 is refused by the `observation_id` FK.** No extra rule is needed.
4. **`attempts` keeps the range 0 to 3**, even though 0 never occurs.
5. **A queued row always has a balance** (rule 1 runs first), and the schema enforces it. The coverage wording's "or lacks" case cannot happen for a queued row.

**Amendment A1 (orchestrator, at G0, 2026-11-21).** Command 18's thousands-separator scan matched this spec's own `sed` line ranges (`'540,546p'`, `RANGE="429,441"`), which are line numbers, not figures. The scan now drops exactly those two forms. Any other comma-grouped number still fails. The fixture directory was written by the orchestrator from its generator. That generator computes every expected value from this spec's rules (clean pass, suffix keeping, decision order, jump rule) and asserts them, so no case contradicts a rule. `cases.json` `conventions` states the entry shapes (raw reader objects, the cleaned object, `{{DAY:n}}` tokens, retry behaviours). One extra decision id, `injection-obedient-within-bound`, carries T42c2-I8's stated residual risk. Extra ids are allowed because coverage asserts `seen` equals the fixture's ids.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | the required `inboxRead` key or the new error code breaks a consumer |
| 2 | Lint, below | `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, below | `OK unit 111 files 1427 tests` | a missing or extra new test, a broken existing test |
| 4 | Dependencies and importers, below | `OK dependencies` | a dependency added, the SDK, `imapflow` or `mailparser` imported from a wrong file |
| 5 | Migration shape, refusals, down/up, below | `OK migration up-down-up` | a wrong column, a missing CHECK, a `down` that harms earlier tables, a changed instruments or observations CHECK |
| 6 | Stored-state schema check, below | `OK schema` | a stored forbidden column, a fourth table, a `schema.sql` out of step, a changed 42c1 table |
| 7 | New unit scenarios, below | two lines `OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=<zone>` | a missing or duplicated scenario, a zone-dependent result |
| 8 | Integration scenarios, below | `OK 370 tests, … T42c2-I1-I14 each present once and passed`, then `OK no fixture rows left` | any new rule fails, an old scenario regresses, a leftover row |
| 9 | Integration stability (42c1 #9 chain), below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 10 | Regression: 42c1 #7, #10 and #16 and the 42b class block, extracted with prefix guards, below | 42c1 #7's four OK lines, the eleven OK lines of 42b2 #9 and `fixture shape ok`, `OK fixtures pinned and covered`, `OK classes` | a 42a to 42c1 guarantee disturbed, a 42c1 fixture edited |
| 11 | Surface script over real HTTP, below | `H1 PASS` to `H15 PASS` each once, last line `OK H1-H15`, then `OK surface` | a leak, wording missing, a stale readout, an unauthenticated action |
| 12 | Registry classes, below | `OK two registry lines added, none changed` | a class changed, a new route unclassified or wrongly classified |
| 13 | Source guards, below | `OK task source guards` | a ledger read, a JS clock, a float, console output, an error text, a wrong importer, a non-additive edit of a 42c1 file |
| 14 | Scope guard, below | no output | a file outside the allowed set changed, a required file missing, an applied migration edited |
| 15 | Existing-test edit guard and census, below | `OK existing tests edited only as allowed; removed lines <n>` and no other output | a weakened existing test, a missing or extra new test title |
| 16 | Fixtures pinned and covered, below | `fixture shape ok`, `OK fixtures pinned and covered` | an edited fixture, a real-looking address, a figure in an `.eml`, a case id the tests never read |
| 17 | Mutation evidence, below | `OK mutation evidence rows 14` | fewer than ten recorded mutations, a mutation not shown failing |
| 18 | This spec's own public-safety scan, below | `OK spec has no money-looking text` | a figure or member number in the spec |
| 19 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error, a server-only package pulled into a client bundle |

**#2 (lint).**
```
set -e; O="$(mktemp)"; npm run lint > "$O" 2>&1 || true; tail -4 "$O"
if grep -qE '[1-9][0-9]* errors?' "$O"; then echo "FAIL lint reports errors"; exit 1; fi
W="$(grep -oE '[0-9]+ warnings?' "$O" | tail -1 | grep -oE '^[0-9]+' || true)"
[ "${W:-0}" -le 5 ]
echo "OK lint 0 errors, warnings not above 5"
```

**#3 (unit totals).** The new unit tests are `T42c2-U1` (added to an existing file) and `T42c2-U2` to `U6` in three new files, so the totals rise by three files and six tests over the 42c1 baseline (T4).
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +111 passed \(111\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1427 passed \(1427\)' "$O")" = 1 ]
echo "OK unit 111 files 1427 tests"
```

**#4 (dependencies and importers).**
```
set -e; B="$(git merge-base HEAD main)"
[ -z "$(git diff --name-only "$B" -- apps/web/package.json package.json package-lock.json)" ]
imp(){ grep -rlE "$1" apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$' | sort | tr '\n' ' '; }
P1="from '@anthropic-ai/sdk'|from \"@anthropic-ai/sdk\"|require\('@anthropic-ai/sdk'\)|import\('@anthropic-ai/sdk'\)"
P2="from 'imapflow'|from \"imapflow\""
P3="from 'mailparser'|from \"mailparser\""
[ "$(imp "$P1")" = "apps/web/app/api/v1/chat/route.ts apps/web/lib/categorySuggester.ts apps/web/lib/loyaltyReader.ts apps/web/lib/receiptReader.ts " ]
[ "$(imp "$P2")" = "apps/web/lib/loyaltyInboxSource.ts " ]
[ "$(imp "$P3")" = "apps/web/lib/domain/loyaltyInbox.ts " ]
echo "OK dependencies"
```

**#5 (migration: shape, refusals, down/up).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
MIG(){ DATABASE_URL="$U" npm run "$1" >/dev/null 2>&1; }
COLS(){ Q "SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\"), 'none') FROM information_schema.columns WHERE table_schema='public' AND table_name='$1'"; }
R(){ if Q "$1" 2>/dev/null; then echo "FAIL the database accepted: $1"; exit 1; fi; }
MIG migrate:up
LATEST="$(Q "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")"
case "$LATEST" in *loyalty_inbox_read*) ;; *) echo "FAIL the migration name must contain loyalty_inbox_read"; exit 1;; esac
TS="${LATEST%%_*}"; [ "$TS" -gt 1793000000000 ]
[ "$(COLS loyalty_inbox_reads)" = "as_of,attempts,balance,dedupe_key,expiry_warnings,id,instruments,last_error_code,membership_id,observation_id,program_check,program_id,read_on,reason,received_on,resolved_on,state,suffix,unit" ]
[ "$(COLS loyalty_inbox_not_mine)" = "added_on,id,program_id,suffix" ]
[ "$(COLS loyalty_inbox_read_state)" = "id,last_error_code,last_outcome,last_read_on" ]
[ "$(COLS loyalty_inbox_messages)" = "attribution,dedupe_key,id,member_id,origin,oversize,program_id,raw_mail,received_on,sender_domain,stored_on" ]
[ "$(COLS loyalty_inbox_state)" = "id,last_error_code,last_outcome,last_polled_on" ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_read_state")" = 1 ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_reads")" = 0 ]
[ "$(Q "SELECT count(*) FROM pg_constraint WHERE conrelid='loyalty_instruments'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%''email''%'")" = 0 ]
[ "$(Q "SELECT count(*) FROM pg_constraint WHERE conrelid='loyalty_observations'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%''email''%'")" = 1 ]
Q "INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42C2 Mig Stays', 'hotel', 'points')"
Q "INSERT INTO household_members (display_name) VALUES ('ZQ42C2 Mig')"
Q "INSERT INTO loyalty_memberships (member_id, program_id) SELECT m.id, p.id FROM household_members m, loyalty_programs p WHERE m.display_name='ZQ42C2 Mig' AND p.name='ZQ42C2 Mig Stays'"
Q "INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) SELECT ms.id, CURRENT_DATE, 0, 'points', 'email' FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42C2 Mig Stays'"
RI="INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code, reason, suffix, balance, unit, as_of, program_check, read_on, resolved_on, membership_id, observation_id)"
SELP="FROM loyalty_programs p WHERE p.name='ZQ42C2 Mig Stays'"
Q "$RI SELECT repeat('a',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL $SELP"
Q "$RI SELECT repeat('b',64), p.id, CURRENT_DATE, 'pending', 1, NULL, 'unmatched_suffix', 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, NULL, NULL, NULL $SELP"
Q "$RI SELECT repeat('d',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'XY9', round(0::numeric, 2), 'usd', CURRENT_DATE, 'not_stated', CURRENT_DATE, CURRENT_DATE, NULL, NULL $SELP"
Q "$RI SELECT repeat('e',64), p.id, CURRENT_DATE, 'failed', 3, 'bad_output', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL $SELP"
Q "$RI SELECT repeat('f',64), p.id, CURRENT_DATE, 'no_balance', 1, NULL, NULL, NULL, NULL, NULL, NULL, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL $SELP"
Q "$RI SELECT repeat('1',64), p.id, CURRENT_DATE, 'applied', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, ms.id, ob.id FROM loyalty_programs p JOIN loyalty_memberships ms ON ms.program_id=p.id JOIN loyalty_observations ob ON ob.membership_id=ms.id WHERE p.name='ZQ42C2 Mig Stays'"
Q "INSERT INTO loyalty_inbox_not_mine (program_id, suffix) SELECT id, 'AB12' FROM loyalty_programs WHERE name='ZQ42C2 Mig Stays'"
while IFS= read -r T; do R "$RI SELECT $T $SELP"; done <<'EOF'
repeat('c',63), p.id, CURRENT_DATE, 'retry', 1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('C',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'maybe', 1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'failed', 4, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'failed', -1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'retry', 3, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'retry', 0, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'retry', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'failed', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'retry', 1, 'oops', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'pending', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'pending', 1, NULL, 'weird', 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, NULL, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'pending', 1, NULL, 'no_as_of', 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'applied', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'ab12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB123', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', 0, NULL, CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', NULL, 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', (0 - 1), 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', (1::numeric / 2), 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', round(0::numeric, 1), 'usd', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', power(10::numeric, 12), 'points', CURRENT_DATE, 'match', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'maybe', CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'match', NULL, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, NULL, CURRENT_DATE, CURRENT_DATE, NULL, NULL
repeat('c',64), p.id, CURRENT_DATE, 'stale', 1, NULL, NULL, 'AB12', 0, 'points', CURRENT_DATE, 'match', CURRENT_DATE, NULL, NULL, NULL
repeat('a',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
EOF
R "INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code, expiry_warnings) SELECT repeat('2',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', '{}'::jsonb $SELP"
R "INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code, expiry_warnings) SELECT repeat('3',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', '[1,2,3,4,5,6]'::jsonb $SELP"
R "INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code, instruments) SELECT repeat('4',64), p.id, CURRENT_DATE, 'retry', 1, 'timeout', '[1,2,3,4,5,6,7,8,9,10,11]'::jsonb $SELP"
R "INSERT INTO loyalty_inbox_not_mine (program_id, suffix) SELECT id, 'AB12' FROM loyalty_programs WHERE name='ZQ42C2 Mig Stays'"
R "INSERT INTO loyalty_inbox_not_mine (program_id, suffix) SELECT id, 'AB' FROM loyalty_programs WHERE name='ZQ42C2 Mig Stays'"
R "INSERT INTO loyalty_inbox_not_mine (program_id, suffix) VALUES (0, 'ZZ99')"
R "INSERT INTO loyalty_inbox_read_state (id) VALUES (2)"
R "UPDATE loyalty_inbox_read_state SET last_outcome = 'maybe'"
R "UPDATE loyalty_inbox_read_state SET last_outcome = 'ok'"
R "UPDATE loyalty_inbox_read_state SET last_outcome = 'error', last_read_on = CURRENT_DATE"
R "UPDATE loyalty_inbox_read_state SET last_outcome = 'error', last_read_on = CURRENT_DATE, last_error_code = 'oops'"
R "DELETE FROM loyalty_observations WHERE membership_id IN (SELECT ms.id FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42C2 Mig Stays')"
MIG migrate:down
for t in loyalty_inbox_reads loyalty_inbox_not_mine loyalty_inbox_read_state; do [ "$(Q "SELECT coalesce(to_regclass('public.$t')::text, 'none')")" = none ]; done
for t in loyalty_inbox_messages loyalty_inbox_state loyalty_sender_domains household_member_addresses loyalty_inbox_unknown_senders loyalty_earn_rules loyalty_observations; do [ "$(Q "SELECT to_regclass('public.$t') IS NOT NULL")" = t ]; done
[ "$(Q "SELECT count(*) FROM loyalty_observations o JOIN loyalty_memberships ms ON ms.id=o.membership_id JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42C2 Mig Stays'")" = 1 ]
MIG migrate:up
[ "$(COLS loyalty_inbox_reads)" = "as_of,attempts,balance,dedupe_key,expiry_warnings,id,instruments,last_error_code,membership_id,observation_id,program_check,program_id,read_on,reason,received_on,resolved_on,state,suffix,unit" ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_reads")" = 0 ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_read_state")" = 1 ]
Q "DELETE FROM loyalty_observations WHERE membership_id IN (SELECT ms.id FROM loyalty_memberships ms JOIN loyalty_programs p ON p.id=ms.program_id WHERE p.name='ZQ42C2 Mig Stays')"
Q "DELETE FROM loyalty_memberships WHERE program_id IN (SELECT id FROM loyalty_programs WHERE name='ZQ42C2 Mig Stays')"
Q "DELETE FROM loyalty_programs WHERE name='ZQ42C2 Mig Stays'"
Q "DELETE FROM household_members WHERE display_name='ZQ42C2 Mig'"
echo "OK migration up-down-up"
```
`R` is the absence assertion for the refusals; under `set -e` it exits 1 if any is accepted (no leading `!`). The `loyalty_observations` delete inside `R` is refused because the table is append-only by convention only if the guardian adds a rule; if the guardian adds no such rule that `R` line fails and the guardian decides, at G1, whether the line is dropped (the spec does not require a DELETE guard on observations; 42a's table has none), recorded as a G1 amendment. After the `down`, the fixture observation survives (the `down` touches only the three tables).

**#6 (stored-state schema check).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
[ "$(Q "SELECT string_agg(table_name, ',' ORDER BY table_name COLLATE \"C\") FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name LIKE 'household%')")" = "household_member_addresses,household_members,loyalty_earn_rules,loyalty_inbox_messages,loyalty_inbox_not_mine,loyalty_inbox_read_state,loyalty_inbox_reads,loyalty_inbox_state,loyalty_inbox_unknown_senders,loyalty_instruments,loyalty_memberships,loyalty_observations,loyalty_program_aliases,loyalty_programs,loyalty_sender_domains" ]
FORBID='subject|body|snippet|content|header|text|from|local|recipient|member_number|raw|address|password|secret|token|prompt|output|response|name|parsed|extract'
[ "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('loyalty_inbox_reads','loyalty_inbox_not_mine','loyalty_inbox_read_state') AND column_name ~* '$FORBID'")" = 0 ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'")" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier" ]
RE_K='\("?dedupe_key"?\)'; RE_PS='\("?program_id"?, "?suffix"?\)'
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_inbox_reads' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_K'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_inbox_not_mine' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_PS'")" = 1 ]
[ "$(Q "SELECT string_agg(confdeltype::text, ',') FROM pg_constraint WHERE conrelid='loyalty_inbox_reads'::regclass AND contype='f'")" = "a,a,a" ]
[ "$(Q "SELECT string_agg(confdeltype::text, ',') FROM pg_constraint WHERE conrelid='loyalty_inbox_not_mine'::regclass AND contype='f'")" = "a" ]
for t in loyalty_inbox_reads loyalty_inbox_not_mine loyalty_inbox_read_state; do
  B="$(awk -v t="$t" '$0 ~ "^CREATE TABLE (IF NOT EXISTS )?" t "[ (]" {f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
  [ -n "$B" ] || { echo "FAIL db/schema.sql lacks $t"; exit 1; }
done
RB="$(awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_inbox_reads/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
for c in dedupe_key state attempts last_error_code reason suffix balance unit as_of program_check membership_id observation_id expiry_warnings instruments read_on resolved_on; do printf '%s\n' "$RB" | grep -q "$c" || { echo "FAIL schema.sql reads lacks $c"; exit 1; }; done
if git ls-files migrations | xargs grep -ln 'loyalty_inbox_reads\|loyalty_inbox_not_mine\|loyalty_inbox_read_state' | grep -v '_loyalty_inbox_read' | grep -q .; then echo "FAIL read schema written in an old migration"; exit 1; fi
echo "OK schema"
```

**#7 (new unit scenarios; two zones).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run packages/contracts/loyalty.test.ts lib/domain/loyaltyRead.test.ts lib/loyaltyReader.test.ts lib/loyaltyReadUi.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3","U4","U5","U6"]){const m=t.filter(x=>x.title.startsWith("T42c2-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||r.testResults.length!==4){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"files="+r.testResults.length);process.exit(1)}console.log("OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#8 (integration scenarios from one run; the cleanup check follows).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const want=[];for(let i=1;i<=11;i++){want.push("T42a-C"+i+":","T42a-I"+i+":")}want.push("T42a2-I1:","T42a2-I2:","T42a2-I3:");for(let i=1;i<=10;i++)want.push("T42b-I"+i+":","T42b2-I"+i+":");for(let i=1;i<=12;i++)want.push("T42c1-I"+i+":");for(let i=1;i<=14;i++)want.push("T42c2-I"+i+":");for(const p of want){const m=t.filter(x=>x.title.startsWith(p));if(m.length!==1||m[0].status!=="passed")bad.push(p+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(unexpected.length||bad.length||t.length!==370){console.log("FAIL",unexpected.join(" ; "),bad.join(","),"total="+t.length);process.exit(1)}console.log("OK 370 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 and T42c2-I1-I14 each present once and passed")' "$O"
LEFT="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "SELECT (SELECT count(*) FROM loyalty_programs WHERE name LIKE 'ZQ42C%')||','||(SELECT count(*) FROM household_members WHERE display_name LIKE 'ZQ42C%')||','||(SELECT count(*) FROM loyalty_inbox_messages)||','||(SELECT count(*) FROM loyalty_inbox_unknown_senders)||','||(SELECT count(*) FROM household_member_addresses)||','||(SELECT count(*) FROM loyalty_sender_domains WHERE domain LIKE '%zq42c%' OR domain LIKE '%attacker.test' OR domain LIKE '%other-sender.test')||','||(SELECT count(*) FROM loyalty_inbox_state WHERE last_polled_on IS NOT NULL OR last_outcome IS NOT NULL OR last_error_code IS NOT NULL)||','||(SELECT count(*) FROM loyalty_inbox_reads)||','||(SELECT count(*) FROM loyalty_inbox_not_mine)||','||(SELECT count(*) FROM loyalty_inbox_read_state WHERE last_read_on IS NOT NULL OR last_outcome IS NOT NULL OR last_error_code IS NOT NULL)")"
[ "$LEFT" = "0,0,0,0,0,0,0,0,0,0" ]
echo "OK no fixture rows left"
```
`T42c2-I1:` does not start with `T42c2-I10:` because of the colon. The total is the 42c1 baseline of 356 plus the 14 new tests (T6).

**#9 (integration stability; the 42a2 line 153 chain, unchanged).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 153 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '228p'"
bash -c "$(sed -n '153p' "$S2")"
```
Expected: `[]`, `[]`, `OK failing set stable and within KNOWN`.

**#10 (regression: 42c1 #7, #10 and #16, and the 42b class block, extracted with prefix guards).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S=plan/tasks/P8-42c1-loyalty-inbox/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S" 515 'set -e; for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web'
G "$S" 540 'set -e; S=plan/tasks/P8-42b2-card-earn-estimate/SPEC.md'
G "$S" 546 'RANGE="429,441"; BODY='
G "$S" 666 'set -e; D=apps/web/lib/fixtures/loyalty-inbox; I=apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts'
G "$S" 694 'echo "OK fixtures pinned and covered"'
bash -c "$(sed -n '515p' "$S")"
BODY="$(sed -n '540,546p' "$S")"; bash -c "$BODY"
BODY="$(sed -n '666,694p' "$S")"; bash -c "$BODY"
S42B=plan/tasks/P8-42b-card-annual-instruments/SPEC.md
G "$S42B" 332 'set -e; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs'
[ "$(sed -n '340p' "$S42B")" = 'echo "OK classes"' ]
BODY="$(sed -n '332,340p' "$S42B")"; bash -c "$BODY"
```
Expected: two `OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=<zone>` lines; the eleven OK lines of 42b2 #9 and `fixture shape ok`; then `fixture shape ok` and `OK fixtures pinned and covered` from 42c1 #16; then `OK classes`. 42c1 #7 asserts 42c1's unit tests, which this task must not break; 42c1 #16 asserts the 42c1 fixture directory is byte-identical.

**#11 (surface script over real HTTP).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
OUT="$(mktemp)"
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
node apps/web/scripts/gifts-surface-check.mjs > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ]; done
[ "$(tail -1 "$OUT")" = "OK H1-H15" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
SRC=apps/web/scripts/gifts-surface-check.mjs
[ "$(grep -cE "LOYALTY_IMAP_(HOST|PORT|TLS|USER|PASSWORD)" "$SRC")" -ge 5 ]
[ "$(grep -cF 'ANTHROPIC_API_KEY' "$SRC")" -ge 1 ]
[ "$(grep -cF 'ANTHROPIC_BASE_URL' "$SRC")" -ge 1 ]
echo "OK surface"
```
The last two guards assert the script strips the inherited key and aims any Anthropic client at a closed loopback port for the server it spawns, so no real credential and no real endpoint can be reached from it. Port 3198 must be free (T9).

**#12 (registry classes).**
```
set -ef; B="$(git merge-base HEAD main)"; R=apps/web/lib/giftSurfaceRegistry.ts
D="$(git diff -U0 "$B" -- "$R" | grep -E '^[-+][^-+]' | grep -E "classes|cls:" || true)"
N="$(printf '%s\n' "$D" | tr -s ' ' | sort)"
W="$(printf '%s\n' "+ { file: 'app/api/v1/loyalty/inbox/read/route.ts', classes: ['no-transaction-data'] }," "+ { file: 'app/api/v1/loyalty/inbox/readings/[id]/route.ts', classes: ['no-transaction-data'] }," | sort)"
[ "$N" = "$W" ]
if git diff -U0 "$B" -- "$R" | grep -E '^-[^-]' | grep -qE "classes|cls:"; then echo "FAIL a registry class line was removed or changed"; exit 1; fi
[ "$(grep -c "app/travel/page.tsx', classes: \['numeric-only'\]" "$R")" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/route.ts', classes: \['numeric-only'\]" "$R")" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/poll/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
echo "OK two registry lines added, none changed"
```

**#13 (source guards; no `!`).**
```
set -ef; B="$(git merge-base HEAD main)"; CH="$(mktemp)"; SRC="$(mktemp)"; SCOPE="$(mktemp)"; ADDED="$(mktemp)"
{ git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -E '^apps/web/(lib|components|app)/.*\.(ts|tsx)$' "$CH" | grep -vE '\.test\.ts$' > "$SRC" || true
while IFS= read -r f; do if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+transactions([^[:alnum:]_]|$)' "$f"; then echo "FAIL raw transactions read in $f"; exit 1; fi; done < "$SRC"
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
RD=apps/web/lib/loyaltyReader.ts; RP=apps/web/lib/loyaltyInboxRead.ts; RM=apps/web/lib/domain/loyaltyRead.ts; RT=apps/web/app/api/v1/loyalty/inbox/read/route.ts; RS=apps/web/app/api/v1/loyalty/inbox/readings/[id]/route.ts
for f in "$RD" "$RP" "$RM" "$RT" "$RS" apps/web/app/api/v1/loyalty/loyaltyRead.test.ts apps/web/lib/domain/loyaltyRead.test.ts apps/web/lib/loyaltyReader.test.ts apps/web/lib/loyaltyReadUi.test.ts; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
grep -E '^apps/web/(lib/loyaltyInbox[A-Za-z]*\.ts|lib/loyaltyReader\.ts|lib/domain/loyaltyInbox\.ts|lib/domain/loyaltyRead\.ts|app/api/v1/loyalty/inbox/|components/Loyalty|components/TravelBoard\.tsx|lib/loyaltyStore\.ts|lib/scheduler\.ts)' "$CH" | grep -vE '\.test\.ts$' | grep -vxF apps/web/lib/loyaltyInboxSource.ts > "$SCOPE" || true
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|toFixed|Math\.round'
while IFS= read -r f; do if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi; done < "$SCOPE"
for f in "$RD" "$RP" "$RM" "$RT" "$RS"; do
  if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
  if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
done
for f in apps/web/lib/loyaltyInbox.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/loyaltyInboxSource.ts apps/web/app/api/v1/loyalty/inbox/poll/route.ts apps/web/lib/scheduler.ts; do [ -z "$(git diff -U0 "$B" -- "$f" | grep -E '^-[^-]' || true)" ] || { echo "FAIL a line was removed from $f"; exit 1; }; done
LS="$(git diff -U0 "$B" -- apps/web/lib/loyaltyStore.ts | grep -E '^-[^-]' || true)"
if [ -n "$LS" ]; then [ "$(printf '%s\n' "$LS" | wc -l | tr -d ' ')" = 1 ]; printf '%s\n' "$LS" | grep -qE '^-  const \[members, programs, aliases, memberships, observations, instruments, watches, cardAccounts, inbox\] = await Promise\.all\(\[$'; fi
[ -z "$(git diff --name-only "$B" -- apps/web/app/api/v1/loyalty/inbox/poll/route.ts)" ]
[ "$(grep -cE "^const MODEL = 'claude-opus-5-5';" "$RD")" = 1 ]
[ "$(grep -cE "^const FALLBACK_MODEL = 'claude-opus-4-8';" "$RD")" = 1 ]
[ "$(grep -cF "server-side-fallback-2026-07-01" "$RD")" = 1 ]
grep -qE 'maxRetries:[[:space:]]*0' "$RD"; grep -qE 'timeout' "$RD"; grep -qE "type: 'json_schema'" "$RD"; grep -qE "effort: 'medium'" "$RD"
if grep -nE 'stream\(|\.stream|tools:|tool_choice|web_search|web_fetch|batches' "$RD"; then echo "FAIL the reader uses streaming, tools or batches"; exit 1; fi
AK="$(grep -lF 'ANTHROPIC_API_KEY' $(cat "$SRC") | sort | tr '\n' ' ')"
[ "$AK" = "apps/web/components/LoyaltyInboxReadPanel.tsx apps/web/lib/loyaltyReader.ts " ]
if grep -nE 'process\.env|ANTHROPIC_API_KEY[^ ]*[=:(\[]' apps/web/components/LoyaltyInboxReadPanel.tsx; then echo "FAIL the panel reads or assigns the key"; exit 1; fi
RMW="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$RMW" = "apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts " ]
PW="$(grep -rlF 'LOYALTY_IMAP_PASSWORD' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$PW" = "apps/web/lib/loyaltyInboxSource.ts " ]
[ -z "$(grep -rlE 'process\.env' apps/web/components apps/web/app/travel | tr '\n' ' ')" ]
TC="$( (git diff --name-only "$B" -- apps/web/components; git ls-files -o --exclude-standard apps/web/components) | grep -E '\.tsx$' | sort -u)"; [ -n "$TC" ]
if grep -nE "from '(imapflow|mailparser|@anthropic-ai/sdk|@/lib/db|\./db|pg)'" $TC; then echo "FAIL a component imports a server-only module"; exit 1; fi
if grep -E "from '" "$RM" | grep -vE "from '(@b8/contracts/loyalty|\./[A-Za-z]+)'"; then echo "FAIL the pure domain file imports something it must not"; exit 1; fi
for f in "$RD" "$RM" "$RT" "$RS"; do if sed 's/memberNumberSuffix//g' "$f" | grep -nE 'member_number|memberNumber'; then echo "FAIL member number named in $f"; exit 1; fi; done
for f in $TC; do if grep -nE 'member_number|raw_mail|dangerouslySetInnerHTML' "$f"; then echo "FAIL forbidden text in $f"; exit 1; fi; done
[ "$(grep -cF 'b8:loyalty-inbox:read' "$RP")" = 1 ]
[ "$(grep -cF 'b8:loyalty-inbox:poll' "$RP")" = 0 ]
SCH=apps/web/lib/scheduler.ts
[ "$(git diff -U0 "$B" -- "$SCH" | grep -E '^\+[^+]' | wc -l | tr -d ' ')" -ge 1 ]
[ "$(grep -c 'await runLoyaltyReadDaily()' "$SCH")" = 1 ]
L1="$(grep -n 'await runLoyaltyInboxDaily()' "$SCH" | head -1 | cut -d: -f1)"; L2="$(grep -n 'await runLoyaltyReadDaily()' "$SCH" | head -1 | cut -d: -f1)"; L3="$(grep -n 'await runDailyDigest()' "$SCH" | head -1 | cut -d: -f1)"
[ "$L1" -lt "$L2" ]; [ "$L2" -lt "$L3" ]
[ "$(grep -rhE 'memberNumber:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'cardAccountId:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'earn:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
while IFS= read -r f; do added "$f" >> "$ADDED"; done < <(grep -vE '\.test\.(ts|tsx)$' "$CH" | grep -E '^(apps/web/(lib|components|app)/.*\.(ts|tsx)|migrations/.*\.sql|db/schema\.sql|apps/web/scripts/gifts-surface-check\.mjs)$')
if grep -nE '^[[:space:]]*(//|/\*|\*|--)' "$ADDED" | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment"; exit 1; fi
if grep -nE "['\"][0-9]{4,}['\"]" "$RD" "$RP" "$RM" "$RT" "$RS" apps/web/app/api/v1/loyalty/loyaltyRead.test.ts apps/web/lib/domain/loyaltyRead.test.ts apps/web/lib/loyaltyReader.test.ts apps/web/lib/loyaltyReadUi.test.ts; then echo "FAIL a digit-only quoted string of four or more digits (a balance or a number) in a source or test file"; exit 1; fi
echo "OK task source guards"
```
Scope notes. The raw-transactions scan covers every changed non-test source. The clock scan reads only the lines this task adds (the whole file for a new one), so pre-existing lines of 42c1 files cannot trip it. The `done < <( … )` form is bash process substitution, dry-checked on macOS `/bin/bash` 3.2 at G0. The reader's constants are asserted by exact line shape so a stub cannot pass them without the real request existing; the unit scenario T42c2-U5 asserts the request itself.

**#14 (scope guard).**
```
set -f; B="$(git merge-base HEAD main)"; CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -vE '^(packages/contracts/loyalty(\.test)?\.ts|db/schema\.sql|migrations/[0-9]+_loyalty_inbox_read\.sql|apps/web/lib/loyaltyStore\.ts|apps/web/lib/loyalty\.test\.ts|apps/web/lib/loyaltyInbox[A-Za-z]*(\.test)?\.ts|apps/web/lib/loyaltyRead[A-Za-z]*\.test\.ts|apps/web/lib/loyaltyReader(\.test)?\.ts|apps/web/lib/domain/loyaltyInbox\.ts|apps/web/lib/domain/loyaltyRead(\.test)?\.ts|apps/web/lib/fixtures/loyalty-read/.*|apps/web/lib/scheduler\.ts|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/app/api/v1/loyalty/.*\.ts|apps/web/app/travel/page\.tsx|apps/web/components/(Loyalty|Travel)[A-Za-z]*\.tsx|apps/web/scripts/gifts-surface-check\.mjs)$' "$CH" || true
for f in packages/contracts/loyalty.ts packages/contracts/loyalty.test.ts db/schema.sql apps/web/lib/loyaltyStore.ts apps/web/lib/loyalty.test.ts apps/web/lib/loyaltyInboxRead.ts apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyReader.test.ts apps/web/lib/loyaltyReadUi.test.ts apps/web/lib/domain/loyaltyRead.ts apps/web/lib/domain/loyaltyRead.test.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/scheduler.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/scripts/gifts-surface-check.mjs apps/web/app/api/v1/loyalty/inbox/read/route.ts 'apps/web/app/api/v1/loyalty/inbox/readings/[id]/route.ts' apps/web/app/api/v1/loyalty/loyaltyRead.test.ts apps/web/app/api/v1/loyalty/loyaltyResponses.ts apps/web/lib/fixtures/loyalty-read/cases.json; do grep -qxF "$f" "$CH" || echo "MISSING $f"; done
[ "$(git ls-files -o --exclude-standard migrations | wc -l | tr -d ' ')" = 1 ] || echo "NOT EXACTLY ONE NEW MIGRATION FILE"
[ -z "$(git diff --name-only "$B" -- migrations)" ] || echo "AN EXISTING MIGRATION CHANGED"
git diff --name-only "$B" -- package.json package-lock.json apps/web/package.json 'apps/web/vitest*' evals apps/web/scripts/daily-job.ts apps/web/scripts/import-loyalty.ts apps/web/lib/logger.ts apps/web/lib/jobHealthRead.ts apps/web/lib/receiptReader.ts apps/web/lib/categorySuggester.ts apps/web/lib/loyaltyEarn.ts apps/web/lib/domain/loyalty.ts apps/web/lib/giftReadPath.ts apps/web/lib/domain/giftMask.ts apps/web/lib/sync.ts apps/web/lib/netWorth.ts apps/web/lib/fixtures/loyalty-inbox apps/web/lib/loyaltyInboxSource.ts apps/web/app/api/v1/loyalty/inbox/poll/route.ts apps/web/components/Dashboard* apps/web/lib/digest* apps/web/lib/push*
```
Expected: no output at all. `lib/loyaltyInbox.ts` is a 42c1 file edited additively only (command 13 asserts zero removed lines); `lib/domain/loyaltyInbox.ts` gains the text-preparation function. `apps/web/lib/loyaltyInboxRead.ts` matches `loyaltyInbox[A-Za-z]*` and is a required new file.

**#15 (existing-test edit guard and census).**
```
set -ef; B="$(git merge-base HEAD main)"
git diff -U0 "$B" -- packages/contracts/loyalty.test.ts apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/lib/loyalty.test.ts | node -e '
const d=require("fs").readFileSync(0,"utf8").split("\n");
const norm=(s)=>s.replace(/\binboxRead\s*:\s*[A-Za-z_][A-Za-z0-9_.]*/g,"").replace(/["\x27]ITEM_RESOLVED["\x27]/g,"").replace(/[\s,]+/g," ").replace(/\s+([\]})])/g,"$1").replace(/\[\s+/g,"[").trim();
const hunks=[];let cur=null;
for(const l of d){if(l.startsWith("@@")){cur={rem:[],add:[]};hunks.push(cur)}else if(cur&&l.startsWith("-")&&!l.startsWith("---"))cur.rem.push(l.slice(1));else if(cur&&l.startsWith("+")&&!l.startsWith("+++"))cur.add.push(l.slice(1))}
const bad=[];let surface=0,len=0,resp=0;
for(const h of hunks)for(const r of h.rem){
  if(r.includes("OK H1-H14")){if(h.add.some(a=>a.includes("OK H1-H15"))){surface++;continue}}
  if(r.includes("toHaveLength(12)")){if(h.add.some(a=>a.replace("toHaveLength(14)","toHaveLength(12)")===r)){len++;continue}}
  if(r.includes("expect(responses.length).toBe(7);")){if(h.add.some(a=>a.includes("expect(responses.length).toBe(9);"))){resp++;continue}}
  if(!h.add.some(a=>norm(a)===norm(r)))bad.push(r.trim().slice(0,80))}
if(bad.length||surface!==1||len!==4||resp!==1){console.log("FAIL existing test lines changed beyond the allowance:",bad.join(" | "),"surface="+surface,"length="+len,"responses="+resp);process.exit(1)}
console.log("OK existing tests edited only as allowed; removed lines "+hunks.reduce((n,h)=>n+h.rem.length,0))'
IF=apps/web/app/api/v1/loyalty/loyaltyRead.test.ts; DF=apps/web/lib/domain/loyaltyRead.test.ts; RF=apps/web/lib/loyaltyReader.test.ts; UF=apps/web/lib/loyaltyReadUi.test.ts
[ "$(grep -cE "it\('T42c2-I([1-9]|1[0-4]):" "$IF")" = 14 ] || echo "WRONG NEW INTEGRATION TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$IF")" = 14 ] || echo "EXTRA TESTS IN THE INTEGRATION FILE"
[ "$(grep -cE "it\('T42c2-U[2-4]:" "$DF")" = 3 ] || echo "WRONG DOMAIN TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$DF")" = 3 ] || echo "EXTRA TESTS IN THE DOMAIN FILE"
[ "$(grep -cE "it\('T42c2-U5:" "$RF")" = 1 ] || echo "WRONG READER TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$RF")" = 1 ] || echo "EXTRA TESTS IN THE READER FILE"
[ "$(grep -cE "it\('T42c2-U6:" "$UF")" = 1 ] || echo "WRONG UI TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$UF")" = 1 ] || echo "EXTRA TESTS IN THE UI FILE"
[ "$(git diff -U0 "$B" -- packages/contracts/loyalty.test.ts | grep -E "^\+" | grep -cE "it\('T42c2-U1:")" = 1 ] || echo "WRONG CONTRACT TEST COUNT"
[ "$(grep -c "app/api/v1/loyalty/inbox/read/route.ts" apps/web/lib/loyalty.test.ts)" -ge 1 ] || echo "READ ROUTE NOT IN LOYALTY_ROUTE_FILES"
[ "$(grep -cF "app/api/v1/loyalty/inbox/readings/[id]/route.ts" apps/web/lib/loyalty.test.ts)" -ge 1 ] || echo "READINGS ROUTE NOT IN LOYALTY_ROUTE_FILES"
```
Expected: one `OK existing tests edited only as allowed; removed lines <n>` line and no other output. `norm` forgives a removed line only when its added counterpart is equal once an `inboxRead: <identifier>` and the string `'ITEM_RESOLVED'` are deleted; the three other pins are matched by exact text, with expected pin counts of one surface line, four route-count lines and one response-count line.

**#16 (new fixtures pinned and covered).** The orchestrator replaces the digest literal in the `SUM` comparison before G0 freezes; a command run before that fails on purpose.
```
set -e; D=apps/web/lib/fixtures/loyalty-read; I=apps/web/app/api/v1/loyalty/loyaltyRead.test.ts; N=apps/web/lib/domain/loyaltyRead.test.ts; X=apps/web/scripts/gifts-surface-check.mjs; RF=apps/web/lib/loyaltyReader.test.ts
[ "$(ls "$D" | wc -l | tr -d ' ')" = 7 ]
[ "$(ls "$D"/*.eml | wc -l | tr -d ' ')" = 6 ]
SUM="$( (export LC_ALL=C; cd "$D"; shasum -a 256 *.eml cases.json | shasum -a 256 | cut -d' ' -f1) )"
[ "$SUM" = "a63773c1bd7db28be057caefbd246e2ae09b80b6ffa7774ed4b5bb04751d4cd8" ]
node -e '
const fs=require("fs"),path=require("path");const d=process.argv[1];const bad=[];
const c=JSON.parse(fs.readFileSync(path.join(d,"cases.json"),"utf8"));
if(typeof c.note!=="string"||!/fabricated/i.test(c.note)||!c.note.includes("ZQ42C2"))bad.push("note");
const files=fs.readdirSync(d).filter(f=>f.endsWith(".eml")).sort();
for(let i=1;i<=6;i++){if(!files.includes("R0"+i+".eml"))bad.push("missing R0"+i)}
for(const g of ["canaries","programs","members","memberships","decisions","clean","suffix","jump","retry","retention","surface"])if(!(g in c))bad.push("group "+g);
const ids=(g)=>Array.isArray(c[g])?c[g].map(x=>x.id):[];
const need={
 decisions:["apply-ok","apply-ok-usd","apply-zero-from-zero","no-balance-null","no-balance-unit-null","expiry-only","program-mismatch","program-not-stated","suffix-none","suffix-short","suffix-unmatched","suffix-unmatched-known-not-mine","suffix-ambiguous","suffix-other-program-only","unit-mismatch","as-of-missing","as-of-future","as-of-equal-stale","as-of-older-stale","no-baseline-none","no-baseline-zero","jump-over-up","jump-over-down","jump-at-boundary-up","jump-at-boundary-down","zero-from-positive-queued","injection-obedient-jump","injection-obedient-wrong-suffix"],
 clean:["balance-plain","balance-thousands","balance-european-decimal","balance-whole-with-fraction","balance-usd-one-fraction","balance-usd-three-fractions","balance-negative","balance-signed-plus","balance-exponent","balance-too-many-digits","balance-text","unit-not-in-enum","unit-missing","date-impossible","date-leap-valid","date-wrong-shape","suffix-masked-forms","suffix-long-printed","extra-keys","markup-and-instruction-strings","expiry-over-cap","expiry-bad-kind","expiry-bad-date","instrument-bad-kind","instruments-over-cap","not-an-object"],
 retry:["rate-limited-stops","timeout-retry","three-timeouts-stop","api-error-three-attempts","refused-terminal","bad-output-retry","empty-terminal","throw-counts-attempt","hang-bounded","isolation-after-failure","retry-failed-reset"]};
for(const g of Object.keys(need))for(const id of need[g])if(!ids(g).includes(id))bad.push(g+" lacks "+id);
const ok=/(^|\.)(test|example\.com|example\.net|example\.org)$/i;
for(const f of files){const t=fs.readFileSync(path.join(d,f),"utf8");
  if(!t.includes("ZQ42C2"))bad.push(f+" no canary");
  for(const m of t.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)){const dom=m[1].replace(/\.+$/,"");if(!ok.test(dom))bad.push(f+" real-looking domain "+dom)}
  if(/[0-9]+\.[0-9]{2}\b/.test(t))bad.push(f+" figure")}
if(bad.length){console.log("FAIL fixture shape:",bad.join(","));process.exit(1)}
console.log("fixture shape ok")' "$D"
for t in "$I" "$N" "$RF"; do grep -qF 'loyalty-read' "$t" || { echo "FAIL $t never loads the fixtures"; exit 1; }; done
grep -qF 'loyalty-read' "$X" || { echo "FAIL $X never loads the fixtures"; exit 1; }
for g in decisions clean suffix jump retry retention canaries; do grep -qF "$g" "$I" "$N" || { echo "FAIL no test reads the group $g"; exit 1; }; done
[ "$(cat "$I" "$N" | grep -cF 'expect(seen).toEqual(')" -ge 5 ] || { echo "FAIL fewer than five covered groups"; exit 1; }
LIT="['\"][-]?[0-9]+\.[0-9]{2,4}['\"]"
for f in "$I" "$N" "$RF"; do if grep -nE "$LIT" "$f"; then echo "FAIL a figure literal in $f"; exit 1; fi; done
echo "OK fixtures pinned and covered"
```

**#17 (mutation evidence).** The implementer records, in `plan/tasks/P8-42c2-loyalty-inbox-read/EVIDENCE.md`, one table row per deliberate mutation (list in Evidence required): `| M<n> | <file and change in words> | <the failing test id> | FAIL | reverted, green |`.
```
set -e; E=plan/tasks/P8-42c2-loyalty-inbox-read/EVIDENCE.md
[ -f "$E" ]
N="$(grep -cE '^\| M[0-9]+ \|.*\| FAIL \|.*reverted' "$E")"
[ "$N" -ge 10 ] || { echo "FAIL only $N mutation rows with FAIL and reverted"; exit 1; }
for id in 'T42c2-U3' 'T42c2-I3' 'T42c2-I4' 'T42c2-I5' 'T42c2-I9' 'T42c2-I14'; do grep -qF "$id" "$E" || { echo "FAIL no mutation row names $id"; exit 1; }; done
if grep -nE '\$[0-9]{3,}|[0-9]{1,3}(,[0-9]{3})+|ZQ42C2-[A-Z]+-[0-9]{4,}' "$E"; then echo "FAIL EVIDENCE.md holds a money-looking or member-number-looking figure"; exit 1; fi
echo "OK mutation evidence rows $N"
```

**#18 (this spec's own public-safety scan).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md
if grep -nE '\$[0-9]{3,}|\$[0-9]{1,3},[0-9]{3}|\$[0-9]+\.[0-9]{2}' "$S"; then echo "FAIL a dollar figure in the spec"; exit 1; fi
if grep -nE '[0-9]{1,3}(,[0-9]{3})+' "$S" | grep -vE "[0-9]+,[0-9]+p'|RANGE=\"[0-9]+,[0-9]+\""; then echo "FAIL a thousands-separated figure in the spec"; exit 1; fi
BAD="$(grep -oE '[0-9]{6,}' "$S" | sort -u | grep -vxE '1793000000000' || true)"
[ -z "$BAD" ] || { echo "FAIL a long number in the spec: $BAD"; exit 1; }
if grep -nEi 'member number [0-9]|balance of [0-9]' "$S"; then echo "FAIL a balance or number stated in the spec"; exit 1; fi
echo "OK spec has no money-looking text"
```

## Scenarios
Fixture canary `ZQ42C2`. Every date offset is computed by Postgres (`SELECT (CURRENT_DATE + n)::text`). Each integration test seeds what it asserts on (programs and members named `ZQ42C2 …`, their memberships, baseline readings, sender domains, stored-message rows inserted by SQL from the pinned `.eml` bytes), injects a fake reader by mocking `createMailReader`, sets `ANTHROPIC_API_KEY` to the fixture's key canary itself and restores the environment afterwards, resets `loyalty_inbox_read_state` and removes every row it created (reads, not-mine, observations, memberships, programs, members). Group assertions end with `expect(seen).toEqual(<ids from cases.json>)`. No scenario reads the dev database or opens a non-loopback socket.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42c2-U1 | The contract accepts and refuses exactly the described shapes. | `LoyaltyOverviewSchema` accepts a fixture `inboxRead` for every state and refuses: a missing `inboxRead`, a stray key at any depth, a `maskedSuffix` that is not the masked form or holds more than 4 characters after the bullets, a negative count, more than `LOYALTY_READ_QUEUE_LIMIT` items, an unknown reason, a `balanceInLastStatement` outside `yes`/`no`/`not_read`, an expiry amount for `status`. `LoyaltyInboxReadResponseSchema` accepts the four outcomes and refuses `read` different from `applied + queued + stale + noBalance + discarded`, an `errorCode` with outcome `ok`, a missing count, a stray key (`subject`, `body`, `text`, `raw`), a negative or fractional count. `LoyaltyInboxResolveRequestSchema` accepts the three actions, refuses `membershipId` with `not_mine` or `ignore`, an unknown action and a stray key. `LoyaltyErrorCodeSchema` accepts the old codes and `ITEM_RESOLVED`. The constants equal 3, 25, 400, 50, 3, 4, 50, 20000, 60, 300, 3, 5, 10 in the order listed in Contracts touched. | A schema that lets a body or number through, a count that contradicts its parts, an unbounded list, a renamed constant. |
| T42c2-U2 | The clean pass keeps only what is well-formed, exactly. | `lib/domain/loyaltyRead.ts` over `clean`: every id's expected result, each balance form accepted or rejected as the fixture says (digits only, grouped thousands accepted; European decimal, fraction on a whole unit, three fractional digits, a sign, an exponent, text, more than 12 digits rejected to null with the unit also null; one fractional `usd` digit padded, never rounded); a unit outside the enum nulls the balance; an impossible or wrongly shaped date is null and a leap day is valid; suffix forms keep at most the last 4 alphanumerics upper-cased and nothing under 3; extra keys and non-enum values dropped; strings carrying markup or instructions never survive in any field; arrays over the caps truncated or dropped as the fixture says; a non-object is wholly empty. Ids asserted with `seen`. | A balance that is rounded, signed or mis-scaled, a free-text field stored, a long number kept as a suffix, a date the calendar does not have. |
| T42c2-U3 | The decision order, suffix matching and the jump rule. | The pure decision function over `decisions`, `suffix` and `jump`: every id yields the state, reason and observation flag the fixture states, in the order of "The decision order"; the two boundary jumps (exactly 50 percent up and down) apply and the two just-beyond jumps queue; zero against a positive balance queues; zero against zero applies; an ambiguous suffix is never a match; a suffix equal to a membership of another program does not match; a `no_balance` outcome is never queued; `stale` is never queued; a known not-mine suffix is discarded only when no membership matches. The arithmetic is exact for each unit scale (BigInt or equivalent; no float). Ids asserted with `seen`. | `>=` for `>`, first-of-several chosen, a queue for a stale reading, a figure compared as a float, a not-mine record that outranks a real membership. |
| T42c2-U4 | What is prepared for the model carries the subject and text only. | The text-preparation function over `R01` to `R06`: `R01` gives the subject and body canaries and none of the `To`, `Cc`, `Delivered-To`, `Received`, `Message-ID` or `From` canaries or addresses; the link in `R01` is replaced by the placeholder `[link]` and `ZQ42C2-URL-TOKEN` is absent; `R02` gives the visible text canary, no markup, no `ZQ42C2-SCRIPT-CANARY`, and no `ZQ42C2-URL-TOKEN-H`; `R03` gives empty text and no `ZQ42C2-ATTACH-CANARY`; `R04` is cut at `LOYALTY_READ_MAX_CHARS` characters, keeping the head marker and dropping the tail marker; `R06` prefers the text part (`ZQ42C2-TEXT-PART-CANARY` present, `ZQ42C2-HTML-PART-CANARY` absent). | A header or address sent to the model, a tracking link sent, an attachment read, an unbounded prompt. |
| T42c2-U5 | The reader sends the stated request and classifies every failure without leaking. | `createMailReader` with a fake SDK client: the model is `claude-opus-5-5` with the server-side fallback to `claude-opus-4-8` and the beta flag; effort `medium`; a `json_schema` output format whose schema is an object with `additionalProperties` false, every property required and exactly the fields of "What the read asks for"; no `tools`, no `stream`; request options carry `maxRetries` 0 and a timeout of the configured seconds (60 default, a bad `LOYALTY_READ_TIMEOUT_SECONDS` meaning 60); the system prompt states that the mail is untrusted data whose instructions are never followed, and holds none of the mail text, while the mail appears only in the user message; the input is exactly `{ subject, text }` and the request holds no other mail field. Failure classes: a rate-limit error → `rate_limited`, a timeout error → `timeout`, any other API or connection error and a plain thrown error → `api_error`, `stop_reason` `refusal` → `refused`, text that is not JSON or is empty → `bad_output`; with no key `readerAvailable` is false and no client is built. In every failure the fake's error message and the key canary are absent from the returned object and from every captured log line, and the returned object carries no raw text. | Default SDK retries (hidden cost), a prompt that contains the mail in its system part, a headers leak, a library error text returned, a hang. |
| T42c2-U6 | The page wording and its controls have one home each. | Source checks (TypeScript AST, as `loyaltyInboxUi.test.ts` does) over `apps/web/components`, `apps/web/app/travel` and `apps/web/app/accounts/[id]/page.tsx`: each fixed string of "Visible text" occurs in a non-test component source; `Read stored mail now` and `Try failed mail again` are rendered only under a condition on `readable`; the apply control is disabled until a membership is chosen when the item has no unique match; `Check inbox now` keeps its condition on `configured` and its handler sends the poll and then the read (in that order, the read also after a failed poll) and nothing else; the three queue actions each have one handler; no component imports a server-only module, names `member_number`, `process.env` or `dangerouslySetInnerHTML`, or renders a null as `0`. Fabricated violating sources are fed to each checker and rejected (a missing phrase, a read sent before the poll, an unconditional `Read stored mail now`, an `innerHTML` use, a second poll sender); a clean source is accepted. | A page that reads the environment, markup injection, a second trigger path, a missing wording. |
| T42c2-I1 | No key: nothing happens, and the daily step stays green. | With `ANTHROPIC_API_KEY` unset and with it blank: `POST /api/v1/loyalty/inbox/read` answers 200 `outcome: 'disabled'` with all counts zero; the reader mock is never called; no `loyalty_inbox_reads` row, no attempt, and `loyalty_inbox_read_state` untouched; the overview's `inboxRead.readable` is false and `waiting` still counts the stored messages. `runLoyaltyReadDaily()` resolves and wrote nothing. With the key set the same call reads. | A poller that errors the job without a key, an attempt counted for nothing, a key shown in the overview. |
| T42c2-I2 | The happy path appends one `email` observation and is idempotent. | The `apply-ok` and `apply-ok-usd` decisions: after one run the membership has exactly one new `loyalty_observations` row with source `email`, the fixture's canonical balance text, unit and as-of, linked from its reads row (`state` `applied`, `observation_id`, `membership_id`); `membershipView` shows it as the current balance; the earlier reading is unchanged (append-only); a second run reads nothing more (the reader mock's call count does not grow), appends nothing, and the response counts are zero; the same statement mailed under a second dedupe key is `stale` and appends nothing. | A second observation for the same mail, an update of an old row, a reading not visible through the reducer. |
| T42c2-I3 | Every rule fires in its place, over the whole fixture set. | Every `decisions` id through the full pipeline: the resulting `state`, `reason`, `membership_id`, whether an observation was appended and the current balance after, as the fixture says; the queue (overview `needsAttention`) holds exactly the queued ids, newest first; a program mismatch, an ambiguous suffix, a unit change, a future date, a missing date, no baseline and an implausible jump each queue and append nothing; `no_balance`, `stale` and `not_mine_known` are resolved without an item and without an observation; the two boundary jumps apply; `seen` equals the fixture ids. | A rule skipped or reordered, a stale reading queued, a balance-less mail queued, an observation appended for a queued item. |
| T42c2-I4 | One bad message never blocks the rest; retries are counted and bounded. | The `retry` scripts: a message failing with each code beside a good message, which is still read and applied; attempts increment by one per run, also when the reader throws; `refused` and `empty_message` are terminal at the first run; `timeout`, `api_error` and `bad_output` stay `retry` for two runs and are `failed` at the third; a `failed` message is not offered to the reader on the next run; `rate_limited` stops the run after the first message (the later messages are untouched, no attempt counted for them) with outcome `error` code `rate_limited`; three consecutive timeouts stop the run; a never-settling reader is cut off (fake timers) after its bound, the lock is released and the next run proceeds; messages beyond `LOYALTY_READ_MAX_PER_RUN` stay unread and `remaining` says how many; with fake timers the run budget stops new starts. `retryFailed` deletes only `failed` rows whose bytes still exist, and the next run reads them again. | An abort on the first failure, an attempt not counted when the reader throws, an unbounded retry, a stalled call holding the lock, a rate limit hammered. |
| T42c2-I5 | One reader at a time and one effect per tap. | Two overlapping read runs (the first held by a gated fake reader): the second answers 200 `already_running` with zero counts and the reader mock sees each message once; after release the first completes; a read run while the lock is held elsewhere is `already_running`; a reader that throws and a timeout both release the lock (the next run proceeds); the read lock and the poll lock are independent (a poll in progress does not block a read). Two simultaneous `apply` requests for one item append exactly one observation, one 200 and one 409 `ITEM_RESOLVED`. | A double read, a double apply, a lock never released, a read blocked by a poll. |
| T42c2-I6 | The three queue actions and their authority. | `apply` on an item with a unique match (no body membership needed), with an ambiguous item (needs `membershipId`; one of the program's memberships is accepted, a membership of another program is 400 `INVALID_INPUT`, a missing one is 400), with a null as-of (observation dated by `received_on`), with a future as-of (400), and with an older as-of (written, not current); `not_mine` records (program, suffix), resolves every other pending `unmatched_suffix` item of that program and suffix, and a later read of that suffix is `not_mine_known` while no membership matches it and queues again once a membership with that suffix exists; `ignore` resolves with no record and no observation. A second action on a resolved item is 409 `ITEM_RESOLVED`, an unknown id 404, a malformed body 400 with an error message that echoes nothing. For the read route and the readings route: a read-scope bearer token is 403 `INSUFFICIENT_SCOPE` and changes nothing, no credential is 401, a write-scope token and a session work; a second b8 user and the owner see identical `inboxRead`. | A tap that applies twice, a not-mine record that suppresses a real membership, a read token that can write, an echoed input. |
| T42c2-I7 | Hostile reader output never reaches storage as written. | Every `clean` entry injected through the pipeline: the stored row's non-null columns are only enums, dates, canonical decimal text, the 3 or 4 character suffix and the JSON arrays of enum, date and decimal-text objects; a SQL scan of every text column of the three new tables for `<`, `>`, a space, `ignore` or any fixture canary string finds nothing; an object with extra keys stores none of them; a balance rejected by the clean pass makes the row `no_balance` and never a queue item. | A stored free-text field, markup in the page, a figure stored un-normalised. |
| T42c2-I8 | A reader that obeys the mail still cannot move a balance past the gate. | The `injection-obedient-jump` and `injection-obedient-wrong-suffix` decisions over `R05`: the obedient fake reports an enormous balance for a real suffix, and a wrong suffix: both are queued (`implausible_jump`, `unmatched_suffix`), no observation is appended and the current balance is unchanged; an obedient reading that is newer, unit-matching and within the 50 percent bound **does** apply (the residual risk, asserted so it is stated rather than hidden); no message is applied without a suffix that matches exactly one membership of the message's own program. | An auto-apply path that skips a rule when the reader insists, a spoof that matches no real suffix and still applies. |
| T42c2-I9 | Privacy: counts and codes only, masked suffix only. | With the key canary, the body, subject, URL-token and header canaries and a fabricated full member number in the environment and rows: collect the body of `GET /api/v1/loyalty`, of both new routes in every outcome and error, and every captured log line (console and logger) across the whole test file; none contains the key, any canary, the full member number, any URL, an address or a model-output canary (the fake reader returns an extra key holding one, which must be dropped). `inboxRead` and every nested key set equal the contract's exactly; every `maskedSuffix` parses against the masked schema and the full number is never reachable from any payload. A server-render of `TravelBoard` text holds none of them. | A raw body or number in a response, a key in a log, an `inboxRead` with an extra key, a balance in a log line. |
| T42c2-I10 | The real reader's failure path, deterministically, over loopback. | Do not mock `createMailReader`. Bind a listener on `127.0.0.1` port 0 that counts connections and destroys each socket at once; set `ANTHROPIC_BASE_URL` to it and `ANTHROPIC_API_KEY` to the key canary. One read of one message: the row is `retry` with `api_error` and attempts 1; the listener saw exactly one connection (so no SDK retry happened); the lock is released; the key canary, the host and any library text are absent from the result, the stored state and every captured log line. A second listener that accepts and never answers, with `LOYALTY_READ_TIMEOUT_SECONDS` of 1, yields `timeout` within the bound and a released lock (fake timers allowed). | SDK-level retries that multiply cost, a credential in a failure, a hang with the lock held. |
| T42c2-I11 | Retention, coverage, counts and null semantics. | Reads rows at 399, 400 and 401 days: the purge deletes only the 401 row, in every state including `pending`, keeps `loyalty_inbox_not_mine`, and running it twice deletes nothing more. `inboxRead.coverage`: `yes` when the newest read row has a balance (also when that row is `stale` or queued), `no` when it has none, `not_read` when only `retry`/`failed` rows or none exist, for programs with and without mail; never `no` for a program that was never read. `waiting`, `failed`, `lastRead` (null before any run, then `ok` or `error` with its code), `needsAttentionTotal` above the list cap with the list at exactly `LOYALTY_READ_QUEUE_LIMIT`; `fromMail` holds the newest qualifying row per membership, never a `pending` row, never a row with both arrays empty. A balance of zero is present in an item, not dropped. | An off-by-one retention, a `no` shown where nothing was read, a pending mail decorating a membership, a null shown as zero. |
| T42c2-I12 | Nothing but the named rows moves. | Checksums of `accounts`, `transactions`, `budget_categories`, `transfer_groups` and of `loyalty_programs`, `household_members`, `loyalty_memberships`, `loyalty_instruments`, `loyalty_earn_rules`, `loyalty_sender_domains`, `household_member_addresses`, `loyalty_inbox_messages` and `loyalty_inbox_unknown_senders` are identical before and after a full read, a purge and each queue action, except that `apply` and an auto-apply add `loyalty_observations` rows (source `email`) and nothing else; no `loyalty_instruments` row appears from any extracted instrument; `computeCurrentNetWorth` is unchanged. The loyalty route files number 14 and the two new ones are classified `no-transaction-data` in the registry. | A write to the ledger, an instrument created from mail, a membership created from a suffix. |
| T42c2-I13 | The daily job. | `runDailyJob()` with every other step module mocked: `runLoyaltyInboxDaily` then `runLoyaltyReadDaily` then the digest, in that order; with the key unset the read step wrote nothing and the digest still ran; with a reader that rejects with an error whose message holds the key canary the job still resolves, the digest still runs, and neither the result nor any captured log line holds the canary; the step purges extracted rows past retention. | A read failure that costs the digest, an out-of-order step, a secret in a log. |
| T42c2-I14 | What reaches the reader, end to end. | Stored rows from `R01` to `R06` run with a recording fake reader: it receives exactly `{ subject, text }` per message; `R01`'s input holds the subject and body canaries and none of the header, address, Message-ID or URL-token canaries; `R02` and `R06` as in T42c2-U4; `R04`'s text is at most `LOYALTY_READ_MAX_CHARS` characters; `R03` has no readable text, so the reader is not called for it and its row is `failed` with `empty_message` at the first run; a message row with its bytes already deleted is never offered. | A header or link sent to the model, an unbounded prompt, a model call for a message with nothing to read. |
| T42c2-H15 | Over real HTTP, the queue, the wording and the actions behave and leak nothing. | In `gifts-surface-check.mjs`, after H14, on its scratch database: the server is spawned with the inherited `ANTHROPIC_` variables removed and `ANTHROPIC_API_KEY` absent, plus `ANTHROPIC_BASE_URL` aimed at a loopback port the script bound and closed. Seed by SQL from `cases.json` group `surface`: pending items (one with a unique match, one ambiguous, one with no date), a `yes`/`no`/`not_read` coverage trio, a membership with extracted expiry and instrument fields, a failed row, a retry row. For the owner and the second user: `/travel` holds `Needs attention: `, the item lines, the reason texts, `Apply`, `Not mine`, `Ignore`, `Apply to`, `Choose a membership`, `Reading mail is not set up`, `ANTHROPIC_API_KEY`, `Balance in last statement: yes`, `Balance in last statement: no`, `Balance in last statement: not read yet`, `Expires `, `From mail: `, `Could not be read: `, `Not read yet`, and neither `Read stored mail now` nor `Try failed mail again`. `POST /api/v1/loyalty/inbox/read` with the owner's cookie answers 200 `outcome: 'disabled'`, with no cookie 401, with a read-scope token 403. `POST /api/v1/loyalty/inbox/readings/<id>` with `apply` on the unique item answers 200, the item leaves the queue, the membership's balance on `/travel` and in the API is the applied one, a second apply answers 409; `not_mine` and `ignore` leave the queue; the ambiguous item refuses a membership of another program with 400. Across every response of the step, `/travel` and the API hold no full member number, no key and no loopback host. The step prints `H15 PASS …` and the final line becomes `OK H1-H15`. The classes of `/travel` and the existing loyalty routes are unchanged. | A page that does not render the queue, an unauthenticated or read-token action, a leaked number, a stale readout, an apply that does not reach the balance. |

### What the read asks for (the model's schema; exact field set)
`programName` (string or null), `memberNumberSuffix` (string or null: the visible trailing characters as printed, mask characters dropped), `balance` (string or null: digits with an optional decimal point; no currency symbol), `unit` (`points`, `miles`, `nights`, `usd` or null), `asOf` (`YYYY-MM-DD` or null), `expiryWarnings` (array of `{ what, expiresOn, amount }`; `what` one of `LOYALTY_READ_EXPIRY_KINDS`, `expiresOn` a date, `amount` a string or null), `instruments` (array of `{ kind, expiresOn }`; `kind` one of the existing instrument kinds, `expiresOn` a date or null). Every field is required in the schema (a null is the answer "not on the mail"). The model is never asked for a name, an address, a full number or any free-text field.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | An ambiguous suffix is not a match | two memberships of one program whose numbers share the printed suffix (`suffix-ambiguous`) | T42c2-U3, T42c2-I3 |
| 2 | A suffix matches only memberships of the message's own program | a suffix equal to a membership of another program (`suffix-other-program-only`) | T42c2-U3, T42c2-I3 |
| 3 | The as-of must be strictly newer | equal as-of (`as-of-equal-stale`) and older as-of (`as-of-older-stale`): no observation, no item | T42c2-U3, T42c2-I3, T42c2-I2 |
| 4 | An implausible jump is queued, a boundary one applies | just beyond 50 percent up and down (`jump-over-up`, `jump-over-down`), and zero against a positive balance (`zero-from-positive-queued`); exactly on the line applies | T42c2-U3, T42c2-I3 |
| 5 | A reading needs a baseline | no stored reading (`no-baseline-none`), a stored zero and a positive candidate (`no-baseline-zero`) | T42c2-U3, T42c2-I3 |
| 6 | A future date is never applied, by machine or by hand | `as-of-future`; an `apply` action on a future as-of | T42c2-I3, T42c2-I6 |
| 7 | A different program name queues | `program-mismatch` | T42c2-I3 |
| 8 | A unit change queues | `unit-mismatch`; a balance with no unit becomes no balance | T42c2-U2, T42c2-I3 |
| 9 | A balance is never rounded, re-signed or mis-scaled | fraction on a whole unit, three fractional digits, a sign, an exponent, European decimal, more than 12 digits | T42c2-U2, T42c2-I7 |
| 10 | No free text from the model is stored | extra keys, strings with markup or instructions in every field | T42c2-U2, T42c2-I7, T42c2-I9 |
| 11 | A mail with no balance is never queued and creates no observation | `no-balance-null`, `expiry-only` | T42c2-I3 |
| 12 | A not-mine record never outranks a real membership | a recorded suffix that a membership later carries | T42c2-I6, T42c2-U3 |
| 13 | A tap applies once | two simultaneous applies, a second apply on a resolved item | T42c2-I5, T42c2-I6 |
| 14 | One bad message does not block the rest | a failing message beside a good one | T42c2-I4 |
| 15 | Retries are bounded and an attempt always counts | three failures make `failed`; a thrown reader counts; `refused` and `empty_message` end at once; a failed message is not re-offered | T42c2-I4 |
| 16 | A rate limit does not hammer | the run stops at the first `rate_limited` | T42c2-I4 |
| 17 | A stalled call cannot hold the lock | a never-settling reader, a hanging loopback listener | T42c2-I4, T42c2-I10 |
| 18 | Two readers never run at once | an overlapping run answers `already_running` | T42c2-I5 |
| 19 | The model sees the subject and text only | `To`, `Cc`, `Delivered-To`, `Received`, `Message-ID`, `From` canaries, URL tokens, attachment content and the HTML-only canary | T42c2-U4, T42c2-U5, T42c2-I14 |
| 20 | The prompt keeps mail out of the system part | mail text placed in the system message | T42c2-U5 |
| 21 | No SDK-level retry multiplies cost | a default-retry client against a connection-counting listener | T42c2-U5, T42c2-I10 |
| 22 | No key, no read, no attempt | `ANTHROPIC_API_KEY` unset or blank | T42c2-I1 |
| 23 | A read-scope token cannot read or act; no credential is 401 | read-scope bearer on both routes, no cookie | T42c2-I6, T42c2-H15 |
| 24 | A full member number, a key or a raw body is never emitted or logged | canaries in every payload, log line and rendered text | T42c2-I9, T42c2-H15 |
| 25 | An instrument or expiry in mail creates no instrument row and decorates a membership only when resolved | extracted instruments; a `pending` row | T42c2-I11, T42c2-I12 |
| 26 | Retention is strict at 400 days and deletes no configuration | 399, 400, 401 day rows; the not-mine list | T42c2-I11 |
| 27 | "Not read" is not "no balance" | a program with nothing read | T42c2-I11 |
| 28 | The ledger and every other loyalty table are untouched | checksums before and after | T42c2-I12 |
| 29 | A read failure never costs the digest | a rejecting reader in the daily job | T42c2-I13 |
| 30 | A spoofed, obedient reading cannot apply without a real matching suffix | `injection-obedient-wrong-suffix`, `injection-obedient-jump` | T42c2-I8 |

## Evidence required
- `EVIDENCE.md` with: the docs files read under `node_modules/next/dist/docs/` and the skills invoked; the verbatim output of every acceptance command (numbers inside assertion diffs redacted); a migration up/down/up log.
- A **decision table** over the `decisions` fixture printing only case id, state, reason and "observation appended: yes or no" (never a balance, a suffix or a member number).
- The **model decision record** (OQ1): the constants as implemented, and one sentence on how the effort level and timeout were chosen.
- **Mutation evidence** (command 17): at least ten deliberate single-line breaks, each shown failing the named test and then reverted. The implementer chooses at least these: M1 jump `>` becomes `>=` (T42c2-U3, T42c2-I3); M2 strictly-newer becomes not-older (T42c2-U3, T42c2-I3); M3 suffix match by substring or prefix instead of ending (T42c2-U3, T42c2-I3); M4 an ambiguous suffix picks the first match (T42c2-I3); M5 the not-mine record applied even when a membership matches (T42c2-I6); M6 the per-message catch removed (T42c2-I4); M7 the attempt counted only after a successful call (T42c2-I4); M8 `rate_limited` no longer stops the run (T42c2-I4); M9 the lock not released on error (T42c2-I5); M10 queue apply without the resolved-state check (T42c2-I5, T42c2-I6); M11 the clean pass keeps extra keys or free text (T42c2-I7); M12 decimals on a whole unit rounded instead of rejected (T42c2-U2); M13 the `To` header added to what the reader receives (T42c2-I14); M14 links left in the text (T42c2-U4); M15 a balance written into a log line (T42c2-I9); M16 SDK retries left at default (T42c2-U5, T42c2-I10); M17 retention `<=` for `<` (T42c2-I11); M18 the observation written with source `typed` (T42c2-I2); M19 coverage derived from state instead of balance presence (T42c2-I11); M20 the read route accepting a read-scope token (T42c2-I6); M21 a program mismatch ignored (T42c2-I3); M22 a no-balance mail queued (T42c2-I3).
- The **residual-risk paragraph** (OQ17) reproduced in EVIDENCE.md, plus the three counts the owner will want after the first real day: messages read, applied, queued (counts only).
- The loopback listener's connection count from T42c2-I10 (a count, not a figure).

## Failure modes to test
- **Off-by-one on the jump boundary.** Exactly 50 percent must apply, one minor unit beyond must queue; both up and down; and per unit scale (a `usd` boundary in cents, a whole-unit boundary in units).
- **Zero versus null.** A balance of `0` must be a reading (applied against a zero baseline, queued against a positive one), never dropped as falsy; a null balance must be `no_balance`, never `0`.
- **Float artefacts.** A percentage or difference computed with JS numbers can mis-round a boundary; a balance parsed with `parseFloat` or `Number` can lose digits or accept `1e9`.
- **Scale and sign.** A figure with a fraction on a whole unit, a `usd` figure with one or three decimals, a leading sign, an exponent, thousands separators of the wrong kind, a negative; the clean pass must reject, never repair by rounding.
- **Ambiguous and cross-program suffixes.** Two memberships sharing the last characters; a membership of another program that matches; a suffix of 2 characters; a printed full number longer than 4 characters; mask characters inside the suffix; lower case; a membership with no stored number.
- **As-of ordering.** An old statement re-forwarded after a newer one; the same as-of with a different balance; an as-of dated tomorrow in another time zone (one day of slack, two is refused); an as-of absent; "newest" decided by arrival instead of as-of.
- **Double effects.** Two read runs over the same message; two taps on one item; a message re-read after a crash between the attempt count and the result; an apply and a state change that are not one transaction (an observation with no state, or a state with no observation).
- **Attempt accounting.** A reader that throws synchronously; a call that never settles; a failure counted twice; a rate limit that burns the attempts of the messages it never reached; `retryFailed` resetting rows whose bytes are gone.
- **Lock leaks.** The lock held after an exception, a timeout or a stalled reader; a read lock that collides with the poll lock or with another feature's key.
- **Privacy.** A header, address, Message-ID or tracking URL in the model input; the HTML `script` or `style` text sent; an attachment read; mail text in the system prompt; the raw model output, a balance, a suffix or a key in a log; an error message echoed; a full member number reachable through `candidateMembershipIds` or any joined field.
- **Prompt injection.** An obedient reader reporting a huge balance, a wrong unit, a future date or a real suffix with an out-of-bound jump; text in a returned string field that survives into the page; a field the model adds that is stored.
- **Queue integrity.** A resolved item still listed; a `stale` or `no_balance` message queued; a pending item whose membership was chosen from another program; a not-mine record that hides a real membership; the list not capped, or capped without a total; an item with no as-of that is applied with no date.
- **Coverage semantics.** `not_read` rendered as `no`; coverage computed from the newest message instead of the newest read; a failed or retry row counted as "read"; a queued row hiding that it carried a balance.
- **Retention.** `<=` instead of `<` at 400 days; the not-mine list or the state row purged; pending items kept past retention; reads rows deleted when the raw mail is purged at 30 days (they must outlive it).
- **Null rendering.** `Not read yet` shown as a date; `no date` as an empty string; an instrument with no expiry shown as a date; the text `null` anywhere.
- **Ordering assumptions.** Messages processed in arrival order instead of `received_on`, id; an unordered queue; a re-attribution or a poll racing the read.
- **Cost and time.** More than the per-run cap read; the run budget ignored; consecutive transport failures not stopping the run; a hung call blocking the digest.
- **Double counting via JOIN.** A suffix match that joins memberships and duplicates a row when a member has two programs' memberships; use an existence test or a grouped count, not a join that multiplies items.

## Open questions with defaults
Owner standing instruction (2026-11-21): auto mode, spec defaults taken. Each was decided; the default is the spec.

1. **Model, effort, timeout.** Default: **`claude-opus-5-5`**, the model `receiptReader.ts` already uses, with the same server-side fallback to `claude-opus-4-8` on a policy refusal, effort `medium` (the model's default, set explicitly), `max_tokens` large enough for thinking plus a small JSON object (the receipt reader's setting is the floor), one non-streaming request per attempt, a per-call timeout of 60 seconds, and no SDK-level retry. Why this model: a mail is short, a household reads tens of messages a month, so the cost of the top model is a rounding error against the cost of one wrong balance written without anyone looking, and accuracy on a figure, a masked number and a date is exactly what this step buys. A cheaper Sonnet-class or Haiku-class model would save little in absolute terms and has a higher chance of a misread number or a followed instruction. Haiku also has no server-side refusal fallback. The Fable tier is rejected: it costs more and the task is extraction, not long-horizon reasoning. One model constant family across the repo keeps the cost and behaviour model simple. Effort `medium` because extraction from a short mail needs little reasoning, and the deterministic gate after it, not model depth, is the safety. 60 seconds because a single short request normally completes in seconds, a stall is rare, and 25 messages at the bound are cut off by the run budget. **Failure codes** per message: `rate_limited`, `timeout`, `api_error`, `refused`, `bad_output`, `empty_message`; per run: `rate_limited`, `timeout`, `api_error`, `store_failed`. **Not decided here and left to the implementer:** the exact prompt wording and the `max_tokens` value, within the observable rules of T42c2-U5.
2. **Retries and run bounds.** Default: 3 attempts per message; `refused` and `empty_message` terminal at once; `rate_limited` stops the run; 3 consecutive transport failures stop the run; 25 messages per run; 300 seconds per run; each attempt counted before the call. Why: bounded cost, no hammering, and a message that never reads becomes a visible `Could not be read` count rather than a silent retry forever. The daily rate (a few mails a day per household) is far below the per-run cap; a larger backlog drains over days (stated limit on the "within a day" exit criterion).
3. **What is sent.** Default: the subject (at most 300 characters) and the message text (the text part when there is one, else the HTML converted to text), with every URL replaced by `[link]` (tracking links carry tokens and addresses), cut at 20000 characters, nothing else: no header, no address, no attachment. A statement's name and address may still be in the body; the prompt asks for program fields only and nothing but those is kept (§7). Messages with no readable text are `empty_message` and never sent.
4. **What is asked and stored.** Default: the field set above. The program name is asked only to cross-check the allowlisted program (a mail from a shared sender domain that names another program queues); it is reduced to `program_check` and not stored. The suffix is stored as at most 4 characters, shown masked; matching uses the stored full number inside SQL and the full number never enters the payload. Why 4: the existing mask shows at most 4; more would store a larger fragment of a number for no gain, because an ambiguous suffix queues.
5. **Retention of extracted rows.** Default: **400 days by `received_on`** (strictly older is deleted), pending items included, the not-mine list never. Why: the raw mail goes at 30 days; the extracted fields (enums, dates, decimal text, a 3 or 4 character suffix) hold no body, name or address, and expiry warnings can lie a year ahead for 42g. 400 covers a full yearly cycle with slack and bounds the table.
6. **The jump threshold.** Default: strictly more than 50 percent of the stored balance, either direction, by cross-multiplication in exact integers; no baseline (no reading, or a stored zero and a non-zero candidate) queues. Why: redemptions legitimately drop a balance, but a human tap for a large move is cheap and a spoofed mail moving a balance silently is not; a first reading has nothing to compare with.
7. **A stale reading is resolved, not queued.** Default: when the as-of is not strictly newer than the current reading's, the message is `stale`, resolved silently, with no observation and no queue item. This narrows ITEM.md's "anything that fails a rule lands in the queue" for this one rule. Why: applying a stale reading cannot change the current balance (it would only add history), a re-forwarded statement or a second mail with the same date would flood the queue with items whose apply does nothing visible, and the stale count is still reported. The typed path remains the way to enter a historical reading.
8. **No as-of.** Default: no as-of date means queue (`no_as_of`); a person applying it dates it by the day it was received, shown as such. Why: a received date is not an as-of (a re-forward would roll a balance back), but a human can decide.
9. **Unit missing.** Default: a balance without a recognised unit is discarded to no balance. Why: the unit belongs to the balance (P8-42a) and a guessed unit can turn miles into points.
10. **Triggers.** Default: the daily job runs `runLoyaltyReadDaily` immediately after `runLoyaltyInboxDaily` and before the digest; a new write route `POST /api/v1/loyalty/inbox/read` reads on demand; the page's `Check inbox now` handler sends the poll and then the read (so one tap does both, as the ITEM asks), and `Read stored mail now` and `Try failed mail again` exist for the cases where no poll is wanted. Why a separate route: the poll route and its response schema stay exactly as 42c1 froze them.
11. **Queue action route.** Default: `POST /api/v1/loyalty/inbox/readings/[id]` with `{ action }`, status codes as in the contract, `ITEM_RESOLVED` for a repeat. Why one route: three actions on one resource, one auth path.
12. **Not mine.** Default: records (program, suffix) and resolves other pending `unmatched_suffix` items of the same pair; it suppresses a future item only while no membership matches the suffix. Why: it is the household's statement that a suffix is not theirs, but a membership added later is the stronger fact.
13. **Coverage.** Default: from the newest successfully read row of each program that has a sender domain: `yes` if it has a balance (whatever happened to it afterwards), `no` if it has none, `not_read` if nothing was read. Why: the roadmap's coverage question is "does this program's statement carry a balance", independent of whether it applied.
14. **Expiry warnings and instruments.** Default: stored in the reads row as bounded enum, date and decimal-text arrays; shown on the membership line only from rows that passed the program check and the unique suffix match (resolved or stale or no-balance, never pending); no `loyalty_instruments` row is created and no rule is evaluated. Why: the ITEM asks for storage for 42g and display only; creating instruments is a decision for 42g.
15. **Gift-surface classes.** Default: both new routes `no-transaction-data` (inbox tables, observations and the Anthropic call; no ledger row; their responses are counts and a state). `app/travel/page.tsx` and `app/api/v1/loyalty/route.ts` stay `numeric-only` (their classes do not change; the new panel adds no ledger text). Exactly two registry lines are added and none changes (command 12); H15 is the proof over HTTP.
16. **Where fixtures live.** Default: one fabricated directory pinned by hash, loaded by the tests and the surface script, written by the orchestrator. Why: the expected figures, the suffix collisions and the boundary cases are exactly what an implementer could shape its code to.
17. **Prompt-injection posture and residual risk.** Default: mail is attacker-controlled (anyone can mail the inbox and spoof an allowlisted From; 42c1 stated it). Layers: (a) the prompt states that the mail is data and its instructions are never followed, and keeps the mail in the user part only; (b) the output is a closed schema whose every field is an enum, date, bounded decimal text or a 3 or 4 character suffix, so there is nowhere to carry an instruction onward; (c) a read can only **propose**: the only path to a balance is the deterministic rule list, which no model output can reorder; (d) an unmatched or ambiguous suffix, a different program, a changed unit, a future or missing date, a stale date, no baseline and a large jump all queue or are discarded; (e) per-run and per-message bounds limit cost. **Residual risk, stated plainly:** a spoofed mail from an allowlisted sender domain that carries a suffix matching exactly one real membership of that program, a newer as-of date, the stored unit and a balance within 50 percent of the stored one **will be applied automatically**, and repeated mails with increasing dates can drift a balance step by step (there is no cumulative guard, and no undo UI; a typed reading corrects it). Anyone who can mail the inbox can also fill the queue with unmatched-suffix items (bounded by the per-run cap, cleared by one `Not mine` tap per suffix) and cause Anthropic calls up to that cap per day. The suffix is an attacker-guessable value of 3 or 4 characters, so the match is a consistency check, not authentication. Mitigations are out of scope here (sender authentication, DKIM or SPF, in 42c1's stated non-goals).
18. **Re-read.** Default: an automatic re-read never happens, on a timer or otherwise. The only explicit re-read is `retryFailed` (failed rows whose bytes still exist). Re-reading a successfully read message is done by deleting its reads row in SQL (an operator action, not a feature); it is documented in Rollback. Why: "each message is read once" is the cost and idempotency guarantee.
19. **42c1 NITS.** N1 (an address edit racing a poll) and N2 (re-downloading mail with no Message-ID) are **not** folded in; they stay follow-up tasks.
20. **42c1 landing.** Default: the orchestrator commits 42c1 before G0 freezes this spec (T13), so that every merge-base guard here measures only this task. A baseline snapshot commit is an acceptable alternative; the spec's guards do not care which.
21. **Environment.** Default: no new secret. The only new variable is the optional `LOYALTY_READ_TIMEOUT_SECONDS` (whole number 1 to 600, anything else meaning 60), read at call time. The key is the existing `ANTHROPIC_API_KEY`, read only in `loyaltyReader.ts`; it never appears in a payload, a log, a state row or a page (only the boolean `readable`).

## Rollback
1. Revert the code (one commit): `git revert` the task's commit(s); the scheduler line, the two routes, the components, the contract additions, the store addition and the registry lines go together.
2. Before dropping data, back up what a `down` loses, outside the repository and with no figure printed: `psql "$DATABASE_URL" -c "\copy loyalty_inbox_reads TO '<a path outside the repo>/loyalty_inbox_reads.csv' CSV HEADER"`, the same for `loyalty_inbox_not_mine`, and for the observations the read wrote: `\copy (SELECT * FROM loyalty_observations WHERE source = 'email') TO '<path>/loyalty_observations_email.csv' CSV HEADER`.
3. `npm run migrate:down` once: it drops `loyalty_inbox_reads`, `loyalty_inbox_not_mine` and `loyalty_inbox_read_state` and touches nothing else. It is **not lossless** for the extracted rows, the not-mine list and the state row (restore from the CSV above if needed). Auto-applied `loyalty_observations` rows (source `email`) **remain**: the table is append-only and the balances they set are real history. To remove them the owner must decide, from the CSV, and do so by hand; this task writes no such script.
4. To make one successfully read message readable again without a rollback (OQ18): delete its `loyalty_inbox_reads` row by SQL, after checking it is not `applied` or `applied_by_hand` (deleting an applied row would not remove its observation and the re-read would then be `stale`).
5. Then `npm run migrate:up` again is clean: the migration is forward-only and reversible (up, down, up).

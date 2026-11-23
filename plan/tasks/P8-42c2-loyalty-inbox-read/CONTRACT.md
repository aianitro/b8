# CONTRACT — P8-42c2-loyalty-inbox-read
**Author:** contract-guardian
**Lease:** opened by the orchestrator for G1 · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1793100000000_loyalty_inbox_read.sql` (new) | Creates exactly three tables with exactly the columns SPEC.md "Contracts touched" names. `loyalty_inbox_reads`: `id` SERIAL; `dedupe_key` TEXT NOT NULL UNIQUE, CHECK 64 lower-case hex, deliberately no FK; `program_id` NOT NULL FK `loyalty_programs(id)` no action; `received_on` DATE NOT NULL; `state` (ten values); `attempts` SMALLINT NOT NULL 0 to 3; `last_error_code` (six codes); `reason` (nine reasons); `suffix` `^[A-Z0-9]{3,4}$`; `balance` NUMERIC, non-negative, below 1e12, per-unit scale as `loyalty_observations`; `unit` (four units); `as_of` DATE; `program_check` (`match`, `mismatch`, `not_stated`); `membership_id` FK no action; `observation_id` FK no action; `expiry_warnings` and `instruments` JSONB NOT NULL DEFAULT `'[]'`, each with an element-shape CHECK (at most 5 and 10); `read_on`, `resolved_on` DATE. Twenty-two named table CHECKs (see Rationale). Four plain or partial indexes. `loyalty_inbox_not_mine`: `id`, `program_id` NOT NULL FK no action, `suffix` NOT NULL same shape, `added_on` DATE NOT NULL DEFAULT CURRENT_DATE, UNIQUE (`program_id`, `suffix`). `loyalty_inbox_read_state`: `id` SMALLINT PK CHECK `= 1`, `last_read_on`, `last_outcome` (`ok`/`error`), `last_error_code` (four run codes), the two 42c1-style consistency CHECKs; one row seeded. Down drops the three tables and nothing else. No existing table is altered (`loyalty_observations` already allows `email`; `loyalty_instruments` unchanged). | additive |
| `db/schema.sql` | Mirrors the migration: three `CREATE TABLE` blocks with identical constraints and the four indexes, appended after `loyalty_inbox_state` under a section header. The state-row seed is the migration's alone, as in 42c1. | additive |
| `packages/contracts/loyalty.ts` | Header lists fourteen endpoints. The thirteen `LOYALTY_READ_*` constants in the spec's order (3, 25, 400, 50, 3, 4, 50, 20000, 60, 300, 3, 5, 10). Vocabularies `LOYALTY_READ_STATES`, `_REASONS`, `_ERROR_CODES`, `_RUN_ERROR_CODES`, `_OUTCOMES`, `_ACTIONS`, `_EXPIRY_KINDS`, `_PROGRAM_CHECKS`, `_COVERAGE`, each with its `z.enum` (`LoyaltyRead*Schema`). `LoyaltyErrorCodeSchema` gains `ITEM_RESOLVED`. Requests: `LoyaltyInboxReadRequestSchema` (strict, optional `retryFailed`), `LoyaltyInboxResolveRequestSchema` (discriminated on `action`, strict per branch, `membershipId` only on `apply`). Responses: `LoyaltyReadMaskedSuffixSchema`, `LoyaltyReadExpiryWarningSchema`, `LoyaltyReadInstrumentSchema`, `LoyaltyReadItemSchema`, `LoyaltyReadCoverageEntrySchema`, `LoyaltyReadFromMailSchema`, `LoyaltyReadLastReadSchema`, `LoyaltyInboxReadPanelSchema` (the `inboxRead` object), `LoyaltyInboxReadRunSchema`, `LoyaltyInboxResolveSchema`, and exactly two new `*ResponseSchema`: `LoyaltyInboxReadResponseSchema`, `LoyaltyInboxResolveResponseSchema` (seven become nine). `LoyaltyOverviewSchema` gains the required key `inboxRead`. Inferred types for each. `inbox`, `LoyaltyInboxPollResponseSchema` and every membership schema unchanged. | additive |

`packages/contracts/loyalty.test.ts` is not touched by the guardian: `T42c2-U1` and the allowed edits (SPEC.md "Existing state this task changes" items 1 to 3) are the implementer's.

## Rationale

**A reading is a proposal, and the schema keeps it one.** The current balance is still only the newest `loyalty_observations` row by the existing reduction. `loyalty_inbox_reads.balance` is the proposed figure, never a "current" column; the only path from it to a balance is an appended `email` observation linked by `observation_id`. Nothing here is derived state that can go stale: coverage, `waiting`, `failed`, the queue and `fromMail` are all reads over these rows.

**The reads row outlives the mail, so its key is not a foreign key.** The raw message is purged at thirty days, the reads row at four hundred. `dedupe_key` is the 42c1 key with its own UNIQUE (one reading per message; a lost race is 23505), and `program_id` and `received_on` are copied so the row stands alone.

**Contradictory rows are unstorable.** The CHECKs encode the state table, not just the enums:
- `balance` and `unit` null together; per-unit scale as observations (scale 0 whole, exactly 2 usd), so `balance::text` is the canonical emitted text and an apply copies it unchanged.
- `retry` 1 or 2 attempts, `failed` at least 1; `last_error_code` set exactly for `retry` and `failed`; those two states hold nothing extracted (no suffix, balance, date, check, read date, membership, observation, and empty arrays).
- Every other state has `program_check` and `read_on`; `resolved_on` null exactly for `retry`, `failed`, `pending`, and not before `read_on`.
- `reason` set exactly for `pending` and the three states a person resolves it into (`applied_by_hand`, `not_mine`, `ignored`). Keeping the reason on resolution keeps "was this a queue item, and why" answerable; it also makes `ITEM_RESOLVED` checkable from the row.
- `balance` null exactly for `retry`, `failed`, `no_balance` (decision rule 1 comes first, so nothing queued, stale, applied or discarded lacks one).
- `observation_id` set exactly for `applied` and `applied_by_hand`, which also need `membership_id`.
- Decision order as one row can show it: `applied` and `stale` had a suffix and an as-of; `not_mine_known` has a suffix and no membership; a `mismatch` with a balance is always reason `program_mismatch` and that reason always means `mismatch`; a balance-less mismatch decorates no membership; `no_suffix` has no suffix and every later suffix-based reason has one; `no_as_of` has no date, `as_of_future`, `no_baseline`, `implausible_jump` have one; while `pending`, the three suffix reasons have no membership and rules 4 to 8 have exactly one.

**No in-flight state, by design of the spec's enum.** The attempt is counted before the model call, and every legal state needs either an error code or a reading. The pipeline therefore writes the attempt pessimistically, as the outcome a crash would leave: `retry` (or `failed` on the third attempt) with the provisional code `api_error`, overwritten by the real outcome. This matches the fixture (`throw-counts-attempt` expects `api_error`) and needs no extra state. See defect 1.

**JSONB arrays are shape-checked in SQL.** `jsonb_path_exists` (immutable) refuses a non-array, too many elements, a non-object element (strict mode, so a nested array cannot be unwrapped into a pass), any key outside the fixed set, a kind outside the enum, a non-`YYYY-MM-DD` date, and an amount that is not null or canonical decimal text in the scale of `what` (`status`/`other` always null). So no free text can sit in either array even from a hand-written insert. Calendar validity of the date is the clean pass's (a CHECK cannot use the clock-free validator).

**FK `observation_id` with no action protects provenance.** An observation a reading appended cannot be deleted while its reads row stands. Command 5's `DELETE FROM loyalty_observations …` refusal is satisfied by this FK (the accepted `applied` row references the observation), with no rule on observations; after the `down` the delete is no longer blocked and the observation survives, as command 5 expects.

**State row mirrors 42c1.** One row, id 1; date and outcome null together; code set exactly for `error`, from the four run codes.

**Contract refinements.** Strict objects at every depth. `maskedSuffix` is the existing masked form further restricted to four bullets plus 3 or 4 of `[A-Z0-9]`. Item: balance canonical for its unit; `no_suffix` has no suffix, suffix-based reasons have one, `no_as_of` has no date; no suffix means no candidates; candidates ascending without repeat. Panel: listed items not above the total, list ordered newest `receivedOn` then id descending, no program twice in `coverage`, no membership twice in `fromMail`. `fromMail` entries never have both arrays empty; expiry amounts follow the same scale rule as the CHECK. Run: `read` equals the five-part sum; `errorCode` set exactly for `error`; `disabled` and `already_running` have all eight counts zero. Resolve state is one of the three human outcomes.

**Refinements deliberately not added.** `needsAttention.length` is not forced to equal `min(total, limit)` (two queries can race; at most is the safe bound, as for 42c1's unknown senders). `coverage` is not cross-checked against `inbox.senderDomains` (it would need an overview-level refinement over two siblings; the producer owns it and T42c2-I11 asserts it). `candidateMembershipIds` is not tied to the reason (memberships may change after the read).

## Fields

### `LoyaltyOverviewSchema.inboxRead` (`LoyaltyInboxReadPanelSchema`, response of `GET /api/v1/loyalty`)
| Field | Type | Meaning |
|---|---|---|
| `readable` | boolean | `ANTHROPIC_API_KEY` set and non-blank. Never the key. |
| `lastRead` | `{on, outcome, errorCode}` or null | Null = never read. `errorCode` a run code exactly when `error`. |
| `waiting` | count | Retained stored messages with bytes, unread or `retry`. |
| `failed` | count | Retained reads rows in `failed`. |
| `needsAttentionTotal` | count | All `pending` rows. |
| `needsAttention[]` | item, at most 50 | `{id, programId, maskedSuffix, balance, unit, asOf, receivedOn, reason, candidateMembershipIds}`, newest `receivedOn` then id descending. |
| `coverage[]` | `{programId, balanceInLastStatement}` | Each program with a sender domain; `yes`/`no`/`not_read` from the newest row not `retry`/`failed`. |
| `fromMail[]` | `{membershipId, receivedOn, expiryWarnings, instruments}` | Newest qualifying row per membership (states `applied`, `applied_by_hand`, `stale`, `no_balance`), arrays not both empty. |

### `LoyaltyInboxReadRunSchema` (response of `POST /api/v1/loyalty/inbox/read`, 200 for every outcome)
`outcome`, `read`, `applied`, `queued`, `stale`, `noBalance`, `discarded` (`not_mine_known`), `failed`, `remaining`, `errorCode`. Sum and zero-count rules above.

### `LoyaltyInboxResolveRequestSchema` / `LoyaltyInboxResolveSchema` (`POST /api/v1/loyalty/inbox/readings/[id]`)
Request `{action:'apply', membershipId?}` · `{action:'not_mine'}` · `{action:'ignore'}`. Response `{id, state}` with state `applied_by_hand`, `not_mine` or `ignored`. 409 `ITEM_RESOLVED` for a row not `pending`.

## Domain invariants preserved
- **Derived, not stored.** No current or latest column. Coverage, counts, queue and `fromMail` are reads.
- **Money.** `balance` is NUMERIC with the observations' per-unit scale; no float; emitted as `::text`.
- **Null semantics.** Null balance = no usable balance (never zero); null `as_of` = no date; null suffix = too little shown; `lastRead` null = never read; `not_read` is never `no`.
- **Inheritance.** None. `membership_id` NULL means no single membership, not "inherit".
- **Ledger.** No ledger table referenced. FKs point at `loyalty_programs`, `loyalty_memberships`, `loyalty_observations` only.
- **One definition.** Canonical balance text reuses `LoyaltyWholeBalanceSchema` / `LoyaltyUsdBalanceSchema`; the masked suffix reuses `LoyaltyMaskedMemberNumberSchema`; dates reuse `giftDate`; instrument kinds reuse `LoyaltyInstrumentKindSchema`; each vocabulary equals its CHECK.

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Not run by the guardian (no shell). Orchestrator runs commands 5 and 6 against `b8_p42a_throwaway` at G1; expected `OK migration up-down-up` and `OK schema`. I checked by reading: the six accepted reads rows (lines 290 to 295) pass every CHECK; each of the 28 refused heredoc rows, the three JSONB rows, the not-mine, state-row and observation-delete refusals each fail at least one constraint. The jsonpath CHECKs were not executed; a syntax slip would fail `migrate:up` loudly, not silently.

**The down is not lossless** for reads rows, not-mine records and the state row. Back up first (also in the migration header and SPEC.md Rollback), to a path outside the repo, printing nothing:
```
\copy loyalty_inbox_reads TO '<path outside the repo>/loyalty_inbox_reads.csv' CSV HEADER
\copy loyalty_inbox_not_mine TO '<path outside the repo>/loyalty_inbox_not_mine.csv' CSV HEADER
\copy (SELECT * FROM loyalty_observations WHERE source = 'email') TO '<path outside the repo>/loyalty_observations_email.csv' CSV HEADER
```
`email` observations remain after the down.

## Spec defects raised (for the orchestrator, not absorbed silently)
1. **No in-flight state for the pre-call attempt count.** Step 4 counts the attempt before the call, but every state in the fixed enum needs an error code (`retry`/`failed`) or a reading. The contract resolves it without a new state (pessimistic write, provisional `api_error`, see Rationale). If the orchestrator wants a distinct crash code, the enum must change, which this spec froze.
2. **Command 5 accepts a `stale` row with `membership_id` NULL (line 292).** Rule 6 needs a matched membership's stored reading, so a real `stale` row always has one. Because the spec's own check inserts it, the schema does not require it. Stated looseness, not a bug.
3. **Command 5 line 338 and its note.** The note says the observation delete is refused "only if the guardian adds a rule". No rule was added: the `observation_id` FK from the accepted `applied` row refuses it. The line passes as written; no G1 amendment needed.
4. **`attempts` 0 to 3 versus reality.** Every row is created by a counted attempt, so 0 never occurs. The column keeps the spec's 0 to 3 range; only `retry` and `failed` are tightened as the spec says.
5. **(Minor) Coverage wording.** "a queued … row still carries or lacks a balance": a queued row always carries one (rule 1 first), and the schema enforces that. Coverage semantics are unaffected.

## Backfill / data correction required
- None. Three new tables; one seeded state row; no existing row altered.

## Consumers that must change (implementer)
- `apps/web/lib/loyaltyStore.ts`: `loadOverview` builds `inboxRead` (counts and dates in SQL, `::text`, `balance::text`, masked suffix `'••••' || suffix`, candidates by an `EXISTS`-style ends-with match on the stored number inside SQL, never selecting the number).
- `apps/web/lib/loyaltyInboxRead.ts`: writes rows that satisfy the CHECKs: pessimistic attempt write; outcome overwrite clears `last_error_code`; keep `reason` on resolution; apply sets `state`, `membership_id`, `observation_id`, `resolved_on` in the observation's transaction; `INSERT … ON CONFLICT (program_id, suffix) DO NOTHING` for not-mine. A 23514 from a pipeline write is a bug to surface as `store_failed`, never echoed.
- `apps/web/app/api/v1/loyalty/inbox/read/route.ts`, `…/readings/[id]/route.ts` (new); `loyaltyResponses.ts` for `ITEM_RESOLVED` → 409.
- Overview fixtures in `packages/contracts/loyalty.test.ts` (items 1 to 3) and every other `LoyaltyOverview` producer `tsc` reports.

## Consumers checked
- `tsc` not run (no shell). Expected to fail until every overview producer and fixture adds `inboxRead` (required key).
- New exports are `Loyalty`/`LOYALTY_` prefixed; no new import (still `zod`, `./envelope`, `./auth`, `./gifts`). Exactly two new `*ResponseSchema`; no new key named `memberNumber`.
- Memberships, observations, instruments, earn rules, the 42c1 tables, the ledger: no table, column, constraint or schema changed.

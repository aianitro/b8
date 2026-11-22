# CONTRACT — P8-42c1-loyalty-inbox
**Author:** contract-guardian
**Lease:** opened by the orchestrator for G1 · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/1793000000000_loyalty_inbox.sql` (new) | Creates exactly five tables with exactly the columns SPEC.md "Contracts touched" names. `loyalty_sender_domains` (`id`, `program_id` NOT NULL FK `loyalty_programs(id)` ON DELETE CASCADE, `domain` TEXT NOT NULL UNIQUE with a lower-case hostname CHECK whose final label is 2 to 24 letters or `xn--`, `last_seen_on` DATE). `household_member_addresses` (`id`, `member_id` NOT NULL FK `household_members(id)` ON DELETE CASCADE, `address` TEXT NOT NULL UNIQUE with a lower-case addr-spec CHECK, `added_on` DATE NOT NULL DEFAULT CURRENT_DATE, `last_received_on` DATE). `loyalty_inbox_messages` (`id`, `dedupe_key` TEXT NOT NULL UNIQUE CHECK 64 lower-case hex, `received_on` DATE NOT NULL, `stored_on` DATE NOT NULL DEFAULT CURRENT_DATE, `program_id` NOT NULL FK no action, `sender_domain` TEXT NOT NULL hostname CHECK, `origin` CHECK `direct`/`attachment`/`inline`, `attribution` CHECK `matched`/`unmatched`/`none_found`/`ambiguous`, `member_id` nullable FK no action, `raw_mail` BYTEA, `oversize` BOOLEAN NOT NULL DEFAULT FALSE, CHECK matched iff member set, CHECK bytes null iff oversize). `loyalty_inbox_unknown_senders` (`dedupe_key` TEXT PRIMARY KEY 64 hex, `received_on` DATE NOT NULL, `domain` TEXT NOT NULL hostname or exactly `(unreadable)`). `loyalty_inbox_state` (`id` SMALLINT PRIMARY KEY CHECK `= 1`, `last_polled_on` DATE, `last_outcome` CHECK null/`ok`/`error`, `last_error_code` TEXT CHECK null or one of the six poll error codes, plus two consistency CHECKs); one row (id 1) seeded. Five plain indexes (FK and purge lookups). Seeds the sender domains of SPEC.md amendment A1, with one deviation (see "Spec defect raised"). A real Down Migration that drops the five tables and nothing else. | additive |
| `db/schema.sql` | Mirrors the migration: five `CREATE TABLE` blocks and their indexes, appended after `loyalty_instruments`, with a section header comment. The seeds are the migration's alone, as for the catalog. | additive |
| `packages/contracts/loyalty.ts` | New constants `LOYALTY_INBOX_RETENTION_DAYS` (30), `LOYALTY_INBOX_SILENCE_DAYS` (45), `LOYALTY_INBOX_MAX_BYTES` (5242880), `LOYALTY_INBOX_MAX_DOMAINS` (20), `LOYALTY_INBOX_MAX_ADDRESSES` (10), `LOYALTY_INBOX_UNKNOWN_LIMIT` (20), `LOYALTY_INBOX_UNREADABLE`, and the vocabularies `LOYALTY_INBOX_ORIGINS`, `LOYALTY_INBOX_ATTRIBUTIONS`, `LOYALTY_INBOX_POLL_ERROR_CODES`, `LOYALTY_INBOX_POLL_OUTCOMES`, `LOYALTY_INBOX_CONFIG_PROBLEMS`, `LOYALTY_INBOX_REQUIRED_ENV`, `LOYALTY_INBOX_FORWARDING_STATES`, `LOYALTY_INBOX_SHARED_MAIL_PROVIDERS`, `LOYALTY_INBOX_SHARED_SUFFIXES`, each with its `z.enum` schema where it is a vocabulary. Pure helpers `normaliseLoyaltyInboxEntry`, `isLoyaltyHostname`, `isLoyaltySenderDomain`, `isLoyaltyForwardingAddress`. Input schemas `LoyaltySenderDomainInputSchema`, `LoyaltyForwardingAddressInputSchema`. `LoyaltyProgramPatchRequestSchema` gains optional `senderDomains`; `LoyaltyMemberPatchRequestSchema` gains optional `forwardingAddresses`. New `LoyaltyInboxLastCheckSchema`, `LoyaltyInboxSenderDomainsSchema`, `LoyaltyInboxCoverageSchema`, `LoyaltyInboxForwardingSchema`, `LoyaltyInboxUnknownSenderSchema`, `LoyaltyInboxSchema`, `LoyaltyInboxPollSchema`, and exactly one new `*ResponseSchema`, `LoyaltyInboxPollResponseSchema` (T42a-U7 now counts seven). `LoyaltyOverviewSchema` gains the required key `inbox`. `LoyaltyErrorCodeSchema` gains `DOMAIN_TAKEN` and `ADDRESS_TAKEN`. Inferred types for each. `LoyaltyProgramSchema`, `LoyaltyMemberSchema` and every membership schema are unchanged. | additive |

`packages/contracts/loyalty.test.ts` is not touched by the guardian. `T42c1-U1` and the four allowed edits (SPEC.md "Existing state this task changes" items 1 to 3) are the implementer's. `.env.local.example`, `apps/web/package.json` and the lockfile are also the implementer's (not contract surface for this role).

## Rationale

**Five tables, two kinds.** `loyalty_sender_domains` and `household_member_addresses` are configuration the owner types; the other three are what the poller records. Keeping the allowlist and the addresses as rows (not JSON on the program or member) gives each entry a CHECKed shape and a UNIQUE across the whole table, so a lost race on an edit is a 23505 the route maps to 409, never a 500, and a domain or address can never belong to two owners (which would make a message's program or person depend on row order).

**Nothing derived from mail is stored.** The message row holds only what attribution and retention need: `sender_domain`, `origin`, `attribution`, `member_id`, `received_on`, the hash, the bytes. 42c2 reads `raw_mail` to extract; a stored subject, snippet or extracted figure would be a second answer that goes stale and a privacy surface. Command 6's forbidden-name scan passes by construction.

**The two "last" dates are the deliberate exception, and they are observations, not caches.** `last_seen_on` and `last_received_on` record that mail arrived on a date. Once the 30-day purge deletes the mail, they cannot be re-derived, and forwarding health and coverage must outlive the mail, or every quiet forwarder would read as "never". They are monotone (greatest of old and new), so an older message stored later never moves them back: the observations lesson. They are not "current value" columns over data that still exists.

**Dedupe key hashed, shared across two tables.** Hashing keeps Message-ID text (which can embed an address) out of the database. A key in either table is a duplicate. A CHECK cannot see another table, so cross-table uniqueness is the poller's check; within each table it is the constraint, and a store that loses a race is `ON CONFLICT DO NOTHING`.

**The CHECKs are the floor, the contract is the gate.** The database refuses what can never be valid: upper case, spaces, `@` in a domain, a single label, leading, trailing or doubled dots, a hyphen at a label edge, overlength, a non-hex key, a contradictory attribution or oversize row. The provider and shared-suffix refusals are data in `packages/contracts/loyalty.ts`, not CHECKs, because they are a curated list the spec calls a stated limit; a hand-written SQL insert of `gmail.com` is possible and would be an owner act.

**The allowlist CHECK is stricter than the other hostname CHECKs.** `loyalty_sender_domains` also requires a final label of 2 to 24 letters or `xn--` (the spec's editor rule), so an IP literal or a numeric final label can never be trusted even by hand-written SQL. `sender_domain` and the unknown `domain` use the plain hostname shape, because they record what a sender used, not what the owner trusted.

**`loyalty_inbox_state` cannot hold a contradiction.** One row, id 1. `last_polled_on` and `last_outcome` are null together; `last_error_code` is set exactly when the outcome is `error`, and only to one of the six codes. So `lastCheck` is either null or a well-formed object, read straight from the row.

**Program and member FKs on messages have no delete action.** Mail is evidence; a cascade would drop it silently. The configuration tables cascade from their owner, like the aliases, because an allowlist entry or address means nothing without it (and no route deletes a program or member).

**Seed by name, skip when absent.** The catalog seed of `1792700000000` failed loudly on a misspelt name because it created the names it referenced. This seed runs against a live catalog the owner may already have renamed, so a missing name is skipped with a `RAISE NOTICE` count rather than failing the deploy. On the throwaway and any fresh database every name resolves, and command 5's "every catalog program has a domain" assertion is the typo guard. Names resolve to the lowest id with that name, since `loyalty_programs.name` has no UNIQUE.

**Normalisation is ASCII-gated.** `normaliseLoyaltyInboxEntry` trims, then lower-cases only printable-ASCII text. Some non-ASCII characters lower-case into ASCII ones (the Kelvin sign becomes `k`), which would turn a look-alike into a valid entry; leaving non-ASCII text alone lets the shape test refuse it.

**One home for the rules.** `lib/domain/loyaltyInbox.ts` is the spec's seam for "domain/address validation". It must import `isLoyaltySenderDomain`, `isLoyaltyHostname`, `isLoyaltyForwardingAddress` and `normaliseLoyaltyInboxEntry` from here, not restate them. The match rule (equal or dot-suffix, longest wins) and MIME parsing stay in the domain module: they are behaviour, not shape.

**Response refinements.** Strict objects throughout. `configured` exactly when `problem` is null; `missing` has all five names for `unset`, one to four for `incomplete`, none otherwise, no repeats, names from the fixed list only. `lastCheck.errorCode` set exactly when `outcome` is `error`. Forwarding: `not_set_up` exactly when there is no address, `quietDays` null exactly for `not_set_up`, `no_mail_yet` and `not_set_up` carry no received date, `ok` carries one, and `quiet` exactly when `quietDays` is above `LOYALTY_INBOX_SILENCE_DAYS`. Coverage covers exactly the programs listed in `senderDomains`. The listed unknown counts do not exceed the total. Poll: `errorCode` set exactly when `outcome` is `error`; `disabled` and `already_running` have six zero counts. All counts are non-negative integers; a listed unknown count is at least one.

**Refinements deliberately not added.** No sum rule ties `fetched` to the other counts: the spec leaves open whether an oversize message also counts as `stored` (the field doc says it does, which is consistent with the totals in SPEC.md, but I2 does not pin it), and an `error` outcome may stop part-way. No refinement on `retentionDays`/`silenceDays` beyond the literal constants.

## Fields

### `LoyaltyProgramPatchRequestSchema` (request, `PATCH /api/v1/loyalty/programs/[id]`)
| Field | Type | Meaning |
|---|---|---|
| `senderDomains` | optional; array of 0 to 20 strings | The COMPLETE new allowlist; `[]` clears. Each passes `isLoyaltySenderDomain` after `normaliseLoyaltyInboxEntry`; no repeat once normalised. Replaced in one transaction; a domain another program holds is 409 `DOMAIN_TAKEN`, old list unchanged. A domain that stays keeps its `last_seen_on`. Never echoed in an error. |

### `LoyaltyMemberPatchRequestSchema` (request, `PATCH /api/v1/loyalty/members/[id]`)
| Field | Type | Meaning |
|---|---|---|
| `forwardingAddresses` | optional; array of 0 to 10 strings | The COMPLETE new list; `[]` clears. Each passes `isLoyaltyForwardingAddress` after normalisation; no repeat. An address another member holds is 409 `ADDRESS_TAKEN`, nothing changes. An address that stays keeps `added_on` and `last_received_on`. Then retained not-yet-matched messages are re-attributed; matched ones never change. |

Both bodies stay strict and still refuse `{}`. Neither response echoes the list.

### `LoyaltyOverviewSchema.inbox` (`LoyaltyInboxSchema`, response of `GET /api/v1/loyalty`)
| Field | Type | Meaning |
|---|---|---|
| `configured` | boolean | True exactly when `problem` is null. |
| `problem` | null · `unset` · `incomplete` · `invalid_tls` · `invalid_port` · `invalid_timeout` | From the password-free `describeInboxConfig`. |
| `missing` | array of required env NAMES | All five for `unset`, one to four for `incomplete`, empty otherwise. Order host, port, TLS, user, password. Never a value. |
| `retentionDays` | literal 30 | `LOYALTY_INBOX_RETENTION_DAYS`. |
| `silenceDays` | literal 45 | `LOYALTY_INBOX_SILENCE_DAYS`. |
| `lastCheck` | `{on, outcome, errorCode}` or null | Null = never polled. `on` a Postgres date; `outcome` `ok`/`error`; `errorCode` a poll error code exactly when `error`. |
| `senderDomains[]` | `{programId, domains}` | Programs with at least one domain; `domains` 1 to 20 hostnames, ascending. |
| `coverage[]` | `{programId, lastSeenOn, storedInWindow}` | Same programs. `lastSeenOn` date or null (no mail seen yet). `storedInWindow` count of retained messages with `received_on >= CURRENT_DATE - 30`. |
| `forwarding[]` | `{memberId, addresses, state, lastReceivedOn, quietDays}` | One per member. `state` per Conventions. `quietDays` whole days, null exactly for `not_set_up`, never negative. |
| `unknownSenders[]` | `{domain, count}` | Retained unknown rows by domain (hostname or `(unreadable)`), count desc then domain asc, at most 20, count at least one. |
| `unknownSenderTotal` | count | All retained unknown rows. |
| `unattributed` | count | Retained kept messages not `matched`. |

### `LoyaltyInboxPollResponseSchema` (response, `POST /api/v1/loyalty/inbox/poll`, HTTP 200 for every outcome)
| Field | Type | Meaning |
|---|---|---|
| `outcome` | `ok` · `disabled` · `already_running` · `error` | |
| `fetched` | count | Envelopes listed in the window. |
| `stored` | count | New messages kept, an oversize one included. |
| `duplicates` | count | Envelopes whose key was already known. |
| `unknown` | count | New unknown-sender rows. |
| `expired` | count | Envelopes older than the window, dropped. |
| `oversize` | count | New messages recorded without bytes. |
| `errorCode` | poll error code or null | Set exactly when `outcome` is `error`. |

## Domain invariants preserved
- **Derived, not stored.** Health states, quiet days, coverage counts and unknown totals are computed on every read. The only stored dates are monotone observations that outlive the mail (see Rationale).
- **Money.** None. No money column, no figure, no float; every emitted number is a whole count or whole days from Postgres.
- **Null semantics.** `last_seen_on`, `last_received_on`, `lastCheck`, `lastSeenOn` NULL mean "not observed yet", never a zero or an epoch date. `quietDays` null only for `not_set_up`.
- **Inheritance.** None. `loyalty_inbox_messages.member_id` NULL means "attributed to nobody", not "inherit"; the comments say so.
- **Ledger.** No ledger table is referenced, altered or read. The only FKs point at `loyalty_programs` and `household_members`.
- **One definition.** The date validator is the existing `giftDate`; each bound is one constant; each vocabulary equals its CHECK; the domain and address rules live only here.

## Migration
```
npm run migrate:up && npm run migrate:down && npm run migrate:up
```
Not run by the guardian: this role has no shell. The orchestrator runs acceptance commands 5 and 6 against `b8_p42a_throwaway` at G1. Expected: `OK migration up-down-up` and `OK schema`. I checked command 5's 33 refusals and its accepted rows against the CHECKs by reading; none was executed.

**The down is not lossless for the configuration.** It discards every sender-domain edit, every forwarding address and the poll state (the seeded domains return with the next up). Stored mail and unknown rows are deliberately not backed up (at most 30 days old; a backup would keep raw mail past retention). Back up first, as the migration header lists:

```
\copy (SELECT p.name, d.domain FROM loyalty_sender_domains d JOIN loyalty_programs p ON p.id = d.program_id ORDER BY d.domain) TO 'backup-loyalty_sender_domains.csv' CSV HEADER
\copy (SELECT m.display_name, a.address, a.added_on, a.last_received_on FROM household_member_addresses a JOIN household_members m ON m.id = a.member_id ORDER BY a.address) TO 'backup-household_member_addresses.csv' CSV HEADER
```

A restore re-runs `migrate:up` and loads both files back by program name and member name. Revert the application code before the down.

## Spec defect raised (for the orchestrator, not absorbed silently)
1. **Amendment A1's seed table violates the spec's own UNIQUE.** `hawaiianairlines.com` is listed under both Atmos Rewards and HawaiianMiles, but `loyalty_sender_domains.domain` is UNIQUE across programs (Contracts touched). Seeding it as written fails the migration with 23505. I applied OQ7's own rule ("a domain two programs share goes to one of them; the owner can move it"): seeded once, for HawaiianMiles, which otherwise has no domain and would fail command 5's "every program has a domain"; Atmos Rewards keeps `alaskaair.com`. The migration header records the deviation. If the orchestrator prefers Atmos Rewards, HawaiianMiles then needs another domain, or command 5 fails.
2. **`quietDays` can go negative under the accepted time-zone skew.** `received_on` is a UTC date while `CURRENT_DATE` follows the session zone (Conventions, "Dates"). On a server west of UTC, mail received in the evening carries tomorrow's date, so `CURRENT_DATE - last_received_on` is -1 for a few hours. The spec requires counts and days to be non-negative and U1 refuses a negative, so an unclamped producer would 500 on `GET /api/v1/loyalty`. The contract keeps `quietDays` non-negative and its doc tells the producer to compute `GREATEST(0, CURRENT_DATE - reference)` in SQL. That is a spec gap, not a workaround in the schema. Please confirm, or amend the spec to allow the day of skew.
3. **(Minor) `stored` versus `oversize`.** The spec does not say whether an oversize message also counts as `stored`. The contract documents that it does (it is a stored row), and adds no sum rule. T42c1-I2 should pin it.

## Backfill / data correction required
- None. All five tables are new. The seeds insert into empty tables. No existing row is altered.

## Consumers that must change (implementer)
`LoyaltyOverviewSchema` gains a required key and `LoyaltyErrorCodeSchema` two values:
- `apps/web/lib/loyaltyStore.ts`: build `inbox` (counts and day differences in SQL, `GREATEST(0, …)` on `quietDays`, `::text` dates, never `raw_mail`); the program PATCH replaces `senderDomains` and the member PATCH `forwardingAddresses` in one transaction each, mapping 23505 on `loyalty_sender_domains_domain_key` to 409 `DOMAIN_TAKEN` and on `household_member_addresses_address_key` to 409 `ADDRESS_TAKEN`. A 23514 from these CHECKs on a body the contract accepted is a handler bug; map it to 400 `INVALID_INPUT`, never a 500, and never echo the input.
- `apps/web/lib/domain/loyaltyInbox.ts`: import the four helpers named in Rationale; do not restate them.
- `apps/web/lib/loyaltyInbox.ts`: the only reader and writer of `raw_mail`; monotone updates as `GREATEST(coalesce(col, new), new)`; store with `ON CONFLICT (dedupe_key) DO NOTHING`; state writes set all three state columns together.
- `apps/web/app/api/v1/loyalty/inbox/poll/route.ts` (new) answers `LoyaltyInboxPollResponseSchema`.
- `apps/web/app/api/v1/loyalty/route.ts`, `members/[id]/route.ts`, `programs/[id]/route.ts`, and `loyaltyResponses.ts` if it maps error codes.
- `apps/web/app/travel/page.tsx` and the `Loyalty*` / `Travel*` components for the panel and the two editors.
- `apps/web/scripts/gifts-surface-check.mjs`: H14.
- Fixtures: `packages/contracts/loyalty.test.ts` lines 125, 135, 222, 408 to 409 per SPEC.md items 1 to 3, and any other overview fixture `tsc` reports.

## Consumers checked
- `npx tsc --noEmit`: not run by the guardian (no shell). Expected to fail until the implementer adds `inbox` to every overview producer and fixture, because the key is required.
- New exports are `Loyalty`- or `LOYALTY_`-prefixed, except the four helpers, which are named in the style of `isBalanceForUnit`; `tsc` should check `export *` from `packages/contracts/index.ts` for a collision. No new import: the file still depends only on `zod`, `./envelope`, `./auth` and `./gifts`.
- Exactly one new `*ResponseSchema`; no new key named `memberNumber`.
- Ledger, net worth, gifts, receipts, `accounts`, `transactions`, memberships, observations, instruments, earn rules: no table, column, constraint or schema changed.

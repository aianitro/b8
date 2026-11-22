# P8-42c1-loyalty-inbox — collect forwarded loyalty mail: poll a dedicated mailbox, keep only allowlisted senders, attribute each message to a person, delete it on schedule, and show forwarding health and coverage on /travel
**Roadmap item:** ROADMAP.md §5 Phase 8 step 42c, first of two tasks (42c1 collects; 42c2 reads). Origin: `plan/tasks/P8-42c1-loyalty-inbox/ITEM.md` (binding) and `plan/LOYALTY-ROADMAP.md` §4 A, §5, §6 (42c and its order note), §7, §8. Predecessors: `plan/tasks/P8-42b2-card-earn-estimate/{SPEC,GATES,NITS}.md`, `plan/tasks/P8-42b-card-annual-instruments/{SPEC,GATES}.md`, `plan/tasks/P8-42a2-loyalty-nits/SPEC.md`, `plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md`. "P8-42b2 #n" means that spec's acceptance command n. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way, or reads stdin.
**Status:** FROZEN (G0 PASS 2026-11-21, amendment A1)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec contains no money-looking figure. It contains counts of things and days (30, 45, 12, 27 and similar) and byte counts, which AGENTS.md allows. Every fixture is fabricated: people are `example.com`, `example.net` or `example.org` addresses, program senders are `.test` domains, and every fixture carries the canary `ZQ42C`. No real mailbox host, address, member number or credential appears anywhere in this task. The fixtures live in one directory pinned by a SHA-256 (command 16).

## Goal
Seven observable changes. Nothing else changes.

1. **A mailbox is polled over IMAP, read-only, on the daily job and on demand.** The connection comes from seven server environment variables (Open question 2). With them unset or incomplete the poller is disabled, `/travel` says so, and the daily job is still green. A poll never modifies the mailbox: it opens it read-only, marks nothing seen, flags, moves and deletes nothing.
2. **Only allowlisted senders are kept.** Each catalog program has sender domains, seeded for the whole existing catalog and editable on `/travel`. A message whose original sender's domain equals or is a subdomain of a program's domain is stored (raw RFC 822 bytes plus a few header-derived columns). Any other message is never downloaded in full and is counted by sender domain only: "mail from unknown senders" with domain and count.
3. **Forwarded mail is traced back to its original sender and recipient.** The rules and their precedence are exact (Conventions). Mail whose sender cannot be read is counted under the sentinel `(unreadable)`, never stored.
4. **Each stored message is attributed to a household member** by matching the recovered original recipient against per-member forwarding addresses, edited on `/travel`. Unattributed mail is kept and flagged. Adding an address later attributes the already-stored, still-unattributed messages it now matches.
5. **Raw mail is kept 30 days by received date, then deleted** by the daily job and after every poll. Nothing derived from the mail body (no subject, sender local part, snippet, recipient, balance, parsed text) is stored. No route, page or log returns or prints a raw body.
6. **Forwarding health per person and coverage per program** are shown on `/travel`: for each member the last mail received through their addresses and a quiet flag after 45 days; for each program the last mail seen (date only) and a count over the retention window.
7. **Gift surfaces are classified and proved.** One new route, `POST /api/v1/loyalty/inbox/poll`, is registered `no-transaction-data`. `/travel` and the four membership-view routes stay `numeric-only`. No ledger row is read or written.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No Claude call, no reading of message content, no extraction** of a balance, expiry, certificate, statement cycle or member number, no auto-apply, no *Needs attention* queue, no "did it carry a balance" (all 42c2). **No dashboard card, digest widget or push** for a quiet forwarder (42g). A quiet flag appears on `/travel` only.
- **Nothing derived from a message is stored except** `sender_domain`, `origin`, `attribution`, the member id, `received_on`, the dedupe hash and the raw bytes. No subject, no sender local part or full address, no recipient address, no snippet, no parsed text, no attachment content, no message size history.
- **The mailbox is never modified.** No `\Seen`, no flag, no copy, move, delete, append, expunge, folder create, IDLE or long-lived connection. No SMTP send. No Gmail OAuth (rejected, LOYALTY-ROADMAP §4 A).
- **No sender authentication.** No DKIM, SPF or DMARC verification: `From` is unauthenticated, as it is for the mailbox's own filters. This is a stated limit; 42c2 must treat stored mail as untrusted input.
- **No public-suffix dependency, no registrable-domain computation, no wildcard domains, no automatic allowlisting.** An unknown sender is counted and shown; only the owner adds a domain. No program, member or domain is created from mail.
- **No route returns, exports or downloads raw mail** or any byte of it. No route lists stored messages.
- **No plus-address or dot normalisation of forwarding addresses.** An address matches exactly, case-folded.
- **No backfill beyond the retention window** and no re-download of a message once its dedupe key is known.
- **No change to the ledger.** No read of `transactions`, `accounts`, `account_valuations` or any ledger table by any new or changed file; no write to any of them. `computeNetWorth`, the earn estimate (`lib/loyaltyEarn.ts`, `lib/domain/loyalty.ts`) and the fee watch are untouched.
- **No change to** `scripts/daily-job.ts`, `lib/jobHealthRead.ts`, `lib/logger.ts`, `lib/receiptReader.ts`, `lib/sync.ts`, `lib/netWorth.ts`, `lib/giftReadPath.ts`, `lib/domain/giftMask.ts`, the import script, the vitest configs, `evals/`, the root `package.json`, any applied migration, or `apps/web/lib/fixtures/loyalty-earn-cases.json`. Job health (`jobHealth`) gains no inbox signal.
- **No new page, no sidebar change, no new timer.** The poll rides `runDailyJob`; there is no second scheduler.
- **No new env var beyond the seven** in Open question 2. No new npm dependency beyond `imapflow`, `mailparser` and (only if needed for types) `@types/mailparser`.
- **No library error text, stack, or credential reaches a log line, a response or a page.** Only a classified code does.
- **No JS clock or date arithmetic on the server path** (Conventions). **No float and no rounding anywhere** (there is no money).
- **The real IMAP adapter's LOGIN, SELECT and FETCH are not exercised by any test** (Open question 13). That is a stated, unverified residual for the owner's first real run, not a defect.
- **No existing test is weakened or deleted.** Existing tests are edited only in the ways command 15 allows.

## Contracts touched
Expected: G1 applies (contract surface touched; lease required). The guardian writes the migration and the types; this spec fixes the names the acceptance commands query. Class per BUILD.md §9.2 is **additive** for every row.

| File | Change | Class (§9.2) |
|---|---|---|
| `migrations/<new timestamp greater than 1792900000000>_loyalty_inbox.sql` (the file name must contain `loyalty_inbox`) | Creates five tables with exactly these columns. `loyalty_sender_domains`: `id`, `program_id` (NOT NULL, FK to `loyalty_programs(id)` ON DELETE CASCADE), `domain` (TEXT NOT NULL, UNIQUE, CHECK lower-case hostname shape), `last_seen_on` (DATE, nullable). `household_member_addresses`: `id`, `member_id` (NOT NULL, FK to `household_members(id)` ON DELETE CASCADE), `address` (TEXT NOT NULL, UNIQUE, CHECK lower-case addr-spec shape), `added_on` (DATE NOT NULL DEFAULT CURRENT_DATE), `last_received_on` (DATE, nullable). `loyalty_inbox_messages`: `id`, `dedupe_key` (TEXT NOT NULL UNIQUE, CHECK exactly 64 lower-case hex characters), `received_on` (DATE NOT NULL), `stored_on` (DATE NOT NULL DEFAULT CURRENT_DATE), `program_id` (NOT NULL, FK, no delete action), `sender_domain` (TEXT NOT NULL, CHECK hostname shape), `origin` (CHECK in `direct`, `attachment`, `inline`), `attribution` (CHECK in `matched`, `unmatched`, `none_found`, `ambiguous`), `member_id` (nullable FK, no delete action), `raw_mail` (BYTEA, nullable), `oversize` (BOOLEAN NOT NULL DEFAULT FALSE), CHECKs that `attribution = 'matched'` exactly when `member_id` is not null, and that `raw_mail` is null exactly when `oversize` is true. `loyalty_inbox_unknown_senders`: `dedupe_key` (TEXT PRIMARY KEY, 64 lower-case hex), `received_on` (DATE NOT NULL), `domain` (TEXT NOT NULL, CHECK hostname shape or the exact text `(unreadable)`). `loyalty_inbox_state`: `id` (SMALLINT PRIMARY KEY, CHECK equal to 1), `last_polled_on` (DATE), `last_outcome` (CHECK null or `ok` or `error`), `last_error_code` (TEXT, nullable); one row seeded by the migration. Seeds every existing catalog program with at least one public sender domain (Open question 7). No column name on these five tables contains `subject`, `body`, `snippet`, `content`, `header`, `text`, `from`, `local`, `recipient`, `member_number`, `balance`, `amount`, `password`, `secret`, `token`, `estimate`, `parsed` or `extract`; no column is a keyword that Postgres quotes in `pg_get_indexdef` (P8-42b2 G1 A1: `position` was). The `down` drops the five tables and touches nothing else; it is not lossless for the editable configuration (Rollback). | additive |
| `db/schema.sql` | Mirrors the migration. | additive |
| `packages/contracts/loyalty.ts` | `LoyaltyProgramPatchRequestSchema` gains optional `senderDomains` (array of 0 to 20 domain strings; the empty array clears). `LoyaltyMemberPatchRequestSchema` gains optional `forwardingAddresses` (array of 0 to 10 address strings). `LoyaltyOverviewSchema` gains a required strict-object key `inbox` (shape in Conventions). New exported `LoyaltyInboxPollResponseSchema` (envelope of a strict object, shape in Conventions). `LoyaltyErrorCodeSchema` gains `DOMAIN_TAKEN` and `ADDRESS_TAKEN`. New constants `LOYALTY_INBOX_RETENTION_DAYS` (30), `LOYALTY_INBOX_SILENCE_DAYS` (45), `LOYALTY_INBOX_MAX_BYTES` (5242880), `LOYALTY_INBOX_MAX_DOMAINS` (20), `LOYALTY_INBOX_MAX_ADDRESSES` (10), `LOYALTY_INBOX_UNKNOWN_LIMIT` (20). `LoyaltyProgramSchema`, `LoyaltyMemberSchema` and every membership schema are unchanged (the patch responses do not echo the new fields; the page reads them from `inbox`). | additive |
| `packages/contracts/loyalty.test.ts` | One test added (`T42c1-U1`) and the four edits command 15 allows. | additive (tests) |
| `.env.local.example` | Seven new empty variables with a comment. | additive |
| `apps/web/package.json`, `package-lock.json` | Exactly the dependencies of Open question 1. | additive |

The table and column names, the `inbox` and poll-response field names and the constants' names are fixed here because acceptance commands query or grep them. A guardian who wants a different shape must raise it before G0 freezes this spec.

### Fixed test seams (names the tests import or mock; everything else is the implementer's)
- `apps/web/lib/domain/loyaltyInbox.ts` (pure, no I/O, the only non-test importer of `mailparser`): the MIME parse, original sender and recipient recovery, domain match, attribution and domain/address validation.
- `apps/web/lib/loyaltyInboxSource.ts` (the only non-test importer of `imapflow`, the only file that mentions `LOYALTY_IMAP_PASSWORD`): exports `readInboxConfig(env)` (pure), `describeInboxConfig(env)` (the password-free view the overview uses) and `createMailSource(env)` (the real adapter).
- `apps/web/lib/loyaltyInbox.ts` (the only non-test file that mentions `raw_mail`): exports `pollLoyaltyInbox`, `purgeExpiredInbox` and `runLoyaltyInboxDaily` (poll then purge; resolves, never rejects). Tests inject a fake source by mocking `createMailSource` in `@/lib/loyaltyInboxSource`.
- The mail-source interface has exactly three operations: list the envelopes since a date; fetch one message's raw bytes by id; close. An envelope is `{ id, messageId | null, fromAddress | null, receivedAt (ISO text), size }`, where `fromAddress` is the single address of the From header or null when there is none or more than one. The fake in the tests is a strict proxy that throws on any other method (so a write to the mailbox cannot be written without the test failing).

## Conventions this task must honor
- **Sign:** this task reads, writes and shows no ledger amount, balance, fee or currency figure. Every number it emits is a non-negative whole count or a whole number of days. Days are integers computed in Postgres (`CURRENT_DATE` minus a `DATE`), never by JS.
- **Rounding:** none. There is no division, no percentage and no money. A count is exact; a day difference is exact.
- **Landscape + exclusions:** not applicable. No ledger row is read, so `landscape`, `hidden`, `exclude_from_budget` and gift holds are never consulted, and no non-test file this task adds or changes contains `FROM transactions` or `JOIN transactions`. The gift-surface classes are in Open question 15.
- **Null semantics:** "never checked" is `lastCheck: null` and renders `Not checked yet`, never a date, `ok` or a zero. "No mail seen" is `lastSeenOn: null` and renders `No mail seen yet`, never `1970-01-01` or an empty string. A member with no address is `not_set_up`, never `quiet`. A count of zero is the number zero and renders as a number. An absent value is never the text `null`.

### Dates and "today"
- "Today" is Postgres `CURRENT_DATE`. Calendar dates are `YYYY-MM-DD` text from Postgres (`::text`). The server path (library, routes, page, job) uses no JS clock and no JS date arithmetic: none of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `getTimezoneOffset`, `toLocaleDateString`, `parseFloat`, `toFixed`, `Math.round` appears in any file this task adds, or in any line it adds to an existing file. The one exception is the adapter file `lib/loyaltyInboxSource.ts`, which may use `new Date(` and `toISOString` (and nothing else from that list) to bridge the library's `Date` values to ISO text and back, because `imapflow` speaks `Date`. It does no arithmetic with them.
- `received_on` is the UTC calendar date of the message's server-side received time (IMAP INTERNALDATE), derived in Postgres as `(<ISO text>::timestamptz AT TIME ZONE 'UTC')::date`. Retention, the fetch window, health and coverage compare `received_on` and the other `DATE` columns with `CURRENT_DATE`. The database session's time zone and UTC can differ by a day for a few hours, which can move a boundary message by one day; this is accepted and stated. The tests place boundary rows by `DATE` value, never by a clock.

### Which header counts as the sender (exact)
1. The **original sender** is chosen in this order, and the first rule that yields an address decides:
   1. **Attachment.** If the outer message has a `message/rfc822` part (first in document order, depth first) **and the outer `From` address is a registered member forwarding address**, the original is that part and its `From` is the sender. `origin` is `attachment`.
   2. **Inline.** Else, if the outer `From` address is a registered member address and the text body contains a forward marker line (`---------- Forwarded message ---------`, `-----Original Message-----`, or `Begin forwarded message:`, matched case-insensitively with any run of dashes of length two or more, and with an optional leading `> ` quote prefix) followed within the next 12 lines by a line `From:`, the address in that `From:` line is the sender. `origin` is `inline`.
   3. **Direct.** Else the outer `From` header's address is the sender. `origin` is `direct`.
   A forwarded original (rules 1 and 2) is honoured only from a registered member address, so a stranger cannot inject an original sender. When the outer `From` is not a registered member, rule 3 applies and the outer domain is what is judged.
2. Only the **address of the `From` header** counts. The display name, `Reply-To`, `Return-Path`, `Sender`, `Message-ID`, `Received` and any `From`-looking text in a body other than rule 2 never count. If the `From` header holds more than one mailbox, none, or an address whose domain is not ASCII hostname-shaped (lower-cased: letters, digits, hyphens, dots, at least two labels, each label 1 to 63 characters, not starting or ending with a hyphen, total at most 253), the sender is unreadable.
3. **The match rule.** The sender's domain, case-folded, matches a stored program domain `S` when it equals `S` or ends with a dot followed by `S`. A substring, a prefix, a suffix without the dot, or a longer domain that merely contains `S` never matches. When more than one stored domain matches (for example `brand.test` of one program and `mail.brand.test` of another), the longest stored domain wins. There is no public-suffix logic: only what the owner stored matches.
4. A message whose sender is unreadable or does not match is **unknown**: counted once under its sender domain, or under `(unreadable)`.

### Which address is the recipient, and which member it is (exact)
Candidate addresses are collected in tiers, each address case-folded; the walk stops at the first tier that holds an address that equals a registered member address.
- **Tier 1:** inside a forwarded original (origin `attachment` or `inline`): for an attachment its `Delivered-To`, `X-Original-To`, `To`, `Cc` headers in that order; for an inline forward the `To:` then `Cc:` lines of the forwarded header block.
- **Tier 2:** the outer `X-Original-To`, then `X-Forwarded-For` (every address in the header, space or comma separated, in order), then every `Delivered-To` header in order.
- **Tier 3:** the `for <address>` clause of the outer `Received` headers, scanning from the oldest (last in the message) to the newest.
- **Tier 4:** the outer `To`, then `Cc`.
- **Tier 5:** the outer `From` address, only when `origin` is `attachment` or `inline` (the forwarder is the member).
Within the deciding tier, if the matching addresses belong to **two or more different members**, the result is `ambiguous` (no member). If no tier holds a registered address but at least one candidate address exists, the result is `unmatched`. If no candidate address exists anywhere, the result is `none_found`. A non-member address (for example the dedicated mailbox's own address in `Delivered-To`) never stops the walk. Otherwise the result is `matched` with that member. Only `matched` sets `member_id`.

### Dedupe, window and what is downloaded
- **Dedupe key** (Open question 3): the lower-case hex SHA-256 of the outer `Message-ID` with angle brackets and surrounding whitespace removed and otherwise exact; when the outer message has no `Message-ID`, the hex SHA-256 of the text `raw:` followed by the raw bytes. The same key is used for stored and for unknown messages. A key that already exists in either table is a duplicate: not downloaded again, not counted again.
- **Window.** The list asks for messages since `CURRENT_DATE - 30`. The mailbox's date filter is day-granular and may return a message slightly older than the window; the poller itself drops any message whose `received_on` is earlier than `CURRENT_DATE - 30` (counted `expired`, not stored, not counted as unknown). The fetch window and the retention cut-off are the same boundary, so a message is never fetched after it was deleted.
- **What is downloaded in full.** A message is downloaded only when its envelope `fromAddress` is allowlisted by domain, or is a registered member address (a possible manual forward). Every other message is counted by its envelope sender's domain (or `(unreadable)`) and never downloaded. A message whose envelope sender is a registered member and which, once parsed, yields no allowlisted original is discarded (not stored) and counted unknown under the original sender's domain, or the outer domain. It was held in memory only.
- **Size cap.** A message larger than `LOYALTY_INBOX_MAX_BYTES` is stored without its bytes (`oversize` true, `raw_mail` null), keeps its dedupe key and attribution columns computed from nothing but its envelope (`origin` `direct`, `attribution` `none_found`), and is counted `oversize` in the poll result. It is never downloaded in full.
- **Stored columns derived from headers or body:** exactly `sender_domain`, `origin`, `attribution`, `member_id`. The durable monotone dates `loyalty_sender_domains.last_seen_on` and `household_member_addresses.last_received_on` are set to the greater of the old value and the message's `received_on` (an older message never moves them back, the observations lesson).

### Forwarding health and coverage (exact)
- For a member, the **reference date** is the greatest `last_received_on` over its addresses, or, when none has one, the least `added_on` over its addresses. `quietDays` is `CURRENT_DATE` minus the reference date, in whole days.
- States: `not_set_up` (no address; `quietDays` null), `no_mail_yet` (has an address, no `last_received_on`, and `quietDays` is at most 45), `ok` (has `last_received_on` and `quietDays` is at most 45), `quiet` (`quietDays` strictly greater than 45, whether or not mail was ever received). Exactly 45 days is not quiet; 46 is. Unattributed mail counts toward nobody's health.
- **Coverage** per program that has at least one sender domain: `lastSeenOn` is the greatest `last_seen_on` over its domains (null if none); `storedInWindow` is the count of retained messages for that program with `received_on` on or after `CURRENT_DATE - 30`.
- **Unknown senders:** `unknownSenders` is domain and count over the retained unknown rows (those with `received_on` on or after `CURRENT_DATE - 30`), ordered by count descending then domain ascending, at most `LOYALTY_INBOX_UNKNOWN_LIMIT` entries; `unknownSenderTotal` is the count of all retained unknown rows. **Unattributed** is the count of retained stored messages whose `attribution` is not `matched`.

### The overview's `inbox` object and the poll response (exact shapes, strict objects)
- `inbox`: `configured` (boolean), `problem` (null, `unset`, `incomplete`, `invalid_tls`, `invalid_port` or `invalid_timeout`), `missing` (array of environment variable names only, never values), `retentionDays`, `silenceDays`, `lastCheck` (null or `{ on, outcome, errorCode }` with `on` a date, `outcome` `ok` or `error`, `errorCode` null or one of the poll error codes), `senderDomains` (array of `{ programId, domains }` for programs with at least one domain), `coverage` (array of `{ programId, lastSeenOn, storedInWindow }`), `forwarding` (array of `{ memberId, addresses, state, lastReceivedOn, quietDays }`, one per member), `unknownSenders` (array of `{ domain, count }`), `unknownSenderTotal`, `unattributed`.
- Poll error codes (not `LoyaltyErrorCode`): `connect_failed`, `tls_failed`, `auth_failed`, `timeout`, `mailbox_missing`, `source_failed`.
- Poll response data: `{ outcome, fetched, stored, duplicates, unknown, expired, oversize, errorCode }` where `outcome` is `ok`, `disabled`, `already_running` or `error`; the six counts are whole numbers (zero when nothing ran); `errorCode` is null unless `outcome` is `error`. HTTP status is 200 for all four outcomes. A refused caller is 401 or 403 with the existing envelope.
- No emitted object holds a message body, subject, address of a sender, a member address other than in `forwarding.addresses` (the owner's own configuration), the password, the host, the user or a Message-ID. A stray key is refused by the contract.

### Domain and address input (exact)
- **Sender domain** (`senderDomains` items): trimmed and lower-cased by the handler, then valid only if it is ASCII hostname-shaped as above with at least two labels and a final label of 2 to 24 letters or `xn--` form, with no trailing dot, no leading dot, no wildcard, no scheme, path, port or `@`. It is refused when it equals or is a subdomain of a shared mail provider (`gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `live.com`, `yahoo.com`, `icloud.com`, `me.com`, `aol.com`, `proton.me`, `protonmail.com`, `gmx.com`, `mail.com`) or equals one of a short static list of shared multi-label public suffixes (at least `co.uk`, `org.uk`, `com.au`, `co.nz`, `co.jp`, `com.br`, `co.za`). The list is data in the code and is a stated limit: a suffix not on it is not caught, and the editor is owner-only. A list is replaced whole and atomically; a domain already held by another program is 409 `DOMAIN_TAKEN` and the old list is unchanged; a repeated domain inside one list is `INVALID_INPUT`.
- **Forwarding address** (`forwardingAddresses` items): trimmed and lower-cased, then `local@domain`, ASCII, local part 1 to 64 characters from letters, digits and `.!#$%&'*+/=?^_`{|}~-`, domain hostname-shaped with at least two labels, total at most 254, no display name, no angle brackets, no quoted local part. A list is replaced whole and atomically; an address held by another member is 409 `ADDRESS_TAKEN`, nothing changes; a repeated address in one list is `INVALID_INPUT`. After a successful replace, the retained messages whose `attribution` is not `matched` are re-attributed with the rules above (from their stored raw bytes); a message already `matched` is never changed, and `last_received_on` only moves forward.
- Error messages never echo a submitted domain or address.

### Visible text
Case-sensitive, after removing every `<!-- -->` comment from the HTML. Dates are the Postgres text.

| Situation | `/travel` contains |
|---|---|
| the inbox panel | `Loyalty inbox` and `Raw mail is kept 30 days, then deleted.` |
| `configured` false | `Inbox polling is not set up`, the words `forwarding filter`, and each `missing` name; and the text `Check inbox now` appears nowhere |
| `configured` true | `Check inbox now` |
| `lastCheck` null | `Not checked yet` |
| `lastCheck` outcome ok | `Last check: ` then the date then ` · ok` |
| `lastCheck` outcome error | `Last check: ` then the date then ` · failed (` the error code `)` |
| unknown senders, total zero | `No mail from unknown senders` |
| unknown senders, total above zero | `Mail from unknown senders: ` the total, and one line `<domain> × <count>` per listed entry |
| unattributed above zero | `Not matched to a person: ` the count |
| member `not_set_up` | `<name>: no forwarding address set` |
| member `no_mail_yet` | `<name>: no mail yet` |
| member `ok` | `<name>: last mail ` the date |
| member `quiet` | `<name>: forwarding quiet for ` the days ` days` |
| program with a domain, coverage | `Last mail seen: ` the date, or `No mail seen yet`; and the count with ` in the last 30 days` |
| program with no domain | `No sender domains set` |
| controls | `Edit sender domains` and `Edit forwarding addresses` |

A `null` is never rendered as `0`, an empty string or the text `null`. A domain shown on the page is React-escaped text; the domain validator guarantees it holds no markup.

### Process requirements for the implementer
Read the relevant guides under `node_modules/next/dist/docs/` (resolved from `apps/web`) before changing a client component or adding a route handler. Invoke the `uiux-promax` skill before designing the inbox panel and the two editors, and reuse the alias editor's pattern in `LoyaltyProgramCard`. Record in EVIDENCE.md which docs files were read. The phone-first tap-target rule of P8-42a2 applies (controls not smaller than the existing `min-h-8`).

## Toolchain prerequisites
All commands run under `bash` from the repo root. Orchestrator-measured facts of 2026-11-21: unit 105 files and 1414 tests, lint 0 errors and 5 warnings, integration 344 tests with failing set `[]`, surface script ends `OK H1-H13`, throwaway DB `postgresql://localhost/b8_p42a_throwaway` at head `1792900000000`, 11 loyalty route files, no IMAP or MIME package installed.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql`, `createdb`, `dropdb`, a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB is at head `1792900000000_loyalty_earn_rules` and has none of the new tables | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select name from pgmigrations order by id desc limit 1"` → `1792900000000_loyalty_earn_rules`, and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select coalesce(to_regclass('public.loyalty_inbox_messages')::text,'none')"` → `none` | filled at G0 |
| T3 | `npm run migrate:up` and `npm run migrate:down` honour `DATABASE_URL` | **yes** | existing in root `package.json` | `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up >/dev/null 2>&1; echo "exit=$?"` → `exit=0` | filled at G0 |
| T4 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → 105 files, 1414 tests | 105 / 1414 |
| T5 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, 5 warnings | 0 / 5 |
| T6 | Integration baseline | **yes** | existing | P8-42b2 #7's body run on the unmodified tree → `OK 344 tests …` | 344, failing `[]` |
| T7 | `tsc` runs in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T8 | Node 22 or later with global `fetch` | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T9 | Port 3198 free and the surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H13`, `exit=0` | filled at G0 |
| T10 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T11 | P8-42b2's SPEC.md blocks extracted in command 10 sit at the stated lines | **yes** | frozen | `S=plan/tasks/P8-42b2-card-earn-estimate/SPEC.md; for n in 328 336 429 441; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done` → 328 starts `set -e; S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md`; 336 starts `X 306 316 "$HEAD"`; 429 starts `set -e; F=apps/web/lib/fixtures/loyalty-earn-cases.json`; 441 starts `console.log("fixture shape ok")'` | filled at G0 |
| T12 | The extracted regression blocks of command 10 and P8-42b's class block (P8-42b SPEC lines 332 to 340, used by command 12) pass on the unmodified tree | **yes** | existing | commands 10 and 12's first block, run before the implementer starts | filled at G0 |
| T13 | `vitest` accepts the four path filters of command 7 from `apps/web` | **yes** | existing | `(cd apps/web && npx vitest run packages/contracts/loyalty.test.ts 2>&1 \| tail -6)` → `Test Files  1 passed (1)` | filled at G0 |
| T14 | No `zq42c`-prefixed rows exist, and no loyalty program name starts `ZQ42C` | **yes** | n/a | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42C%')\|\|','\|\|(select count(*) from household_members where display_name like 'ZQ42C%')"` → `0,0` | filled at G0 |
| T15 | Under `set -e`, a leading `!` does NOT abort when the negated command succeeds. This spec writes no `! cmd` guard. | **yes** (documents a hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T16 | Fixture directory `apps/web/lib/fixtures/loyalty-inbox/` is on disk with 27 `.eml` files and `cases.json` and matches the pinned digest | **yes** | the orchestrator writes it from "Prerequisites the orchestrator creates" before G0 freezes | command 16's first four lines on the written directory | filled at G0 |
| T17 | The exact current versions of `imapflow`, `mailparser` and `@types/mailparser` (or its absence), and each package's licence, measured by the orchestrator and written into command 4's three `…_PENDING` literals before G0 freezes | **yes** (orchestrator-only; needs the npm registry; no command here needs a network) | `npm view imapflow version license`, `npm view mailparser version license`, `npm view @types/mailparser version` | the three printed versions equal the three literals, and each licence is MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 | filled at G0 |
| T18 | No `LOYALTY_IMAP_` variable is set in the shell that runs the commands (a real credential must never reach a test) | **yes** | n/a | `env \| grep -c '^LOYALTY_IMAP_'` → `0` | filled at G0 |
| T19 | A browser or jsdom renderer | **NO** | n/a. Wording is proved over real HTTP (H14) and by source checks. | n/a | n/a |
| T20 | Live Plaid, the Anthropic API, a real mailbox or mail host, any non-loopback socket, the dev database `b8_finance`, the owner's real ledger | **NO** | n/a | n/a | n/a |
| T21 | Work happens on `main`, uncommitted, so `git merge-base HEAD main` is `HEAD` and `git diff --name-only HEAD` plus untracked files is exactly this task's change. Nothing is committed before G4. | **yes** | adjudicated at G0 | `git merge-base HEAD main` → a SHA equal to `git rev-parse HEAD` | filled at G0 |
| T22 | Postgres quotes keyword column names in `pg_get_indexdef`; this task's index checks accept either spelling | **yes** (documents a hazard) | n/a | `psql -d postgres -Atc "select pg_get_indexdef(i.indexrelid) from pg_index i limit 0"` runs | filled at G0 |
| T23 | The P8-42a2 line used by command 9 is where it was | **yes** | frozen | `sed -n '153p' plan/tasks/P8-42a2-loyalty-nits/SPEC.md \| cut -c1-90` → starts `set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case "$(sed -n '228p'` | filled at G0 |

**The throwaway database is mutated by commands 5 and 8 and is left at the new head.** Command 10 (regressions) runs after command 5 against that head. If a regression block asserts a loyalty table list or route count that this task legitimately changes, that is a conflict to name to the orchestrator, not to absorb. The known state-pinning commands are named in "Existing state this task changes".

### Existing state this task changes (named, with the guarded edit each is allowed)
Each existing test or command below pins a state this task changes. Each may change in exactly the stated way and no other; command 15 enforces it. Line numbers are on the current tree (HEAD `80a23d1`).
1. `packages/contracts/loyalty.test.ts` line 125, `expect(responses.length).toBe(6);` (T42a-U7, the count of exported `…ResponseSchema`). It becomes `toBe(7)` (the new `LoyaltyInboxPollResponseSchema`). The envelope loop below it applies to the new schema and must pass unedited.
2. `packages/contracts/loyalty.test.ts` line 135 (T42a-U7, an overview response fixture) and line 222 (T42b-U2, `const overview = { members: [], programs: [], cards: [], instruments: [] };`). Each may gain `inbox: <an identifier naming a fixture const>` and nothing else. Line 223 (the overview without `cardAccounts` must be refused) is unchanged and still passes.
3. `packages/contracts/loyalty.test.ts` lines 408 and 409 (T42b2-U3, the list `codes` and the exact-set assertion at 411). The list may gain the two strings `'DOMAIN_TAKEN'` and `'ADDRESS_TAKEN'` and nothing else. The assertion stays exact.
4. `apps/web/app/api/v1/loyalty/loyalty.test.ts` line 506 (T42a-C10) and `loyaltyCard.test.ts` line 603 and `loyaltyEarn.test.ts` line 591: `toHaveLength(11)` becomes `toHaveLength(12)` in each (the new route file). Nothing else in them changes.
5. `apps/web/lib/loyalty.test.ts`: the constant `LOYALTY_ROUTE_FILES` (lines 295 to 307, T42a-U8) gains one element, `'app/api/v1/loyalty/inbox/poll/route.ts'` (an added line; no line is removed); and line 396, `expect(surface).toContain(`console.log('OK H1-H13');`)`, becomes `OK H1-H14`.
6. P8-42b2 #10 (surface script, expects `OK H1-H13` and `H1 PASS` to `H13 PASS`), P8-42b2 #5 (the exact loyalty table list), P8-42b2 #4 (it runs one `migrate:down` and asserts the P8-42b2 columns, which would now take down this task's migration), P8-42b2 #11 (it forbids any registry class line change) and P8-42b2 #14 (it diffs against the merge base, which now carries this task's allowed edits) cannot be re-run unchanged and are **not** re-run. Their intent is carried by commands 5, 6, 11, 12 and 15 here.

### Prerequisites the orchestrator creates
**The fixture directory `apps/web/lib/fixtures/loyalty-inbox/`.** The orchestrator writes the following before G0 freezes this spec, computes the digest of command 16, and replaces the literal `INBOX_FIXTURE_SHA_PENDING` in command 16 with it. The implementer does not create, edit, reformat or delete anything in it.

Every `.eml` file is LF-terminated and carries these headers unless its row says otherwise: `Message-ID: <zq42c-<id>@zq42c-brand.test>` (`<id>` the lower-case file id, for example `f01`), `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`, `Subject: ZQ42C-SUBJECT-CANARY <ID>`, `Date: {{DAY:-<n>}}`, and the body `ZQ42C-BODY-CANARY <ID> ZQ42C-MEMBER-0000`. The token `{{DAY:-<n>}}` stands for the RFC 2822 date, at 12:00:00 +0000, of `CURRENT_DATE` minus `<n>` days; the test harness replaces every token by asking Postgres. The people are member A `zq42c-anna@example.com`, member B `zq42c-boris@example.net`, an unregistered stranger `zq42c-stranger@example.org`, and the dedicated mailbox's own address `zq42c-inbox@example.net`. "Brand" is the fixture hotel program `ZQ42C Stays` with sender domain `zq42c-brand.test`; "air" is the fixture airline program `ZQ42C Air` with sender domain `zq42c-air.test`. The tests create both programs, both members and their addresses, and the domain rows themselves; no fixture file creates data.

| Id | Day | Distinguishing content | Must end as |
|---|---|---|---|
| F01 | -3 | `From: ZQ42C Stays <statements@zq42c-brand.test>`; `To: zq42c-anna@example.com`; `Delivered-To: zq42c-inbox@example.net`; `X-Forwarded-For: zq42c-anna@example.com zq42c-inbox@example.net` | stored, brand, direct, matched A |
| F02 | -5 | `From: news@mail.zq42c-brand.test`; `X-Forwarded-For: zq42c-anna@example.com` | stored, brand, direct, matched A (subdomain) |
| F03 | -3 | `From: statements@zq42c-brand.test.attacker.test`; `X-Forwarded-For: zq42c-anna@example.com` | unknown `zq42c-brand.test.attacker.test` |
| F04 | -3 | `From: statements@notzq42c-brand.test` | unknown `notzq42c-brand.test` |
| F05 | -3 | `From: "statements@zq42c-brand.test" <spoof@attacker.test>` | unknown `attacker.test` (display-name spoof) |
| F06 | -3 | `From: zq42c-brand.test@attacker.test` | unknown `attacker.test` (brand in the local part) |
| F07 | -3 | `From: spoof@attacker.test`; `Reply-To: statements@zq42c-brand.test`; `Return-Path: <statements@zq42c-brand.test>`; `Sender: statements@zq42c-brand.test` | unknown `attacker.test` (other headers never count) |
| F08 | -4 | outer `From: ZQ42C Anna <zq42c-anna@example.com>`, `To: zq42c-inbox@example.net`, `Message-ID: <zq42c-f08@example.com>`; `multipart/mixed` with a text part and a `message/rfc822` part holding a message from `ZQ42C Stays <statements@zq42c-brand.test>` to `zq42c-anna@example.com` with its own subject and body canaries | stored, brand, attachment, matched A |
| F09 | -6 | outer `From: zq42c-boris@example.net`, `To: zq42c-inbox@example.net`, `Message-ID: <zq42c-f09@example.net>`; body: the canary line, a blank line, `---------- Forwarded message ---------`, `From: ZQ42C Stays <statements@zq42c-brand.test>`, `Date: {{DAY:-6}}`, `Subject: ZQ42C-SUBJECT-CANARY inner`, `To: zq42c-boris@example.net` | stored, brand, inline, matched B |
| F10 | -3 | as F08 but outer `From: zq42c-stranger@example.org`, `Message-ID: <zq42c-f10@example.org>` | unknown `example.org` (a forward from a non-member is not honoured) |
| F11 | -7 | `From` brand; `Delivered-To: zq42c-inbox@example.net`; no `To` | stored, brand, direct, unmatched |
| F12 | -8 | `From` brand; no `To`, `Cc`, `Delivered-To`, `X-` or `Received` header | stored, brand, direct, none_found |
| F13 | -9 | `From` brand; `X-Forwarded-For: zq42c-anna@example.com zq42c-boris@example.net` | stored, brand, direct, ambiguous |
| F14 | -10 | outer `From`, `To` and `X-Forwarded-For` all `zq42c-anna@example.com`, `Message-ID: <zq42c-f14@example.com>`; a `message/rfc822` part from brand with `Delivered-To: zq42c-boris@example.net` and `To: zq42c-boris@example.net` | stored, brand, attachment, matched B (tier 1 beats tiers 2 to 5) |
| F15 | -11 | `From` brand; two `Received` headers, the first `Received: from localhost by zq42c-mx.example.net for <zq42c-inbox@example.net>; {{DAY:-11}}`, the second (older, lower in the file) `Received: from localhost by zq42c-origin.example.com for <zq42c-boris@example.net>; {{DAY:-11}}`; no `To`, no `X-` header | stored, brand, direct, matched B (tier 3, oldest first) |
| F16 | -12 | `From` brand; `X-Forwarded-For: zq42c-anna@example.com`; no `Message-ID` header at all | stored, brand, direct, matched A (key from the raw bytes) |
| F17 | -3 | `Message-ID: <zq42c-f01@zq42c-brand.test>` (the same as F01); body `ZQ42C-BODY-CANARY F17-DUPLICATE`; `From` brand; `X-Forwarded-For: zq42c-anna@example.com` | duplicate (F01's row is the one kept) |
| F18 | -3 | `From: statements@zq42c-brand.test, spoof@attacker.test` | unknown `(unreadable)` (two mailboxes) |
| F19 | -3 | `From: statements@zq42c-brànd.test` (UTF-8, 8bit) | unknown `(unreadable)` (non-ASCII domain) |
| F20 | -60 | `From` brand; `X-Forwarded-For: zq42c-anna@example.com` | expired (outside the window; not stored, not counted) |
| F21 | -3 | `From: a@other-sender.test` | unknown `other-sender.test` |
| F22 | -3 | `From: b@other-sender.test` | unknown `other-sender.test` |
| F23 | -20 | `From: miles@zq42c-air.test`; `X-Forwarded-For: zq42c-anna@example.com` | stored, air, direct, matched A |
| F24 | -3 | no `From` header | unknown `(unreadable)` |
| F25 | -2 | `From: statements@ZQ42C-BRAND.TEST`; `X-Forwarded-For: zq42c-anna@example.com` | stored, brand, direct, matched A (case-folded) |
| F26 | -13 | outer `From: zq42c-anna@example.com`, `Message-ID: <zq42c-f26@example.com>`; body: the canary line, a blank line, `Begin forwarded message:`, a blank line, then quoted lines `> From: ZQ42C Stays <statements@zq42c-brand.test>`, `> Subject: ZQ42C-SUBJECT-CANARY inner`, `> Date: {{DAY:-13}}`, `> To: zq42c-anna@example.com` | stored, brand, inline, matched A |
| F27 | -3 | outer `From: zq42c-boris@example.net`, `Message-ID: <zq42c-f27@example.net>`; a `message/rfc822` part from `spoof@attacker.test` to `zq42c-boris@example.net` | unknown `attacker.test` (a member's forward of a non-allowlisted original is downloaded, judged and discarded) |

**Totals of the full poll over F01 to F27** (asserted by T42c1-I2): fetched 27, stored 13, duplicates 1, expired 1, unknown 12, oversize 0. Unknown by domain: `attacker.test` 4 (F05, F06, F07, F27), `(unreadable)` 3 (F18, F19, F24), `other-sender.test` 2, `zq42c-brand.test.attacker.test` 1, `notzq42c-brand.test` 1, `example.org` 1. Stored by program: brand 12, air 1. Stored by attribution: matched A 7 (F01, F02, F08, F16, F23, F25, F26), matched B 3 (F09, F14, F15), unmatched 1 (F11), none_found 1 (F12), ambiguous 1 (F13); unattributed 3. Downloaded in full: exactly the 13 stored messages plus F27, 14 in all; none of F03 to F07, F10, F17 to F22, F24 is downloaded. After the poll, brand's `lastSeenOn` is `CURRENT_DATE - 2` and its `storedInWindow` 12; air's `lastSeenOn` is `CURRENT_DATE - 20` and `storedInWindow` 1; member A's `lastReceivedOn` is `CURRENT_DATE - 2` and member B's `CURRENT_DATE - 6`.

**`cases.json`** in the same directory is the machine copy of the table and totals above plus these groups, each a JSON array or object: `canaries` (`body` `ZQ42C-BODY-CANARY`, `subject` `ZQ42C-SUBJECT-CANARY`, `memberNumber` `ZQ42C-MEMBER-0000`, `password` `ZQ42C-PASSWORD-CANARY`, `user` `zq42c-login@example.net`); `domainAccept` (pairs input to stored: `zq42c-brand.test` to itself, `  ZQ42C-Brand.TEST  ` to `zq42c-brand.test`, `mail.zq42c-brand.test`, `xn--zq42c-test.test`); `domainRefuse` (empty, whitespace only, `test`, `.zq42c-brand.test`, `zq42c-brand.test.`, `*.zq42c-brand.test`, `zq42c-brand.test/path`, `https://zq42c-brand.test`, `user@zq42c-brand.test`, `zq42c brand.test`, `zq42c-brand..test`, `-zq42c.test`, `zq42c-.test`, `zq42c_brand.test`, `zq42c.t`, `zq42c.123`, `127.0.0.1`, `zq42c-brànd.test`, `gmail.com`, `mail.gmail.com`, `Outlook.com`, `co.uk`, `com.au`); `addressAccept` (`zq42c-anna@example.com`, `  ZQ42C-Anna@Example.COM  ` to the lower-case form, `zq42c+tag@example.net`); `addressRefuse` (empty, `zq42c-anna`, `@example.com`, `zq42c-anna@`, `zq42c anna@example.com`, `"ZQ42C Anna" <zq42c-anna@example.com>`, `zq42c-anna@example`, `zq42c-annà@example.com`, `a@b@example.com`); `lengths` (`domainMax` 253, `addressMax` 254, `localMax` 64, `domainsMax` 20, `addressesMax` 10); `envMatrix` (the rows of Open question 2: each an `env` object and an `expect` of `configured`, `problem`, `missing`); `health` (the boundary cases of T42c1-I6); `retention` (the cases of T42c1-I5).

## Open questions with defaults
Defaults are taken unless the owner objects before G0.

1. **IMAP client and MIME parser.** Default: **`imapflow`** (client) and **`mailparser`** (parser), both exact-pinned by `npm install --save-exact` in the `apps/web` workspace (`npm install --save-exact imapflow mailparser -w @b8/web`, plus `npm install --save-exact --save-dev @types/mailparser -w @b8/web` only if `mailparser` ships no types and `tsc` needs them), at the versions the orchestrator measures at G0 (T17) and writes into command 4. Why: both are maintained by one author, who also maintains `nodemailer`, which this repo already ships and trusts for the outbound alert mail; both are MIT licensed (T17 verifies the licence field); both are pure JavaScript with no native build step, which keeps the home-server install and the Docker image unchanged; `imapflow` is promise-based, supports read-only mailbox opens, `SINCE` search and fetching a message's source by id, which is all the interface needs. Alternatives rejected: `node-imap` (callback API, unmaintained for years), `emailjs-imap-client` (smaller and older, no read-only guarantee in its API), `postal-mime` (a good parser but browser-first; `mailparser` is the same family as the client and handles `message/rfc822` parts the recovery rules need). Both stay server-only: command 13 asserts the only non-test importer of each is the one named file and that no client component or page imports either. `npm audit --omit=dev` is run by the orchestrator at G4 and recorded as evidence; it needs the network, so it is not a gate command.
2. **Environment variables.** Default seven, read from `process.env` at call time, never at import: `LOYALTY_IMAP_HOST`, `LOYALTY_IMAP_PORT`, `LOYALTY_IMAP_TLS`, `LOYALTY_IMAP_USER`, `LOYALTY_IMAP_PASSWORD` (the five required), `LOYALTY_IMAP_MAILBOX` (optional, default `INBOX`), `LOYALTY_IMAP_TIMEOUT_SECONDS` (optional whole number 1 to 600, default 60). Values are trimmed; a whitespace-only value is unset. `LOYALTY_IMAP_TLS` must be the literal `true` (implicit TLS, the usual port) or `starttls` (STARTTLS required, never downgraded); `false`, `TRUE`, an empty string or anything else is `invalid_tls`, because a plaintext IMAP login would put the password and the mail on the wire in clear (the same reasoning and the same case-sensitive literal as the outbound alert's SMTP settings). `LOYALTY_IMAP_PORT` must be a whole number 1 to 65535. The result: all five required unset is `unset`; some but not all is `incomplete`; `missing` lists the unset required names in the order host, port, TLS, user, password (all five when unset); then TLS, port and timeout are validated in that order, the first failing one is the `problem`. **The envMatrix rows (in `cases.json`):** all unset; only the password set; all five set with TLS `true` and port `993`; with TLS `starttls` and port `143`; TLS `false`; TLS `TRUE`; port `0`, `65536`, `99x`, `-1`; a whitespace-only host; mailbox unset (default `INBOX`) and `ZQ42C Folder` (used); timeout `0` and `x` (`invalid_timeout`). The password and the user are read only by the adapter; the password-free `describeInboxConfig` is the only view the overview, a route or a log ever sees.
3. **Dedupe key.** Default: SHA-256 hex of the outer `Message-ID` (brackets and whitespace stripped, otherwise exact), or of `raw:` plus the bytes when there is none. Why the outer one: it is present on the envelope, so a duplicate is detected before any download; it does not depend on forward recovery, which can change when a member address is added; hashing keeps address-shaped text (a Message-ID can embed one) out of the database; and the same hash serves unknown messages, so an unknown sender is not recounted on every poll without storing anything about it but a domain and a date. Known limits, stated: one message delivered through two members' filters with the same `Message-ID` is stored once, attributed to whichever arrived first; a manual forward of one original twice carries two outer ids and is stored twice. Both are harmless to 42c2 (newest-by-as-of wins) and cost only storage.
4. **Are messages marked seen?** Default: no. The mailbox is opened read-only, `\Seen` is never set, and no other write exists. Progress is tracked by the dedupe table, not by mailbox state. Why: ITEM.md says the mailbox is not modified except as decided; a read-only open means even a bug in the poller cannot flag or delete a message; and the mailbox is a dedicated one only b8 reads, so "unread" carries no meaning to a person. The cost is that a re-poll lists the same window again; the envelope list is small and a known key skips the download.
5. **Recovering the original sender and recipient.** Default: the precedence of Conventions (attachment, then inline, then direct, for the sender; five tiers for the recipient), with the extra rule that a forwarded original is honoured only from a registered member address. Why that order: a manual "forward as attachment" and a manual inline forward both rewrite `From` to the forwarder, so the original must come from inside; an automatic filter forward (the common case, and what each person is asked to set up) preserves `From` and adds `X-Forwarded-For` and `Delivered-To`, so the outer headers are the original; `Received` is the weakest evidence and comes after the explicit headers. The membership rule exists so a stranger cannot make a forged "forwarded message" credible, and it makes the forwarder's own address a sound last-resort attribution. The unrecoverable case: no readable sender is `(unreadable)` and counted; no recipient candidate is `none_found`, a candidate that matches nobody is `unmatched`, a candidate set matching two members in the deciding tier is `ambiguous`. The three are stored and flagged, never guessed. Limit, stated: an address is compared exactly (no plus-tag or dot normalisation), so a member who forwards from an alias must register the alias.
6. **Domain match rule.** Default: equal to, or a subdomain of, a stored domain; longest stored domain wins; no public-suffix list. Why: the question the match answers is "is this sender one the owner explicitly trusted", and that is answered by comparing against what the owner stored. A public-suffix library would answer a different question (what is the registrable domain of the sender) for a rule that does not need it, and would add a dependency whose list ages. The risk it would cover, an owner storing a bare public suffix, is covered by the editor's refusal of single-label names, shared mail providers and a short static list of multi-label suffixes (a stated, bounded limit; the editor is owner-only). Look-alikes fail by construction: `brand.test.attacker.test` does not end with `.brand.test`, `notbrand.test` does not end with `.brand.test` and is not equal, and `brand.test@attacker.test` has the domain `attacker.test`.
7. **Seeded sender domains.** Default: every catalog program in `migrations/1792700000000_loyalty.sql` (fifty programs at the time of writing) gets at least one public sender domain, taken by the implementer from that company's own public website and recorded in the migration's header with the date and a note that the list is a starting point, editable on `/travel`. Many programs mail from a separate marketing domain the household will learn from the unknown-senders readout; that is the intended loop. Sixteen anchors are asserted by command 5 so a stub cannot pass: Marriott Bonvoy `marriott.com`, Hilton Honors `hilton.com`, World of Hyatt `hyatt.com`, Delta SkyMiles `delta.com`, United MileagePlus `united.com`, AAdvantage `aa.com`, IHG One Rewards `ihg.com`, Chase Ultimate Rewards `chase.com`. The structural checks refuse a seeded domain that is a shared mail provider, a `.test`, `.example`, `.invalid` or `.localhost` name, or `example.com`, `example.net` or `example.org`. A domain is unique across programs, so a domain two programs share (a bank that fronts two currencies) goes to one of them; the owner can move it. The rest of the list's correctness is unverified by the spec.
8. **Retention and deletion.** Default: 30 days, by `received_on` (strictly older than `CURRENT_DATE - 30` is deleted; exactly 30 days old is kept; 31 is deleted), the constant `LOYALTY_INBOX_RETENTION_DAYS`. Deletion is one function, `purgeExpiredInbox`, run by `runDailyJob` after the poll and again at the end of every on-demand poll, so retention does not depend on the job having run. It deletes stored messages (with their bytes) and unknown-sender rows past the cut-off; it leaves sender domains, addresses, `last_seen_on`, `last_received_on` and the state row. Why those survive: forwarding health and the coverage "last seen" must outlast the 30-day body retention, or every quiet forwarder would read as "never". Physical erasure of the bytes follows autovacuum; no `VACUUM FULL` is run (a stated limit).
9. **Forwarding-health threshold.** Default: 45 days, strictly greater is quiet, the constant `LOYALTY_INBOX_SILENCE_DAYS`. Why: LOYALTY-ROADMAP says "the longest statement cycle among their programs", which 42c2 will learn; until then 45 is a monthly cycle plus slack, and a person whose forwarding works receives mail from at least one monthly sender. It is one constant, the one 42c2 replaces. A member with addresses but no mail yet is `no_mail_yet` until 45 days after the earliest address was added, then `quiet`.
10. **The on-demand trigger.** Default: `POST /api/v1/loyalty/inbox/poll`, no body; auth is the loyalty routes' `callerOf` (a signed-in session, or a bearer token with write scope; a read-scope token is 403 `INSUFFICIENT_SCOPE`; no credential is 401), run before any other work. Why a write route: it opens a connection to the mailbox and writes rows. **Concurrency:** a Postgres session advisory lock (`pg_try_advisory_lock`) held on one dedicated client for the whole poll, taken by both the route and the daily job (separate processes), so two polls cannot run at once. A caller that cannot take it gets `outcome: 'already_running'` with zero counts and no state change. The lock is released in every path including an error and a timeout (a stalled source is cut off after `LOYALTY_IMAP_TIMEOUT_SECONDS` and reported `timeout`); a process that dies loses the lock with its connection. The unique dedupe key is the second layer: a store that loses a race is `ON CONFLICT DO NOTHING`, never a 500. **No rate limit** beyond single-flight: at most one connection is open at a time, so a caller holding a write token can cause repeated polls but not parallel ones (stated).
11. **Shape of the unknown-sender count.** Default: one row per unknown message holding only its dedupe hash, `received_on` and a domain (or `(unreadable)`), kept for the retention window; the readout is domain and count. Why a row and not a per-domain counter: a counter cannot tell a re-poll from a new message, so every poll would inflate it; the hash row makes the count idempotent and nothing in it identifies the message, its subject or its sender's local part. A sender domain that is not hostname-shaped is `(unreadable)`, so the table never stores attacker-chosen text.
12. **Attribution, re-attribution and a quiet person with no user.** Default: as Conventions. Re-attribution after an address edit covers only retained, not-yet-matched messages and only moves `unmatched`, `none_found` and `ambiguous` to `matched`; it never reassigns a matched one. A member with no b8 user (the household member who does not use b8) is attributed like any other, and the page shows every member's health to both users; their alerts go nowhere in this task (42g).
13. **Is the real IMAP adapter tested against a fake server?** Default: partly, and the rest is explicitly unverified. No pure-JS IMAP server is installed and adding one is out of scope, and a hand-written protocol fake would test the fake. What is exercised: (a) the pure configuration and its password-free view (U7); (b) the real adapter's connection path against a loopback port that was just bound and closed, which yields `connect_failed` deterministically with no password, host or library text in the result or in any log (T42c1-I11); (c) a source check that the adapter requests a read-only open and contains no write verb (command 13); (d) the strict-proxy fake in every other test, which proves the poller never calls anything but list, fetch and close. **Unverified and left for the owner's first real run:** LOGIN, SELECT, the date-filtered search, the envelope's `From` mapping, INTERNALDATE to `receivedAt`, the fetch of a message's bytes, and a real server's TLS handshake. The page's "Check inbox now" and the `Last check` line are the owner's way to see that run succeed.
14. **Where editors live.** Default: sender domains through the existing `PATCH /api/v1/loyalty/programs/[id]` (field `senderDomains`, the complete new list), forwarding addresses through the existing `PATCH /api/v1/loyalty/members/[id]` (field `forwardingAddresses`, the complete new list), the readout in the existing overview. Why: no new route beyond the poll, one atomic replace each like the aliases, and the loyalty route count rises by exactly one.
15. **Gift-surface classes.** Default: the new route `app/api/v1/loyalty/inbox/poll/route.ts` is `no-transaction-data` (it reads the environment and the five inbox tables, no ledger row, and mail text is not a ledger row). `app/travel/page.tsx` stays `numeric-only` and `app/api/v1/loyalty/route.ts` stays `numeric-only` (unchanged: they already carry fee dates and estimates derived from ledger rows, and the inbox panel adds none, so the answer is still identical for every viewer). The two PATCH routes stay `no-transaction-data`. No page is added; `/accounts/[id]` is untouched. Exactly one registry line is added and none changes (command 12).
16. **Oversize.** Default: 5242880 bytes. A larger message is recorded (so it is not re-listed and re-skipped forever) without its bytes. Why a cap at all: a statement with large inline images can be many megabytes and the table holds bytes for 30 days.
17. **Where exact fixtures live.** Default: one fabricated directory pinned by hash, loaded by the tests and the surface script. Why: the cases (look-alike domains, forwarded shapes) are exactly the kind an implementer could shape to its parser; a pinned directory it cannot edit stops that.

## Scenarios
Fixture canary `ZQ42C`. Every date offset is computed by Postgres (`SELECT (CURRENT_DATE + n)::text`), never the JS clock. Each integration test seeds what it asserts on, builds its mail from the pinned directory, injects the strict-proxy fake source by mocking `createMailSource`, resets `loyalty_inbox_state` and removes every row it created (programs and members named `ZQ42C …`, their domains, addresses, messages and unknown rows). Each test sets the seven `LOYALTY_IMAP_` variables itself, restores the previous environment afterwards, and uses only values whose host is `127.0.0.1` or a `.test` name; no test opens a non-loopback socket. No scenario reads the dev database. Group assertions end with `expect(seen).toEqual(<ids from cases.json>)`.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42c1-U1 | The contract accepts and refuses exactly the described shapes. | `LoyaltyProgramPatchRequestSchema` with `senderDomains` (accepts every `domainAccept` input, refuses every `domainRefuse` input, accepts `[]`, refuses 21 entries and a repeated entry, refuses a stray key) and `LoyaltyMemberPatchRequestSchema` with `forwardingAddresses` (the same with `addressAccept` and `addressRefuse`, 11 entries); `LoyaltyOverviewSchema` accepts a fixture `inbox` for every state (`not_set_up`, `no_mail_yet`, `ok`, `quiet`, `lastCheck` null, ok and error) and refuses a missing `inbox`, an `inbox` with a stray key, a `missing` entry that is not an environment variable name, `quietDays` for `not_set_up`, a missing `quietDays` for `quiet`, a negative count; `LoyaltyInboxPollResponseSchema` accepts the four outcomes with their counts and refuses an `errorCode` with outcome `ok`, a missing count, a stray key (`subject`, `body`, `raw`), a negative or fractional count; `LoyaltyErrorCodeSchema` accepts the nine old codes and the two new; the six constants equal 30, 45, 5242880, 20, 10, 20. Ids asserted with `seen`. | A schema that lets a body or password key through, an unbounded list, a state that contradicts its fields, a renamed constant. |
| T42c1-U2 | The domain rules: validation, the match rule and look-alikes. | `lib/domain/loyaltyInbox.ts` over `cases.json`: every `domainAccept` and `domainRefuse` input; the match function against stored `zq42c-brand.test` accepts `zq42c-brand.test`, `mail.zq42c-brand.test`, `a.b.zq42c-brand.test`, `ZQ42C-BRAND.TEST`, and refuses `zq42c-brand.test.attacker.test`, `notzq42c-brand.test`, `xzq42c-brand.test`, `zq42c-brand.test.`, `zq42c-brand.tes`, `attacker.test`, `zq42c-brand.test@attacker.test`, an empty domain, a non-ASCII domain and a punycode lookalike; with two stored domains `zq42c-brand.test` and `mail.zq42c-brand.test` for different programs, `x.mail.zq42c-brand.test` picks the longer one. | Substring or suffix-without-dot matching, case sensitivity, a bare public suffix or shared provider accepted, a first-match instead of longest-match. |
| T42c1-U3 | The sender is read from the right header and unreadable senders are classified. | The pure parser over F01 to F07, F18, F19, F24, F25: the sender domain of each is as the fixture table says; F05 and F06 give `attacker.test`; F07 gives `attacker.test` although `Reply-To`, `Return-Path` and `Sender` name the brand; F18, F19 and F24 are unreadable; F25 is lower-cased. A fabricated `From` whose domain holds markup (`a@<b>zq42c</b>.test`) is unreadable. | A display-name or header spoof accepted, a two-mailbox `From` read as its first address, markup stored as a domain. |
| T42c1-U4 | Forward recovery: origin, precedence and the member-only rule. | The pure parser over F08, F09, F10, F14, F26, F27 with the registered-address set `{zq42c-anna@example.com, zq42c-boris@example.net}`: F08 `attachment` with brand; F09 and F26 `inline` with brand (F26 through the `> ` quote prefix and `Begin forwarded message:`); F14 `attachment`; F10 is `direct` with the outer domain `example.org` (not honoured); F27 `attachment` with `attacker.test`. The same F08 with an empty registered set is `direct` with `example.com`. A marker with no `From:` within 12 lines falls through to `direct`. | An attachment or inline original honoured from a stranger, a quoted forward missed, a forward that falls through the wrong rule. |
| T42c1-U5 | Attribution tiers and outcomes. | The pure attribution over F01, F08, F09, F11, F12, F13, F14, F15, F16, F25, F26 with the same registered set: the outcomes are as the fixture table says; F14 is B although the outer headers name A (tier 1 over tiers 2 to 5); F15 is B from the oldest `Received` (tier 3); F13 is `ambiguous` with no member; F11 is `unmatched`; F12 is `none_found`; adding `zq42c-inbox@example.net` as a member address in a fabricated set makes F11 `matched`. | A reversed tier order, a non-member address stopping the walk, a guess on ambiguity. |
| T42c1-U6 | The page wording and its controls have one home each. | Source checks (TypeScript AST, as `loyaltyCardUi.test.ts` does) over `apps/web/components`, `apps/web/app/travel` and `apps/web/app/accounts/[id]/page.tsx`: each fixed string of "Visible text" occurs in a non-test component source; `Check inbox now` is rendered only under a condition on `configured`; the components import no `imapflow`, `mailparser`, `@/lib/db` or `db`, contain no `FROM transactions`, `raw_mail`, `LOYALTY_IMAP_PASSWORD`, `process.env`, `dangerouslySetInnerHTML`; the poll is sent from exactly one handler attached to the element holding `Check inbox now` and the edits from two handlers on `Edit sender domains` and `Edit forwarding addresses`. Fabricated violating sources are fed to each checker and must be rejected (an `innerHTML` use, a second poll sender, a missing phrase, a `process.env` read); a clean source is accepted. | A page that reads the environment or the ledger, markup injection of a sender domain, a second poll path, a missing wording. |
| T42c1-U7 | The environment parse is exact and the password-free view holds no secret. | `readInboxConfig` and `describeInboxConfig` over `envMatrix`: every row's `configured`, `problem` and `missing`; `JSON.stringify` of the described view of an environment holding the canary password, host and user contains none of them; the mailbox defaults to `INBOX` and the timeout to 60. | A plaintext-TLS or bad port accepted, a partial configuration treated as ready, a password in a view. |
| T42c1-I1 | Disabled, incomplete and ready, and the daily job. | `GET /api/v1/loyalty` with the environment unset gives `inbox.configured` false, `problem` `unset`, `missing` the five names; with only the password set `incomplete`; the poll route answers 200 `outcome: 'disabled'` with six zero counts and writes nothing (`loyalty_inbox_state` untouched, no row anywhere). `runDailyJob()` with every other step module mocked and the environment unset resolves, `runLoyaltyInboxDaily` ran once and wrote nothing; with a fake source that rejects with an error whose message contains the password canary, `runDailyJob()` still resolves and the mocked digest step is still called after it (order: after the syncs, before the digest). Neither the response bodies nor every captured log line contain the password canary. | A poller that errors the job when unconfigured, a step that stops the digest, a secret in a log. |
| T42c1-I2 | The allowlist, over the whole fixture set, end to end. | Create programs `ZQ42C Stays` (domain `zq42c-brand.test`) and `ZQ42C Air` (`zq42c-air.test`), members A and B with their addresses; one poll over F01 to F27 (the fake ignores the since filter and lists them in file order). Asserts the **totals of the full poll** exactly (counts, unknown by domain, stored by program and attribution, unattributed 3), each stored row's `sender_domain`, `origin`, `attribution`, `member_id` per the fixture table, the downloaded-id set equals the 14 listed (the strict fake records every fetch), no row for F03 to F07, F10, F17 to F22, F24. A generated oversize message from brand (one byte over the cap) is stored with `oversize` true, `raw_mail` null and counted `oversize` 1, and is never fetched. A generated message whose `From` holds markup is counted under `(unreadable)`. The stored raw bytes of F01 equal the file's bytes after token replacement. | A substring match, a display-name or header spoof stored, an unknown message downloaded, a forwarded original from a stranger honoured, a stored row for an expired message. |
| T42c1-I3 | Idempotency, concurrency and failure release. | Poll twice: the second poll reports `stored` 0, `unknown` 0, `duplicates` 26 (every key known, no fetch at all) and the row counts and unknown counts are unchanged. Two overlapping polls through the route with a fake source whose list waits on a gate: while the first is held, the second answers 200 `already_running` with zero counts; after release the first stored its messages and a third poll stores nothing more; exactly one row per key. A source that fails with each of an auth error, a TLS error, a connect error and a stall past a one-second timeout yields `outcome: 'error'` with the matching code, `loyalty_inbox_state.last_outcome` `error`, the lock released (the next poll runs), and no log line or body containing the error's own text (the fake's message holds the password canary and the body canary). The strict fake received only list, fetch and close calls in every test. Row counts for F17 prove F01's bytes were kept. | A double store, a double count of unknowns on re-poll, a lock never released, a library error text returned, a write to the mailbox. |
| T42c1-I4 | Attribution through real stores and re-attribution. | After I2's poll, the overview's `inbox.unattributed` is 3 and `forwarding` shows A with last mail `CURRENT_DATE - 2` and B `CURRENT_DATE - 6`. `PATCH /api/v1/loyalty/members/[id]` of B to add `zq42c-inbox@example.net` re-attributes F11 to B (its `attribution` `matched`, `last_received_on` of B moves forward only if F11's date is later, here it is not: B stays at `CURRENT_DATE - 6`), leaves F12 `none_found` and F13 `ambiguous`, never changes a `matched` row, and `unattributed` becomes 2. Removing an address never un-matches a stored message. The two members' `last_received_on` never move backward when an older message is stored afterwards. | An un-matched message left unattributed after the address is added, a matched message reassigned, a date rolled backward. |
| T42c1-I5 | Retention, relative to `CURRENT_DATE`. | Direct SQL rows (stored messages and unknown rows) with `received_on` of `CURRENT_DATE` minus 29, 30, 31 and 60: `purgeExpiredInbox()` deletes exactly the 31 and 60 rows (counts returned and verified by `SELECT`), keeps 29 and 30, in both tables; `last_seen_on`, `last_received_on`, domains, addresses and the state row are intact; running it again deletes nothing; the daily job's step and the end of an on-demand poll both purge (rows planted at 31 days are gone after either). A message re-listed by the fake after its purge and now outside the window is `expired` and not stored again. | An off-by-one retention (`<=`), deleting configuration or the durable dates, retention that depends on the job. |
| T42c1-I6 | Forwarding health at the threshold. | Members with addresses set by SQL: `last_received_on` of `CURRENT_DATE` minus 44, 45, 46 give `ok`, `ok`, `quiet` with `quietDays` 44, 45, 46; no `last_received_on` and `added_on` of 45 and 46 days ago give `no_mail_yet` and `quiet`; no address gives `not_set_up` with `quietDays` null; a member whose only mail is unattributed is not helped by it (state follows `added_on`). The page and the API agree. | `>=` for `>`, a null shown as quiet or as zero days, unattributed mail counted as a member's. |
| T42c1-I7 | Coverage and unknown senders, null and zero. | After I2's poll: brand `lastSeenOn` `CURRENT_DATE - 2` and 12 in the window; air 20 days back and 1; a program with a domain and no mail shows `lastSeenOn` null and 0 (not a date, not absent); `unknownSenders` is domain and count only, ordered by count then domain, capped at 20 (a generated 25 distinct unknown domains return 20 entries and a total of all rows); an older message later stored for brand does not move `lastSeenOn` back; the unknown rows outside the window are not counted. | A "last seen" that rolls back, an uncapped list, a `0` that should be null, a missing zero. |
| T42c1-I8 | Privacy: no raw body, no password, anywhere. | With the password canary in the environment and every fixture stored, collect the body of `GET /api/v1/loyalty`, every loyalty route's responses to its valid and invalid requests (including the PATCHes and the poll in each outcome) and every captured log line (console and logger) across the whole test file; none contains the body canary, the subject canary, the member-number canary, the password, the user or the host of the environment. The overview's `inbox` key set and every nested key set equal the contract's exactly. A grep of the HTML the page component renders from that overview (server-render of `TravelBoard` text) holds none of them. | A raw body or subject in a response, a password in a log, an `inbox` with an extra key. |
| T42c1-I9 | The editors: validation, atomicity, uniqueness, auth. | `senderDomains` through the program PATCH: every `domainAccept` stores the normalised value (read back from the overview and the table), every `domainRefuse` answers 400 `INVALID_INPUT` and changes nothing, the error message echoes none of the input; a list whose third entry is invalid changes nothing (atomic); a domain held by another program answers 409 `DOMAIN_TAKEN` and the old list stays; `[]` clears; the same for `forwardingAddresses` with `addressAccept`, `addressRefuse` and 409 `ADDRESS_TAKEN`. A read-scope bearer token PATCHing either answers 403 `INSUFFICIENT_SCOPE` and changes nothing; no session answers 401; a second b8 user and the owner see identical `inbox`. Direct SQL: the database refuses an upper-case domain, a domain with a space, a duplicate domain, an upper-case address and a duplicate address. | A shared provider accepted, a half-applied list, a 500 on a lost race, an echo of the input, a write by a read token. |
| T42c1-I10 | The route: shape, auth and ledger neutrality. | The poll route with a read-scope token answers 403 `INSUFFICIENT_SCOPE` and does nothing; with no session 401; with a valid session and a configured environment and the fake, a 200 body that parses against `LoyaltyInboxPollResponseSchema` for each outcome. `computeCurrentNetWorth`, the ledger overview response and row checksums of `accounts`, `transactions`, `budget_categories` and `transfer_groups` are identical before and after a full poll, a purge and an edit. The loyalty route files number 12 and the new one is classified `no-transaction-data`. | A write to the ledger, a read-scope poll, a body that leaks a count of the wrong kind. |
| T42c1-I11 | The real adapter's connection path, deterministically, over loopback. | Bind a listener on `127.0.0.1` port 0, note the port, close it, set the environment to that host and port with TLS `true` and the canary user and password, and call `pollLoyaltyInbox` without mocking `createMailSource`: the outcome is `error` with code `connect_failed` within the timeout, `loyalty_inbox_state` records `error`, the lock is released, and neither the result, the stored state nor any captured log line contains the canary password, user, the host or any text from the library's error. The adapter source requests a read-only open (command 13 is the static half of this). | A real adapter that leaks credentials in its failure, a hang with the lock held, an adapter that cannot be constructed. |
| T42c1-I12 | Nothing derived is stored, and the table shapes hold. | After I2's poll: for every stored row the non-null columns are exactly the allowed set (`dedupe_key` is 64 hex and not any Message-ID's text; `sender_domain` hostname-shaped); the five tables' column lists equal the contract; no unknown row's domain is outside hostname shape or `(unreadable)`; the checksum of `loyalty_programs`, `household_members` and the loyalty ledger-side tables (`loyalty_memberships`, `loyalty_observations`, `loyalty_instruments`, `loyalty_earn_rules`) is unchanged by polls, purges and edits (nothing but the five inbox tables and, through the editors, the two named columns moves). | A stored subject or snippet, a poll that edits a membership, a balance or a program. |
| T42c1-H14 | Over real HTTP, the page and the API show the wording and leak nothing. | In `gifts-surface-check.mjs`, after H13, on its scratch database: the server is spawned with every inherited `LOYALTY_IMAP_` variable removed and then set to `LOYALTY_IMAP_HOST=127.0.0.1`, a port the script obtained by binding port 0 and closing the listener, `LOYALTY_IMAP_TLS=true`, and the canary user and password from `cases.json`. Seed by SQL: a fixture program with a domain, a member with an address, one stored message whose `raw_mail` bytes are the body canary, two unknown rows for one domain and one for another, a member whose `last_received_on` is 46 days back. For the owner and the second user: `/travel` holds `Loyalty inbox`, `Check inbox now`, `Not checked yet`, `Mail from unknown senders: 3`, the domain lines, `forwarding quiet for 46 days`, `Last mail seen: `, `Raw mail is kept 30 days, then deleted.`; `POST /api/v1/loyalty/inbox/poll` with the owner's cookie answers 200 `outcome: 'error'`, `errorCode: 'connect_failed'` and with no cookie 401; after it `/travel` holds `Last check: ` and `failed (connect_failed)`; across every response of the step, `/travel`, the API and the poll bodies hold none of the body canary, the password, the user or the loopback host. The step prints `H14 PASS …` and the final line becomes `OK H1-H14`. The classes of `/travel` and the loyalty routes are unchanged. | A page that does not render the inbox panel, a leak of the body or password over HTTP, a poll route without auth, a stale readout. |

## Acceptance commands

**Amendment A3 (orchestrator, at G2, 2026-11-21).** Reported by the implementer, not absorbed:
1. **Command 13's `PW` and `RM` source lists matched the pinned fixtures.** `cases.json`'s `envMatrix` names `LOYALTY_IMAP_PASSWORD`, and neither file may change. Both lists now exclude `/fixtures/`.
2. **Command 13's error-text guard missed a cast form.** `(err as Error).message` slipped past it (mutation B5, caught by the tests instead). The pattern now also refuses `).message`. The task's new sources contain none.
3. **Command 14 required `.env.local.example` to be in the change set.** It cannot be: `.gitignore:40` (`.env*`) ignores it, and it has never been tracked, so it is a local-only file like ROADMAP.md. It is dropped from #14's must-exist list. Command 17 still checks its content locally. The variable names' tracked home is this spec (OQ2) and the setup text on `/travel`. Whether to commit an env example is the owner's decision, outside this task.
4. **T42c1-I3 and F16.** F16 has no `Message-ID`, so a re-poll must download it again before it can recognise it. I3's "no fetch at all" reads "no fetch except F16": the second poll fetches exactly `['F16']`, stores nothing, and counts it a duplicate. A never-downloaded message with no `Message-ID` is keyed by the sha256 of its envelope id, received time and size. Both are accepted interpretations.
5. **T42b2-U2's overview fixture** (`packages/contracts/loyalty.test.ts`) gains `inbox`, the same kind of edit command 15's allowance names. Command 15 accepts it, and it is ratified here.
6. **The spec's own money-like scan counts `2`.** Both hits are A1's version numbers, which AGENTS.md allows.

**Amendment A2 (orchestrator, at G1, 2026-11-21).**
1. **A1's seed broke its own UNIQUE.** `hawaiianairlines.com` was listed under both Atmos Rewards and HawaiianMiles, and `loyalty_sender_domains.domain` is unique. Raised by the guardian, which seeded it once, under HawaiianMiles. The table row for Atmos Rewards now reads `alaskaair.com` only.
2. **Command 5's "programs without a domain" counts included fabricated programs.** P8-42a's import end-to-end regression (run by command 10) leaves six `ZQ42A …` programs in the throwaway DB, so the seed check returned `6` while every real catalog program was seeded. The seed check now skips names starting `ZQ`; every fabricated fixture name does. The migration-survival check counts real programs plus its own `ZQ42C Mig Stays` row, so it still expects `1`.
3. **Accepted guardian clarifications.** `quietDays` is never negative: the producer computes `GREATEST(0, CURRENT_DATE - reference)` in SQL, because `received_on` is a UTC date and `CURRENT_DATE` follows the session zone. An oversize message counts as `stored`, without its bytes, and T42c1-I2 or I10 pins that.

**Amendment A1 (orchestrator, at G0, 2026-11-21).** Two drafted placeholders are now fixed:

1. **Versions.** Command 4's literals are now values the orchestrator measured on the npm registry. The newest release of each package was published the day before G0, so each is pinned to its newest release at least two weeks old, as a supply-chain precaution: `imapflow` 2.11.0 and `mailparser` 3.14.2, both MIT. `mailparser` 3.14.2 ships its own types (`types: ./dist/cjs/index.d.ts`), so `@types/mailparser` is not installed (`TV="NONE"`). Install them with `npm install --save-exact imapflow@2.11.0 mailparser@3.14.2 -w @b8/web`.
2. **Seeded sender domains.** OQ7's "taken by the implementer from that company's own public website" is replaced, because the implementer has no web access and would be guessing. The seed is exactly the table below, one row per catalog program. The orchestrator checked it against the throwaway DB's catalog (51 programs, every name present, none missing). Each entry is the program's primary public mail domain as the orchestrator knows it on 2026-11-21. Subdomains match under OQ6, so `email.<domain>` senders need no extra row. This is a starting point, editable on `/travel`, and the unknown-sender readout is how the household learns the rest. The migration header says the list was written on 2026-11-21 and is editable. The OQ7 anchors are a subset of this table.

| Program (catalog name) | Seeded sender domains |
|---|---|
| AAdvantage | aa.com |
| Atmos Rewards | alaskaair.com |
| Delta SkyMiles | delta.com |
| United MileagePlus | united.com |
| Southwest Rapid Rewards | southwest.com |
| JetBlue TrueBlue | jetblue.com |
| HawaiianMiles | hawaiianairlines.com |
| Frontier Miles | flyfrontier.com |
| Spirit Free Spirit | spirit.com |
| Sun Country Rewards | suncountry.com |
| Emirates Skywards | emirates.com |
| Miles & More | miles-and-more.com, lufthansa.com |
| Miles&Smiles | turkishairlines.com |
| Iberia Club | iberia.com |
| ITA Airways Volare | ita-airways.com |
| British Airways Club | britishairways.com, ba.com |
| Flying Blue | flyingblue.com, airfrance.com, klm.com |
| Qatar Airways Privilege Club | qatarairways.com |
| Singapore Airlines KrisFlyer | singaporeair.com |
| Aeroplan | aircanada.com, aeroplan.com |
| Virgin Atlantic Flying Club | virginatlantic.com |
| Cathay | cathaypacific.com |
| ANA Mileage Club | ana.co.jp |
| Etihad Guest | etihad.com |
| LifeMiles | lifemiles.com, avianca.com |
| Aer Lingus AerClub | aerlingus.com |
| JAL Mileage Bank | jal.com, jal.co.jp |
| Korean Air SKYPASS | koreanair.com |
| Qantas Frequent Flyer | qantas.com, qantas.com.au |
| Copa ConnectMiles | copaair.com |
| Marriott Bonvoy | marriott.com |
| Hilton Honors | hilton.com |
| World of Hyatt | hyatt.com |
| IHG One Rewards | ihg.com |
| Best Western Rewards | bestwestern.com |
| Wyndham Rewards | wyndhamhotels.com |
| Choice Privileges | choicehotels.com |
| ALL Accor | accor.com |
| Radisson Rewards | radissonhotels.com |
| Sonesta Travel Pass | sonesta.com |
| GHA DISCOVERY | ghadiscovery.com |
| Chase Ultimate Rewards | chase.com |
| American Express Membership Rewards | americanexpress.com |
| Citi ThankYou Rewards | citi.com |
| Capital One Miles | capitalone.com |
| Bilt Rewards | biltrewards.com |
| Wells Fargo Rewards | wellsfargo.com |
| One Key | expedia.com, hotels.com, vrbo.com |
| Ford Rewards | ford.com |
| GM Rewards | gm.com |
| Toyota Rewards | toyota.com |

All run from the repo root under `bash`. `U=postgresql://localhost/b8_p42a_throwaway`. Dates come from Postgres inside the tests, never the wall clock. No command uses a leading `!` as a guard (T15); absence is asserted with `if … then …; exit 1; fi` or an explicit string comparison. No command puts a double-quoted `{a,b}` brace pattern inside `"$( … )"` (macOS `/bin/bash` 3.2 brace-expands it); patterns with braces or commas are kept in a variable. Every scan of source is scoped to this task's own files or to lines this task adds, and each passes on the unmodified tree for files it does not change (P8-42b A2, P8-42b2 A2). Three literals are replaced by the orchestrator before G0 freezes: `IMAPFLOW_VERSION_PENDING`, `MAILPARSER_VERSION_PENDING`, `TYPES_MAILPARSER_VERSION_PENDING` (command 4; `NONE` when no types package is needed) and one, `INBOX_FIXTURE_SHA_PENDING` (command 16). Run order: 1 to 3, then 4, then 5 (brings `$U` to the new head), then the rest.

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | the required `inbox` key or the two new error codes break a consumer |
| 2 | Lint, below | `OK lint 0 errors, warnings not above 5` | a lint regression |
| 3 | Unit totals, below | `OK unit 108 files 1421 tests` | a missing or extra new test, a broken existing test |
| 4 | Dependencies, below | `OK dependencies` | a range instead of an exact version, a wrong or extra package, a package imported from a client file, a missing lockfile entry |
| 5 | Migration shape, seeds, refusals, down/up, below | `OK migration up-down-up` | a wrong column, a missing CHECK, a catalog program with no domain, a shared-provider seed, a `down` that harms the earlier tables |
| 6 | Stored-state schema check, below | `OK schema` | a stored body-derived column, a sixth table, a `schema.sql` out of step |
| 7 | New unit scenarios, below | two lines `OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=<zone>` | a missing or duplicated scenario, a zone-dependent result |
| 8 | Integration scenarios, below | `OK 356 tests, … T42c1-I1-I12 each present once and passed`, then `OK no fixture rows left` | any new rule fails, an old scenario regresses, a leftover row, a failing title outside KNOWN |
| 9 | Integration stability (P8-42b2 #8, unchanged), below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 10 | Regression: P8-42b2 #9 and the fixture-shape part of #15, extracted with prefix guards, below | the eleven OK lines of P8-42b2 #9 and `fixture shape ok` | the member-number, mask, reducer, clear-control or import guarantees disturbed, the earn fixture edited |
| 11 | Surface script over real HTTP, below | `H1 PASS` to `H14 PASS` each once, last line `OK H1-H14`, then `OK surface` | a leak, wording missing, a stale readout, an unauthenticated poll |
| 12 | Registry and script classes, below | `OK classes`, then `OK one registry line added, none changed` | a class changed, the new route unclassified or classified wrongly |
| 13 | Source guards for this task, below | `OK task source guards` | a raw ledger read, a JS clock, a write verb on the mailbox, a password or raw body in a place it must not be, an unguarded import |
| 14 | Scope guard, below | no output | a file outside the allowed set changed, a required file missing, an applied migration edited |
| 15 | Existing-test edit guard and census, below | `OK existing tests edited only as allowed; removed lines <n>` and no other output | a weakened existing test, a missing or extra new test title |
| 16 | Fixtures pinned and covered, below | `OK fixtures pinned and covered` | an edited fixture, a real-looking address, a figure, a case group the tests never read |
| 17 | `.env.local.example` check, below | `OK env example` | a missing, duplicated or non-empty variable |
| 18 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error (including a server-only package pulled into a client bundle) |

**#2 (lint).**
```
set -e; O="$(mktemp)"; npm run lint > "$O" 2>&1 || true; tail -4 "$O"
if grep -qE '[1-9][0-9]* errors?' "$O"; then echo "FAIL lint reports errors"; exit 1; fi
W="$(grep -oE '[0-9]+ warnings?' "$O" | tail -1 | grep -oE '^[0-9]+' || true)"
[ "${W:-0}" -le 5 ]
echo "OK lint 0 errors, warnings not above 5"
```

**#3 (unit totals).** The new unit tests are `T42c1-U1` (added to an existing file) and `T42c1-U2` to `U7` in three new files, so the totals rise by three files and seven tests.
```
set -e; O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +108 passed \(108\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1421 passed \(1421\)' "$O")" = 1 ]
echo "OK unit 108 files 1421 tests"
```

**#4 (dependencies).** Replace the three `…_PENDING` literals with the T17 measurements.
```
set -e; B="$(git merge-base HEAD main)"
IV="2.11.0"; MV="3.14.2"; TV="NONE"
git show "$B:apps/web/package.json" > "$(mktemp -d)/old.json" 2>/dev/null || true
OLD="$(mktemp)"; git show "$B:apps/web/package.json" > "$OLD"
node -e '
const fs=require("fs");const [oldf,newf,lockf,iv,mv,tv]=process.argv.slice(1);
const o=JSON.parse(fs.readFileSync(oldf,"utf8")),n=JSON.parse(fs.readFileSync(newf,"utf8")),l=JSON.parse(fs.readFileSync(lockf,"utf8"));
const bad=[];const OK=/^(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2.0)$/;
const add=(k)=>Object.keys(n[k]||{}).filter(x=>!(o[k]||{})[x]);
const addedDeps=add("dependencies").sort().join(","),addedDev=add("devDependencies").sort().join(",");
if(addedDeps!=="imapflow,mailparser")bad.push("added dependencies "+addedDeps);
if(!(addedDev===""||addedDev==="@types/mailparser"))bad.push("added devDependencies "+addedDev);
if((addedDev==="@types/mailparser")!==(tv!=="NONE"))bad.push("types package and literal disagree");
for(const k of ["dependencies","devDependencies"])for(const x of Object.keys(o[k]||{}))if(JSON.stringify((n[k]||{})[x])!==JSON.stringify(o[k][x]))bad.push("changed "+k+" "+x);
const want=[["dependencies","imapflow",iv],["dependencies","mailparser",mv]];if(tv!=="NONE")want.push(["devDependencies","@types/mailparser",tv]);
for(const [k,name,v] of want){
  if(!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v))bad.push(name+" literal "+v+" is not an exact version");
  if((n[k]||{})[name]!==v)bad.push(name+" in "+k+" is "+(n[k]||{})[name]+" not "+v);
  const e=l.packages&&l.packages["node_modules/"+name];if(!e||e.version!==v)bad.push(name+" lockfile version "+(e&&e.version));
  const m=JSON.parse(fs.readFileSync("node_modules/"+name+"/package.json","utf8"));
  if(m.version!==v)bad.push(name+" installed "+m.version);
  if(k==="dependencies"&&!OK.test(String(m.license)))bad.push(name+" licence "+m.license);
}
if(bad.length){console.log("FAIL dependencies:",bad.join(" | "));process.exit(1)}
console.log("package files ok")' "$OLD" apps/web/package.json package-lock.json "$IV" "$MV" "$TV"
IMP="$(grep -rlE "from 'imapflow'|from \"imapflow\"|require\('imapflow'\)|import\('imapflow'\)" apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$' | sort | tr '\n' ' ')"
[ "$IMP" = "apps/web/lib/loyaltyInboxSource.ts " ]
MIMP="$(grep -rlE "from 'mailparser'|from \"mailparser\"|require\('mailparser'\)|import\('mailparser'\)" apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$' | sort | tr '\n' ' ')"
[ "$MIMP" = "apps/web/lib/domain/loyaltyInbox.ts " ]
echo "OK dependencies"
```
The first `git show` line is a harmless leftover probe and may be deleted; the second writes `$OLD`. The set of added dependency names is asserted exactly, every pre-existing dependency is asserted unchanged, versions are exact (no `^` or `~`, a regular expression of three integers), the lockfile and the installed package agree, and the licence is permissive. The two import checks keep both packages server-only and in their one named file.

**#5 (migration: shape, seeds, refusals, down/up).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
MIG(){ DATABASE_URL="$U" npm run "$1" >/dev/null 2>&1; }
COLS(){ Q "SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\"), 'none') FROM information_schema.columns WHERE table_schema='public' AND table_name='$1'"; }
R(){ if Q "$1" 2>/dev/null; then echo "FAIL the database accepted: $1"; exit 1; fi; }
SHARED="'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','gmx.com','mail.com'"
RE_FAKE='(^|\.)(test|example|invalid|localhost)$|(^|\.)example\.(com|net|org)$'
MIG migrate:up
LATEST="$(Q "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1")"
if [[ "$LATEST" == 1792900000000_loyalty_earn_rules ]]; then echo "FAIL no migration newer than the earn-rules one"; exit 1; fi
[[ "$LATEST" > "1792900000000_loyalty_earn_rules" ]]
case "$LATEST" in *loyalty_inbox*) ;; *) echo "FAIL the migration name must contain loyalty_inbox"; exit 1;; esac
[ "$(COLS loyalty_sender_domains)" = "domain,id,last_seen_on,program_id" ]
[ "$(COLS household_member_addresses)" = "added_on,address,id,last_received_on,member_id" ]
[ "$(COLS loyalty_inbox_messages)" = "attribution,dedupe_key,id,member_id,origin,oversize,program_id,raw_mail,received_on,sender_domain,stored_on" ]
[ "$(COLS loyalty_inbox_unknown_senders)" = "dedupe_key,domain,received_on" ]
[ "$(COLS loyalty_inbox_state)" = "id,last_error_code,last_outcome,last_polled_on" ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_state")" = 1 ]
[ "$(Q "SELECT count(*) FROM loyalty_programs p WHERE p.name NOT LIKE 'ZQ%' AND NOT EXISTS (SELECT 1 FROM loyalty_sender_domains d WHERE d.program_id = p.id)")" = 0 ]
[ "$(Q "SELECT count(*) FROM loyalty_sender_domains WHERE domain IN ($SHARED)")" = 0 ]
[ "$(Q "SELECT count(*) FROM loyalty_sender_domains WHERE domain ~ '$RE_FAKE'")" = 0 ]
for pair in 'Marriott Bonvoy|marriott.com' 'Hilton Honors|hilton.com' 'World of Hyatt|hyatt.com' 'Delta SkyMiles|delta.com' 'United MileagePlus|united.com' 'AAdvantage|aa.com' 'IHG One Rewards|ihg.com' 'Chase Ultimate Rewards|chase.com'; do
  P="${pair%%|*}"; D="${pair##*|}"
  [ "$(Q "SELECT count(*) FROM loyalty_sender_domains d JOIN loyalty_programs p ON p.id=d.program_id WHERE p.name='$P' AND d.domain='$D'")" = 1 ]
done
Q "INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42C Mig Stays', 'hotel', 'points')"
Q "INSERT INTO household_members (display_name) VALUES ('ZQ42C Mig')"
Q "INSERT INTO loyalty_sender_domains (program_id, domain) SELECT id, 'zq42c-mig.test' FROM loyalty_programs WHERE name='ZQ42C Mig Stays'"
Q "INSERT INTO household_member_addresses (member_id, address) SELECT id, 'zq42c-mig@example.com' FROM household_members WHERE display_name='ZQ42C Mig'"
MSEL="FROM loyalty_programs p, household_members m WHERE p.name='ZQ42C Mig Stays' AND m.display_name='ZQ42C Mig'"
MINS="INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail, oversize)"
Q "$MINS SELECT repeat('a',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'matched', m.id, '\\x5a'::bytea, FALSE $MSEL"
Q "$MINS SELECT repeat('9',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'inline', 'unmatched', NULL, NULL, TRUE $MSEL"
Q "INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES (repeat('b',64), CURRENT_DATE, 'attacker.test'), (repeat('f',64), CURRENT_DATE, '(unreadable)')"
D(){ R "INSERT INTO loyalty_sender_domains (program_id, domain) SELECT id, '$1' FROM loyalty_programs WHERE name='ZQ42C Mig Stays'"; }
D 'ZQ42C-Up.test'; D 'zq42cmig'; D 'zq42c mig.test'; D 'zq42c@mig.test'; D '.zq42c-mig2.test'; D 'zq42c-mig2.test.'; D '*.zq42c-mig2.test'; D 'zq42c-mig.test'
A(){ R "INSERT INTO household_member_addresses (member_id, address) SELECT id, '$1' FROM household_members WHERE display_name='ZQ42C Mig'"; }
A 'ZQ42C-Up@example.com'; A 'zq42c-noat'; A 'zq42c mig@example.com'; A 'zq42c-mig@example.com'
M(){ R "$MINS SELECT $1 $MSEL"; }
M "repeat('c',63), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', NULL, '\\x5a'::bytea, FALSE"
M "repeat('C',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', NULL, '\\x5a'::bytea, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'forward', 'unmatched', NULL, '\\x5a'::bytea, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'maybe', NULL, '\\x5a'::bytea, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'matched', NULL, '\\x5a'::bytea, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', m.id, '\\x5a'::bytea, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', NULL, NULL, FALSE"
M "repeat('c',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', NULL, '\\x5a'::bytea, TRUE"
M "repeat('c',64), CURRENT_DATE, p.id, 'Bad Domain', 'direct', 'unmatched', NULL, '\\x5a'::bytea, FALSE"
M "repeat('a',64), CURRENT_DATE, p.id, 'zq42c-mig.test', 'direct', 'unmatched', NULL, '\\x5a'::bytea, FALSE"
UK(){ R "INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES ($1)"; }
UK "repeat('d',64), CURRENT_DATE, 'Bad Domain'"; UK "repeat('e',63), CURRENT_DATE, 'attacker.test'"; UK "repeat('b',64), CURRENT_DATE, 'attacker.test'"
R "INSERT INTO loyalty_inbox_state (id) VALUES (2)"
R "UPDATE loyalty_inbox_state SET last_outcome = 'maybe'"
MIG migrate:down
for t in loyalty_sender_domains household_member_addresses loyalty_inbox_messages loyalty_inbox_unknown_senders loyalty_inbox_state; do
  [ "$(Q "SELECT coalesce(to_regclass('public.$t')::text, 'none')")" = none ]
done
[ "$(Q "SELECT to_regclass('public.loyalty_earn_rules') IS NOT NULL")" = t ]
[ "$(Q "SELECT count(*) FROM loyalty_programs WHERE name='ZQ42C Mig Stays'")" = 1 ]
[ "$(Q "SELECT count(*) FROM household_members WHERE display_name='ZQ42C Mig'")" = 1 ]
MIG migrate:up
[ "$(COLS loyalty_inbox_messages)" = "attribution,dedupe_key,id,member_id,origin,oversize,program_id,raw_mail,received_on,sender_domain,stored_on" ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_messages")" = 0 ]
[ "$(Q "SELECT count(*) FROM loyalty_inbox_state")" = 1 ]
[ "$(Q "SELECT count(*) FROM loyalty_programs p WHERE (p.name NOT LIKE 'ZQ%' OR p.name = 'ZQ42C Mig Stays') AND NOT EXISTS (SELECT 1 FROM loyalty_sender_domains d WHERE d.program_id = p.id)")" = 1 ]
Q "DELETE FROM loyalty_programs WHERE name='ZQ42C Mig Stays'"
Q "DELETE FROM household_members WHERE display_name='ZQ42C Mig'"
echo "OK migration up-down-up"
```
`R` is the absence assertion for the 33 rows and edits the database must refuse; under `set -e` it exits 1 if any is accepted (no leading `!`). The seed checks run before any fixture row is inserted (T14). After the `down` the earlier loyalty tables, including the earn rules, are untouched.

**#6 (stored-state schema check).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway
Q(){ psql "$U" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
[ "$(Q "SELECT string_agg(table_name, ',' ORDER BY table_name COLLATE \"C\") FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'loyalty%' OR table_name LIKE 'household%')")" = "household_member_addresses,household_members,loyalty_earn_rules,loyalty_inbox_messages,loyalty_inbox_state,loyalty_inbox_unknown_senders,loyalty_instruments,loyalty_memberships,loyalty_observations,loyalty_program_aliases,loyalty_programs,loyalty_sender_domains" ]
FORBID='subject|body|snippet|content|header|text|from|local|recipient|member_number|balance|amount|password|secret|token|estimate|parsed|extract'
[ "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('loyalty_sender_domains','household_member_addresses','loyalty_inbox_messages','loyalty_inbox_unknown_senders','loyalty_inbox_state') AND column_name ~* '$FORBID'")" = 0 ]
[ "$(Q "SELECT string_agg(column_name, ',' ORDER BY column_name COLLATE \"C\") FROM information_schema.columns WHERE table_schema='public' AND table_name='loyalty_memberships'")" = "benefit_description,benefit_kind,benefit_window_days,card_account_id,created_at,earn_base_rate,id,member_id,member_number,program_id,tier" ]
RE_D='\("?domain"?\)'; RE_A='\("?address"?\)'; RE_K='\("?dedupe_key"?\)'
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_sender_domains' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_D'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='household_member_addresses' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_A'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_inbox_messages' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_K'")" = 1 ]
[ "$(Q "SELECT count(*) FROM pg_indexes WHERE tablename='loyalty_inbox_unknown_senders' AND indexdef ILIKE '%UNIQUE%' AND indexdef ~* '$RE_K'")" = 1 ]
[ "$(Q "SELECT confdeltype FROM pg_constraint WHERE conrelid='loyalty_sender_domains'::regclass AND contype='f'")" = c ]
[ "$(Q "SELECT confdeltype FROM pg_constraint WHERE conrelid='household_member_addresses'::regclass AND contype='f'")" = c ]
[ "$(Q "SELECT string_agg(confdeltype::text, ',') FROM pg_constraint WHERE conrelid='loyalty_inbox_messages'::regclass AND contype='f'")" = "a,a" ]
for t in loyalty_sender_domains household_member_addresses loyalty_inbox_messages loyalty_inbox_unknown_senders loyalty_inbox_state; do
  B="$(awk -v t="$t" '$0 ~ "^CREATE TABLE (IF NOT EXISTS )?" t "[ (]" {f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
  [ -n "$B" ] || { echo "FAIL db/schema.sql lacks $t"; exit 1; }
done
RB="$(awk '/^CREATE TABLE (IF NOT EXISTS )?loyalty_inbox_messages/{f=1} f{print} f&&/^\);/{exit}' db/schema.sql)"
for c in dedupe_key received_on sender_domain origin attribution raw_mail oversize; do printf '%s\n' "$RB" | grep -q "$c" || { echo "FAIL schema.sql messages lacks $c"; exit 1; }; done
if git ls-files migrations | xargs grep -ln 'loyalty_inbox_messages\|loyalty_sender_domains\|household_member_addresses' | grep -v '_loyalty_inbox' | grep -q .; then echo "FAIL inbox schema written in an old migration"; exit 1; fi
echo "OK schema"
```
The pre-existing P8-42b2 expectation of an exact loyalty table list is superseded by the first line here (the table list now has twelve names).

**#7 (new unit scenarios; two zones).**
```
set -e; for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run packages/contracts/loyalty.test.ts lib/domain/loyaltyInbox.test.ts lib/loyaltyInboxUi.test.ts lib/loyaltyInboxConfig.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3","U4","U5","U6","U7"]){const m=t.filter(x=>x.title.startsWith("T42c1-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||r.testResults.length!==4){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"files="+r.testResults.length);process.exit(1)}console.log("OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#8 (integration scenarios from one run; the cleanup check follows it).**
```
set -e; U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];const want=[];for(let i=1;i<=11;i++){want.push("T42a-C"+i+":","T42a-I"+i+":")}want.push("T42a2-I1:","T42a2-I2:","T42a2-I3:");for(let i=1;i<=10;i++)want.push("T42b-I"+i+":","T42b2-I"+i+":");for(let i=1;i<=12;i++)want.push("T42c1-I"+i+":");for(const p of want){const m=t.filter(x=>x.title.startsWith(p));if(m.length!==1||m[0].status!=="passed")bad.push(p+m.map(x=>x.status).join("/")+"("+m.length+")")}const KNOWN=["the pre-auth ceremony endpoints remain reachable with no session cookie at all","the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio"];const unexpected=t.filter(x=>x.status==="failed"&&!KNOWN.includes(x.title)&&!x.title.startsWith("RC-03:")).map(x=>x.title);if(unexpected.length||bad.length||t.length!==356){console.log("FAIL",unexpected.join(" ; "),bad.join(","),"total="+t.length);process.exit(1)}console.log("OK 356 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 each present once and passed")' "$O"
LEFT="$(psql "$U" -v ON_ERROR_STOP=1 -Atq -c "SELECT (SELECT count(*) FROM loyalty_programs WHERE name LIKE 'ZQ42C%')||','||(SELECT count(*) FROM household_members WHERE display_name LIKE 'ZQ42C%')||','||(SELECT count(*) FROM loyalty_inbox_messages)||','||(SELECT count(*) FROM loyalty_inbox_unknown_senders)||','||(SELECT count(*) FROM household_member_addresses)||','||(SELECT count(*) FROM loyalty_sender_domains WHERE domain LIKE '%zq42c%' OR domain LIKE '%attacker.test' OR domain LIKE '%other-sender.test')||','||(SELECT count(*) FROM loyalty_inbox_state WHERE last_polled_on IS NOT NULL OR last_outcome IS NOT NULL OR last_error_code IS NOT NULL)")"
[ "$LEFT" = "0,0,0,0,0,0,0" ]
echo "OK no fixture rows left"
```
`T42c1-I1:` does not start with `T42c1-I10:`, because of the colon, so each id is counted once.

**#9 (integration stability; P8-42b2 #8, unchanged).**
```
set -e; S2=plan/tasks/P8-42a2-loyalty-nits/SPEC.md
G(){ case "$(sed -n "${2}p" "$1")" in "$3"*) ;; *) echo "FAIL $1 line $2 moved"; exit 1;; esac; }
G "$S2" 153 "set -e; S=plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md; case \"\$(sed -n '228p'"
bash -c "$(sed -n '153p' "$S2")"
```

**#10 (regression: P8-42b2 #9 and #15's fixture-shape part, extracted by line range with prefix guards).** The P8-42b2 commands #4, #5, #10, #11 and #14 are not re-run (Existing state this task changes, item 6). #12's intent is re-asserted by command 13 and #7's by command 8.
```
set -e; S=plan/tasks/P8-42b2-card-earn-estimate/SPEC.md
case "$(sed -n '328p' "$S")" in 'set -e; S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md'*) ;; *) echo "FAIL $S line 328 moved"; exit 1;; esac
case "$(sed -n '336p' "$S")" in 'X 306 316 "$HEAD"'*) ;; *) echo "FAIL $S line 336 moved"; exit 1;; esac
RANGE="328,336"; BODY="$(sed -n "${RANGE}p" "$S")"; bash -c "$BODY"
case "$(sed -n '429p' "$S")" in 'set -e; F=apps/web/lib/fixtures/loyalty-earn-cases.json'*) ;; *) echo "FAIL $S line 429 moved"; exit 1;; esac
case "$(sed -n '441p' "$S")" in 'console.log("fixture shape ok")'"'"*) ;; *) echo "FAIL $S line 441 moved"; exit 1;; esac
RANGE="429,441"; BODY="$(sed -n "${RANGE}p" "$S")"; bash -c "$BODY"
```
Expected: the eleven OK lines of P8-42b2 #9 (two `OK 10 scenarios U1-U10 …`, two `OK 3 scenarios T42a2-U1..U3 …`, `OK as-of bound`, `OK failure class`, `OK import end to end`, `OK sidebar`, `OK source guards`, `OK fixtures fabricated`, `OK coarse source checks`), then `fixture shape ok`. Lines 429 to 441 cover the earn fixture's SHA-256 check and its shape check; they do not touch the merge-base diff.

**#11 (surface script over real HTTP).**
```
set -e; OUT="$(mktemp)"
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
node apps/web/scripts/gifts-surface-check.mjs > "$OUT"; cat "$OUT"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do [ "$(grep -cE "^H$i PASS " "$OUT")" = 1 ]; done
[ "$(tail -1 "$OUT")" = "OK H1-H14" ]
if grep -qE 'FAIL' "$OUT"; then echo "FAIL a step failed"; exit 1; fi
SRC=apps/web/scripts/gifts-surface-check.mjs
[ "$(grep -cE "LOYALTY_IMAP_(HOST|PORT|TLS|USER|PASSWORD)" "$SRC")" -ge 5 ]
echo "OK surface"
```
The script exits non-zero on any failing step. Port 3198 must be free (T9). The last guard asserts the script sets all five variables for the server it spawns, so it never inherits a real credential.

**#12 (registry and script classes).**
```
set -e; S=plan/tasks/P8-42b-card-annual-instruments/SPEC.md
case "$(sed -n '332p' "$S")" in 'set -e; R=apps/web/lib/giftSurfaceRegistry.ts; X=apps/web/scripts/gifts-surface-check.mjs'*) ;; *) echo "FAIL $S line 332 moved"; exit 1;; esac
[ "$(sed -n '340p' "$S")" = 'echo "OK classes"' ]
RANGE="332,340"; BODY="$(sed -n "${RANGE}p" "$S")"; bash -c "$BODY"
B="$(git merge-base HEAD main)"
D="$(git diff -U0 "$B" -- apps/web/lib/giftSurfaceRegistry.ts | grep -E '^[-+][^-+]' | grep -E "classes|cls:" || true)"
N="$(printf '%s\n' "$D" | tr -s ' ')"
[ "$N" = "+ { file: 'app/api/v1/loyalty/inbox/poll/route.ts', classes: ['no-transaction-data'] }," ]
if git diff -U0 "$B" -- apps/web/lib/giftSurfaceRegistry.ts | grep -E '^-[^-]' | grep -qE "classes|cls:"; then echo "FAIL a registry class line was removed or changed"; exit 1; fi
[ "$(grep -c "app/travel/page.tsx', classes: \['numeric-only'\]" apps/web/lib/giftSurfaceRegistry.ts)" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/route.ts', classes: \['numeric-only'\]" apps/web/lib/giftSurfaceRegistry.ts)" = 1 ]
echo "OK one registry line added, none changed"
```
The first block is P8-42b's class check (it printed `OK classes` on the unmodified tree, T12); this task adds one `ROUTES` line, the second block asserts it is exactly that line and nothing else changed. The registry's comments may change.

**#13 (source guards for this task; no `!`).**
```
set -e; B="$(git merge-base HEAD main)"; CH="$(mktemp)"; SRC="$(mktemp)"; SCOPE="$(mktemp)"; ADDED="$(mktemp)"
{ git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -E '^apps/web/(lib|components|app)/.*\.(ts|tsx)$' "$CH" | grep -vE '\.test\.ts$' > "$SRC" || true
while IFS= read -r f; do if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+transactions([^[:alnum:]_]|$)' "$f"; then echo "FAIL raw transactions read in $f"; exit 1; fi; done < "$SRC"
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
A=apps/web/lib/loyaltyInboxSource.ts; P=apps/web/lib/loyaltyInbox.ts; M=apps/web/lib/domain/loyaltyInbox.ts
for f in "$A" "$P" "$M" apps/web/app/api/v1/loyalty/inbox/poll/route.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/lib/domain/loyaltyInbox.test.ts apps/web/lib/loyaltyInboxUi.test.ts apps/web/lib/loyaltyInboxConfig.test.ts; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
grep -E '^apps/web/(lib/loyaltyInbox[A-Za-z]*\.ts|lib/domain/loyaltyInbox[A-Za-z]*\.ts|lib/loyaltyInbox[A-Za-z]*\.test\.ts|lib/domain/loyaltyInbox[A-Za-z]*\.test\.ts|app/api/v1/loyalty/inbox/|app/api/v1/loyalty/loyaltyInbox\.test\.ts|components/Loyalty[A-Za-z]*\.tsx|components/TravelBoard\.tsx|lib/loyaltyStore\.ts|lib/scheduler\.ts)' "$CH" | grep -vxF "$A" > "$SCOPE" || true
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|toFixed|Math\.round'
while IFS= read -r f; do if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi; done < "$SCOPE"
BAN2='Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|parseFloat|toFixed|Math\.round'
if added "$A" | grep -nE "$BAN2"; then echo "FAIL date arithmetic or float in the adapter"; exit 1; fi
for f in "$A" "$P" "$M" apps/web/app/api/v1/loyalty/inbox/poll/route.ts; do
  if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
  if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
done
grep -qE 'readOnly:[[:space:]]*true' "$A"
if grep -nE 'messageFlagsAdd|messageFlagsSet|messageFlagsRemove|messageDelete|messageMove|messageCopy|\.append\(|\.expunge|mailboxCreate|mailboxDelete|mailboxRename|\.idle\(|setFlags|\\Seen|\\Deleted' "$A"; then echo "FAIL a mailbox write verb in the adapter"; exit 1; fi
PW="$(grep -rlF 'LOYALTY_IMAP_PASSWORD' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$PW" = "apps/web/lib/loyaltyInboxSource.ts " ]
RM="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$RM" = "apps/web/lib/loyaltyInbox.ts " ]
ENVR="$(grep -rlE 'process\.env' apps/web/components apps/web/app/travel | tr '\n' ' ')"
[ -z "$ENVR" ]
SCH=apps/web/lib/scheduler.ts
[ -z "$(git diff -U0 "$B" -- "$SCH" | grep -E '^-[^-]' || true)" ]
[ "$(grep -c 'await runLoyaltyInboxDaily()' "$SCH")" = 1 ]
L0="$(grep -n 'runSync({ force: true' "$SCH" | head -1 | cut -d: -f1)"; L1="$(grep -n 'await runLoyaltyInboxDaily()' "$SCH" | head -1 | cut -d: -f1)"; L2="$(grep -n 'await runDailyDigest()' "$SCH" | head -1 | cut -d: -f1)"
[ "$L0" -lt "$L1" ]; [ "$L1" -lt "$L2" ]
[ "$(grep -rhE 'memberNumber:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'cardAccountId:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
[ "$(grep -rhE 'earn:[[:space:]]*null' apps/web/components apps/web/app/travel | wc -l | tr -d ' ')" = 1 ]
while IFS= read -r f; do added "$f" >> "$ADDED"; done < <(grep -vE '\.test\.(ts|tsx)$' "$CH" | grep -E '^(apps/web/(lib|components|app)/.*\.(ts|tsx)|migrations/.*\.sql|db/schema\.sql|apps/web/scripts/gifts-surface-check\.mjs)$')
if grep -nE '^[[:space:]]*(//|/\*|\*|--)' "$ADDED" | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment"; exit 1; fi
echo "OK task source guards"
```
Scope notes. The raw-transactions scan covers every changed non-test source. The clock scan reads only lines this task adds (whole file for a new one), so pre-existing lines of `loyaltyStore.ts` or `scheduler.ts` cannot trip it (P8-42b A2); on the unmodified tree the guard passes trivially for the files that exist. The adapter file is excluded from the first scan and has the narrower second scan (Conventions, "Dates"). The `done < <( … )` form is bash process substitution, dry-checked on macOS `/bin/bash` 3.2 at G0. The three `memberNumber`, `cardAccountId`, `earn: null` counts are the P8-42a2, P8-42b and P8-42b2 guarantees and must stay 1 each. `process.env` appears in no component and no page.

**#14 (scope guard).**
```
B="$(git merge-base HEAD main)"; CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
grep -vE '^(packages/contracts/loyalty(\.test)?\.ts|db/schema\.sql|migrations/[0-9]+_[A-Za-z0-9_]+\.sql|\.env\.local\.example|package-lock\.json|apps/web/package\.json|apps/web/next\.config\.ts|apps/web/lib/loyaltyStore\.ts|apps/web/lib/loyalty\.test\.ts|apps/web/lib/loyaltyInbox[A-Za-z]*(\.test)?\.ts|apps/web/lib/domain/loyaltyInbox[A-Za-z]*(\.test)?\.ts|apps/web/lib/fixtures/loyalty-inbox/.*|apps/web/lib/scheduler\.ts|apps/web/lib/giftSurfaceRegistry\.ts|apps/web/app/api/v1/loyalty/.*\.ts|apps/web/app/travel/page\.tsx|apps/web/components/(Loyalty|Travel)[A-Za-z]*\.tsx|apps/web/scripts/gifts-surface-check\.mjs)$' "$CH" || true
git diff --name-only "$B" -- migrations | grep -E '^migrations/' || true
for f in packages/contracts/loyalty.ts packages/contracts/loyalty.test.ts db/schema.sql apps/web/package.json package-lock.json apps/web/lib/loyaltyStore.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxSource.ts apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/domain/loyaltyInbox.test.ts apps/web/lib/loyaltyInboxUi.test.ts apps/web/lib/loyaltyInboxConfig.test.ts apps/web/lib/scheduler.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/scripts/gifts-surface-check.mjs apps/web/app/api/v1/loyalty/inbox/poll/route.ts apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts apps/web/app/api/v1/loyalty/loyaltyResponses.ts apps/web/lib/loyalty.test.ts apps/web/lib/fixtures/loyalty-inbox/cases.json; do grep -qxF "$f" "$CH" || echo "MISSING $f"; done
[ "$(git ls-files -o --exclude-standard migrations | wc -l | tr -d ' ')" = 1 ] || echo "NOT EXACTLY ONE NEW MIGRATION FILE"
[ -z "$(git diff --name-only "$B" -- migrations)" ] || echo "AN EXISTING MIGRATION CHANGED"
git diff --name-only "$B" -- package.json 'apps/web/vitest*' evals apps/web/scripts/daily-job.ts apps/web/scripts/import-loyalty.ts apps/web/scripts/fixtures apps/web/lib/logger.ts apps/web/lib/jobHealthRead.ts apps/web/lib/receiptReader.ts apps/web/lib/loyaltyEarn.ts apps/web/lib/loyaltyEarnUi.test.ts apps/web/lib/domain/loyalty.ts apps/web/lib/fixtures/loyalty-earn-cases.json apps/web/lib/giftReadPath.ts apps/web/lib/domain/giftMask.ts apps/web/lib/sync.ts apps/web/lib/netWorth.ts
if git diff -U0 "$B" -- apps/web/next.config.ts | grep -E '^[-+][^-+]' | grep -vE 'serverExternalPackages|imapflow|mailparser' | grep -q .; then echo "NEXT CONFIG CHANGED BEYOND serverExternalPackages"; fi
```
Expected: no output at all. `next.config.ts` may change only to list the two packages as server-external if the build needs it (command 18 decides); `apps/web/lib/loyaltyInbox.ts` and the other new `lib` files fall under the allowed patterns. The root `package.json` is unchanged; the two dependencies are workspace dependencies of `apps/web`.

**#15 (existing-test edit guard and census).**
```
set -e; B="$(git merge-base HEAD main)"
git diff -U0 "$B" -- packages/contracts/loyalty.test.ts apps/web/app/api/v1/loyalty/loyalty.test.ts apps/web/app/api/v1/loyalty/loyaltyCard.test.ts apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts apps/web/lib/loyalty.test.ts | node -e '
const d=require("fs").readFileSync(0,"utf8").split("\n");
const norm=(s)=>s.replace(/\binbox\s*:\s*[A-Za-z_][A-Za-z0-9_.]*/g,"").replace(/["\x27](DOMAIN_TAKEN|ADDRESS_TAKEN)["\x27]/g,"").replace(/[\s,]+/g," ").replace(/\s+([\]})])/g,"$1").replace(/\[\s+/g,"[").trim();
const hunks=[];let cur=null;
for(const l of d){if(l.startsWith("@@")){cur={rem:[],add:[]};hunks.push(cur)}else if(cur&&l.startsWith("-")&&!l.startsWith("---"))cur.rem.push(l.slice(1));else if(cur&&l.startsWith("+")&&!l.startsWith("+++"))cur.add.push(l.slice(1))}
const bad=[];let surface=0,len=0,resp=0;
for(const h of hunks)for(const r of h.rem){
  if(r.includes("OK H1-H13")){if(h.add.some(a=>a.includes("OK H1-H14"))){surface++;continue}}
  if(r.includes("toHaveLength(11)")){if(h.add.some(a=>a.replace("toHaveLength(12)","toHaveLength(11)")===r)){len++;continue}}
  if(r.includes("expect(responses.length).toBe(6);")){if(h.add.some(a=>a.includes("expect(responses.length).toBe(7);"))){resp++;continue}}
  if(!h.add.some(a=>norm(a)===norm(r)))bad.push(r.trim().slice(0,80))}
if(bad.length||surface!==1||len!==3||resp!==1){console.log("FAIL existing test lines changed beyond the allowance:",bad.join(" | "),"surface="+surface,"length="+len,"responses="+resp);process.exit(1)}
console.log("OK existing tests edited only as allowed; removed lines "+hunks.reduce((n,h)=>n+h.rem.length,0))'
IF=apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts; DF=apps/web/lib/domain/loyaltyInbox.test.ts; UF=apps/web/lib/loyaltyInboxUi.test.ts; CF=apps/web/lib/loyaltyInboxConfig.test.ts
[ "$(grep -cE "it\('T42c1-I([1-9]|1[0-2]):" "$IF")" = 12 ] || echo "WRONG NEW INTEGRATION TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$IF")" = 12 ] || echo "EXTRA TESTS IN THE INTEGRATION FILE"
[ "$(grep -cE "it\('T42c1-U[2-5]:" "$DF")" = 4 ] || echo "WRONG DOMAIN TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$DF")" = 4 ] || echo "EXTRA TESTS IN THE DOMAIN FILE"
[ "$(grep -cE "it\('T42c1-U6:" "$UF")" = 1 ] || echo "WRONG UI TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$UF")" = 1 ] || echo "EXTRA TESTS IN THE UI FILE"
[ "$(grep -cE "it\('T42c1-U7:" "$CF")" = 1 ] || echo "WRONG CONFIG TEST COUNT"
[ "$(grep -cE "^\s*(it|test)\(" "$CF")" = 1 ] || echo "EXTRA TESTS IN THE CONFIG FILE"
[ "$(git diff -U0 "$B" -- packages/contracts/loyalty.test.ts | grep -E "^\+" | grep -cE "it\('T42c1-U1:")" = 1 ] || echo "WRONG CONTRACT TEST COUNT"
[ "$(grep -c "app/api/v1/loyalty/inbox/poll/route.ts" apps/web/lib/loyalty.test.ts)" -ge 1 ] || echo "THE ROUTE IS NOT IN LOYALTY_ROUTE_FILES"
```
Expected: one `OK existing tests edited only as allowed; removed lines <n>` line and no other output. The allowance is exactly what "Existing state this task changes" items 1 to 5 name, and nothing else: the `norm` function forgives only a removed line whose added counterpart is equal once an `inbox: <identifier>` and the two new error-code strings are deleted; the three other pins are matched by exact text; the expected pin counts are one surface line, three route-count lines and one response-count line. Any other removed line fails the command.

**#16 (fixtures pinned and covered).**
```
set -e; D=apps/web/lib/fixtures/loyalty-inbox; I=apps/web/app/api/v1/loyalty/loyaltyInbox.test.ts; X=apps/web/scripts/gifts-surface-check.mjs; N=apps/web/lib/domain/loyaltyInbox.test.ts
[ "$(ls "$D" | wc -l | tr -d ' ')" = 28 ]
[ "$(ls "$D"/*.eml | wc -l | tr -d ' ')" = 27 ]
SUM="$( (export LC_ALL=C; cd "$D"; shasum -a 256 *.eml cases.json | shasum -a 256 | cut -d' ' -f1) )"
[ "$SUM" = "f0bc174f134e6aaa092430c4c390e4e4f2f01a2dfdc56a77ad2a8c28fa36adc8" ]
node -e '
const fs=require("fs"),path=require("path");const d=process.argv[1];const bad=[];
const c=JSON.parse(fs.readFileSync(path.join(d,"cases.json"),"utf8"));
if(typeof c.note!=="string"||!/fabricated/i.test(c.note))bad.push("note");
const files=fs.readdirSync(d).filter(f=>f.endsWith(".eml")).sort();
if(files.length!==27)bad.push("eml count");
const ids=files.map(f=>f.slice(0,3));
for(let i=1;i<=27;i++){if(!ids.includes("F"+String(i).padStart(2,"0")))bad.push("missing F"+i)}
if(!Array.isArray(c.messages)||c.messages.length!==27)bad.push("messages");
for(const g of ["canaries","domainAccept","domainRefuse","addressAccept","addressRefuse","lengths","envMatrix","health","retention"])if(!(g in c))bad.push("group "+g);
const ok=/(^|\.)(test|example\.com|example\.net|example\.org)$/i;
for(const f of files){const t=fs.readFileSync(path.join(d,f),"utf8");
  if(!t.includes("ZQ42C"))bad.push(f+" no canary");
  if(!/\{\{DAY:-[0-9]+\}\}/.test(t)&&f.slice(0,3)!=="F24")bad.push(f+" no date token");
  for(const m of t.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.À-ſ-]+)/g)){const dom=m[1].replace(/\.+$/,"");if(!ok.test(dom))bad.push(f+" real-looking domain "+dom)}
  if(/[0-9]+\.[0-9]{2}\b/.test(t))bad.push(f+" figure")}
if(bad.length){console.log("FAIL fixture shape:",bad.join(","));process.exit(1)}
console.log("fixture shape ok")' "$D"
for t in "$I" "$X" "$N"; do grep -qF 'loyalty-inbox' "$t" || { echo "FAIL $t never loads the fixtures"; exit 1; }; done
for g in messages envMatrix health retention canaries; do grep -qF "$g" "$I" || { echo "FAIL $I never reads $g"; exit 1; }; done
[ "$(grep -cF 'expect(seen).toEqual(' "$I")" -ge 3 ] || { echo "FAIL fewer than three covered groups in $I"; exit 1; }
LIT="['\"][-]?[0-9]+\.[0-9]{2,4}['\"]"
for f in "$I" "$N"; do if grep -nE "$LIT" "$f"; then echo "FAIL a figure literal in $f"; exit 1; fi; done
echo "OK fixtures pinned and covered"
```
Expected: the `fixture shape ok` line from `node`, then `OK fixtures pinned and covered`. `INBOX_FIXTURE_SHA_PENDING` is a literal the orchestrator replaces with the digest at G0; a command run before that fails on purpose. The digest covers the 27 `.eml` files and `cases.json`, in file-name order, so an implementer cannot reshape a fixture to fit a parser. The address scan accepts only `.test` and the three `example` domains, so no real-looking address can enter. The `node` script reads its argument as `process.argv[1]`.

**#17 (`.env.local.example`).**
```
set -e; F=.env.local.example
for v in LOYALTY_IMAP_HOST LOYALTY_IMAP_PORT LOYALTY_IMAP_TLS LOYALTY_IMAP_USER LOYALTY_IMAP_PASSWORD LOYALTY_IMAP_MAILBOX LOYALTY_IMAP_TIMEOUT_SECONDS; do
  [ "$(grep -cE "^${v}=[[:space:]]*(#.*)?$" "$F")" = 1 ] || { echo "FAIL $v is missing, duplicated or not empty in $F"; exit 1; }
done
[ "$(grep -cE '^LOYALTY_IMAP_' "$F")" = 7 ]
if grep -nE '^LOYALTY_IMAP_[A-Z_]+=[[:space:]]*[^[:space:]#]' "$F"; then echo "FAIL a LOYALTY_IMAP_ variable has a value in the example"; exit 1; fi
echo "OK env example"
```

## Negative controls
| # | Rule | Input that must be rejected or excluded | Asserted by |
|---|---|---|---|
| 1 | A sender matches a stored domain only when equal or a true subdomain | F03 (`…zq42c-brand.test.attacker.test`), F04 (`notzq42c-brand.test`), and pure cases `xzq42c-brand.test`, `zq42c-brand.test.`, `zq42c-brand.tes` | T42c1-U2, T42c1-I2 (command 7, 8) |
| 2 | Only the address of the `From` header counts | F05 (display name claims the brand), F06 (brand in the local part), F07 (`Reply-To`, `Return-Path`, `Sender` name the brand) | T42c1-U3, T42c1-I2 |
| 3 | An unreadable sender is counted, never stored | F18 (two mailboxes), F19 (non-ASCII domain), F24 (no `From`), a `From` domain holding markup | T42c1-U3, T42c1-I2, T42c1-I7 |
| 4 | A forwarded original is honoured only from a registered member | F10 (the same forward from a stranger), F08 with no registered address | T42c1-U4, T42c1-I2 |
| 5 | A member's forward of a non-allowlisted original is not stored | F27 | T42c1-I2 |
| 6 | A message from an unknown sender is never downloaded | F03 to F07, F10, F18, F19, F21, F22, F24: the strict fake records no fetch for any | T42c1-I2 |
| 7 | The mailbox is never written | any call other than list, fetch and close on the strict fake; a write verb or a missing read-only open in the adapter | T42c1-I3, command 13 |
| 8 | A message is stored once | F17 (same `Message-ID`, different bytes), a second poll of the whole set | T42c1-I2, T42c1-I3 |
| 9 | An unknown sender is counted once | a second poll of F03 to F07 and F21, F22 | T42c1-I3 |
| 10 | Two polls cannot overlap, and a failure frees the lock | a second poll while the first is gated; a source that errors and one that stalls | T42c1-I3 |
| 11 | A message outside the window is not stored or counted | F20 (60 days old) | T42c1-I2, T42c1-I5 |
| 12 | Retention is strict at 30 days, and it deletes only mail | rows 31 and 60 days old deleted; rows 29 and 30 days old kept; domains, addresses, `last_seen_on`, `last_received_on` kept | T42c1-I5 |
| 13 | A person is quiet only after 45 days | 44 and 45 days are not quiet; 46 is; a member with no address is `not_set_up`, never quiet | T42c1-I6 |
| 14 | A "last seen" or "last received" date never moves back | an older message stored after a newer one | T42c1-I4, T42c1-I7 |
| 15 | The recipient walk follows the tiers and never guesses | F14 (tier 1 beats the outer headers), F15 (oldest `Received`), F13 (two members: `ambiguous`), F11 (`unmatched`), F12 (`none_found`) | T42c1-U5, T42c1-I2 |
| 16 | Re-attribution never reassigns a matched message | adding an address after F01 is matched to A | T42c1-I4 |
| 17 | An allowlisted domain cannot be a shared mail provider, a bare suffix or malformed | `gmail.com`, `mail.gmail.com`, `Outlook.com`, `co.uk`, `com.au`, `test`, a wildcard, a URL, an address | T42c1-U1, T42c1-U2, T42c1-I9, command 5 |
| 18 | The seeded catalog holds no shared provider and no test or example domain | the structural queries of command 5 | command 5 |
| 19 | A forwarding address is a plain address held by one member | a display-name form, a missing `@`, an address held by another member | T42c1-U1, T42c1-I9 |
| 20 | A read-scope token cannot poll or edit; no session is refused | read-scope bearer on the poll and both PATCHes; no cookie | T42c1-I9, T42c1-I10, T42c1-H14 |
| 21 | No raw body, subject, member number or password leaves the server | the canaries across every response, page and log line | T42c1-I8, T42c1-I1, T42c1-I3, T42c1-I11, T42c1-H14 |
| 22 | A library error text never surfaces | a fake that fails with a message holding the password and body canaries | T42c1-I3, T42c1-I11, command 13 |
| 23 | Nothing derived from the body is stored | the column lists and the forbidden-name scan; stored rows hold only the allowed columns | T42c1-I12, commands 5 and 6 |
| 24 | The poller disabled is not an error | unset and incomplete environments, with the daily job | T42c1-I1, T42c1-U7 |
| 25 | A failing inbox step cannot stop the digest | a source that rejects during `runDailyJob()` | T42c1-I1 |
| 26 | The configuration is strict about TLS and port | TLS `false` and `TRUE`, ports `0`, `65536`, `99x`, `-1` | T42c1-U7 |
| 27 | An oversize message keeps no bytes | one byte over the cap | T42c1-I2 |
| 28 | The ledger is untouched | net worth, the ledger overview and row checksums before and after | T42c1-I10, T42c1-I12, command 13 |
| 29 | A null renders as a phrase, not a zero or a date | `lastCheck` null, `lastSeenOn` null, `not_set_up` | T42c1-I6, T42c1-I7, T42c1-U6, T42c1-H14 |
| 30 | No new write path for the mailbox password or for raw bytes in a route or page | the file-set checks for `LOYALTY_IMAP_PASSWORD` and `raw_mail` | command 13 |

## Evidence required
- `EVIDENCE.md` records: the docs files read under `node_modules/next/dist/docs/`; the `uiux-promax` skill used for the panel and editors; the chosen `imapflow`, `mailparser` and types versions with the output of `npm view <pkg> version license` and the reasons of Open question 1; the output of `npm audit --omit=dev` at G4 (informational, needs the network); the SHA-256 digest of the fixture directory; the migration up, down, up log of command 5.
- A **mutation log**, run by the implementer against its own tests: each of the following is applied, the named scenario is shown to fail, and the change is reverted (the file is shown byte-identical): substring or suffix-without-dot domain match; matching on the display name; accepting `Reply-To` as the sender; honouring a forward from a non-member; skipping the dedupe check; recounting unknowns on a re-poll; downloading an unknown message; marking a message seen; storing the subject; logging the library error text; returning the password in the overview; `>=` for `>` in retention; `>=` for `>` in the quiet threshold; deleting `last_seen_on` on purge; rolling `last_received_on` back; reassigning a matched message on re-attribution; accepting a shared mail provider; never releasing the lock on error; a route that polls for a read-scope token; letting a poll write a ledger table; a stored raw body for an oversize message; letting the daily job reject when the source fails. A mutation no test catches is a gap and is reported, not hidden.
- A sample of `/travel`'s inbox panel text over fabricated data, from H14's output, in EVIDENCE.md, with no real address.
- The output of `grep -cE "[0-9]+\.[0-9]{2}\b"` over `SPEC.md` is `0`, and the added comment lines contain no money-looking figure.
- The unverified residual (Open question 13) listed by name for the owner's first real run, with the one-line way to see it succeed: set the seven variables, press `Check inbox now`, read `Last check`.

## Failure modes to test
These seed the reviewer's falsification log.
- **Look-alike domains.** A suffix, a prefix, a trailing dot, a label-boundary miss, a brand in the local part or display name, a punycode or Unicode homograph, an upper-case domain, a trailing-dot FQDN: each either matches correctly (subdomain, case-fold) or is unknown, never matched by substring.
- **Longest match.** Two programs with nested domains; a first-match instead of longest-match sends mail to the wrong program.
- **Forwarded mail.** A manual forward from a stranger honoured; a quoted (`> `) inline forward missed; a marker with no `From:`; an attachment that is not a message; two attachments; a nested forward; an outer `From` equal to the original (an auto-forward with an attached copy); a forward header block that continues past 12 lines.
- **Attribution.** The mailbox's own address in `Delivered-To` stopping the walk; tiers in the wrong order; `Received` scanned newest first; a candidate matching two members in different tiers (the first tier must win) versus the same tier (`ambiguous`); a member address with a plus tag; re-attribution that reassigns or un-matches; unattributed mail counted toward a member's health.
- **Dedupe.** A missing `Message-ID`; a `Message-ID` with surrounding whitespace or without brackets; the same id arriving through two members; an id that embeds an address (it must not be stored in clear); the dedupe check done after the download; an unknown message with no dedupe row recounted on every poll; an expired message re-fetched after its purge; the duplicate's bytes replacing the original's.
- **Concurrency and failure.** A lock held on a pooled client that goes back to the pool unreleased; a lock that survives an error; a stalled source that holds the lock past its timeout; a route and the daily job racing; the lock's advisory key colliding with another feature's; a second poll reporting an error instead of `already_running`.
- **Window and retention.** An off-by-one at 30 or 31 days; the fetch window and the purge cut-off disagreeing (fetch, purge, re-fetch loop); the IMAP date filter's day granularity returning a day-old message the poller must drop; `received_on` taken from the `Date` header rather than the server's time; a purge that deletes the durable dates; a purge that depends on the job having run; physical bytes remaining until vacuum (stated).
- **Dates and time zones.** A boundary that moves by a day with the database session's time zone; a JS clock or date arithmetic on the server path; `CURRENT_DATE` read in JS; a day difference computed on text.
- **Null versus zero.** `lastCheck` null shown as ok; `lastSeenOn` null shown as a date; `quietDays` for a member with no address; a count of zero shown as empty; `missing` empty when it should list all five; the text `null` on the page.
- **Health.** `>=` for `>` at 45; `no_mail_yet` never becoming quiet; the reference date taken from the wrong member's address; a member with two addresses using the older `last_received_on`; a member with no user treated as absent.
- **Privacy.** A body, a subject or a member number in any response, page, log or error; the password or user or host in a log, a response, a thrown error or `/travel`; a library error text surfaced; `raw_mail` selected by the overview or by a count query; a route that returns bytes; markup in a stored domain rendered as HTML; an unknown domain longer than hostname length stored.
- **Mailbox safety.** The mailbox opened read-write; `\Seen` set by a fetch; a write verb added; the adapter honouring a configuration that would send the password in clear (TLS `false`, an empty TLS value).
- **Configuration.** A whitespace-only value counted as set; a partial configuration treated as ready; the password read at import time instead of call time; a real credential inherited by the surface script's server or by a test; the example file holding a value.
- **Size.** A message exactly at and one byte over the cap; an oversize message fetched in full; an oversize message re-listed forever because it was not recorded.
- **Editors.** A list replaced partially; a domain moved between programs without 409; a shared provider through a subdomain (`mail.gmail.com`); an address list with a duplicate; an echo of the input in an error; a read-scope token writing; two concurrent edits both winning.
- **Dependencies.** A range (`^`) instead of an exact version; the lockfile out of step; a package imported by a client component or a page; a native build step pulled in; a licence outside the permissive set.
- **Daily job.** The inbox step placed before the syncs or after the digest; a rejection that stops the digest; a second timer; the step run when the poller is disabled writing state.
- **Ledger.** Any read of or write to `transactions`, `accounts` or a valuation; net worth moved by a poll; a gift-surface class changed.

## Rollback
Revert the code commit, then, if the migration was applied, run `npm run migrate:down` once against that database, after reverting the code so nothing queries a missing table. The `down` drops the five tables `loyalty_sender_domains`, `household_member_addresses`, `loyalty_inbox_messages`, `loyalty_inbox_unknown_senders` and `loyalty_inbox_state` and nothing else: no program, member, membership, observation, instrument, earn rule, alias or ledger row is touched. After the revert, `npm install` restores the lockfile and removes `imapflow` and `mailparser`.

**The `down` is not lossless for the configuration made while the change was live.** Every sender domain edit, every forwarding address and the poll state are discarded; the seeded catalog domains are re-created by the next `up`. Back the configuration up first, as the migration's own header must list:

`\copy (SELECT p.name, d.domain FROM loyalty_sender_domains d JOIN loyalty_programs p ON p.id = d.program_id ORDER BY d.domain) TO 'backup-loyalty_sender_domains.csv' CSV HEADER`

`\copy (SELECT m.display_name, a.address, a.added_on, a.last_received_on FROM household_member_addresses a JOIN household_members m ON m.id = a.member_id ORDER BY a.address) TO 'backup-household_member_addresses.csv' CSV HEADER`

The stored raw mail and the unknown-sender rows are deliberately not backed up: they are at most 30 days old, derived, and a backup would keep raw mail past its retention. A restore re-runs `migrate:up` and loads the two files back by program name and member name. No ledger, gift or account row was written by this change, so nothing else needs restoring. The fixtures are test support only and may stay or go with the revert.


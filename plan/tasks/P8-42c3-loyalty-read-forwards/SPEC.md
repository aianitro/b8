# P8-42c3-loyalty-read-forwards — what the model receives of a stored loyalty message: an attached forward is read, an inline forward's header block is dropped, and no e-mail address, `mailto:`, `tel:` or scheme-less link reaches Anthropic

**Roadmap item:** ROADMAP.md §5 Phase 8 step 42c, follow-up to P8-42c2 (commit `fda9eb9`). Origin: `plan/tasks/P8-42c3-loyalty-read-forwards/ITEM.md` (binding); NITS N1, N2 and N11 in `plan/tasks/P8-42c2-loyalty-inbox-read/NITS.md`; the orchestrator's I-1 and I-2 results in that task's `GATES.md` (G3); REVIEW-1 hypotheses 33 to 35. "42c2 #n" means that spec's acceptance command n; "42c2 line n" means line n of `plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md`, which is FROZEN.
**Status:** FROZEN (G0 PASS 2026-11-23; amendments A1, A2, A3)
**Author:** spec-writer

**How figures are handled (AGENTS.md public-repo rule).** This spec contains no money-looking figure, no balance and no member number. The collision shapes a scrub could damage (grouped amounts, decimals, multipliers, dates, masked numbers) are described here by shape and named by case id; the strings themselves live only in the fabricated fixture directory `apps/web/lib/fixtures/loyalty-read-forwards/`, which the orchestrator writes before G0 and pins by SHA-256 in command 13. Every fixture carries the canary `ZQ42C3`. Command 19 scans this spec for money-looking text. Under `node -e` the first extra argument is `process.argv[1]`; every `node -e` below reads its arguments that way.

## Goal
Three observable changes to what one stored loyalty message becomes before it is sent to the model. Nothing after that point changes.

1. **An attached forward is read (N11).** When the stored message row's `origin` is `attachment` (the value 42c1's poll recorded when a registered household member's forward carried a `message/rfc822` part) and that part is present in the bytes, the model is given the **attached original's** subject and text, and nothing of the forwarder's covering note or covering subject. Today it is given only the covering note, so a statement forwarded this way never yields a balance. Every rule that applies to direct mail applies to the original's text: no header of either message, links replaced, the length bounds.
2. **An inline forward's header block is not sent (N1).** For each inline-forward marker followed within twelve lines by a `From:` line (the same marker and reach rule 42c1 uses), the forwarded header block (the `From:` line and the non-blank lines that follow it: `To:`, `Cc:`, `Date:`, `Sent:`, `Subject:` and any folded continuation) is removed from the text sent. The statement body after it is kept.
3. **No e-mail address, `mailto:` link, `tel:` link or scheme-less link reaches the model, from any part of the subject or text (N1, N2).** A `mailto:` or `tel:` link and a scheme-less link such as `track.brand.example/u?t=…` become `[link]`, as URLs do today; an e-mail address anywhere in the text (a quoted address, an address in a reply line, an address rendered from HTML) becomes `[address]`. The exact patterns and their order are fixed below, together with the shapes the scrub must leave byte-for-byte untouched.

P8-42c2's decision rules, prompt, schema, model, retry, lock, storage, routes and page are unchanged. A direct message, an inline forward and a stranger's mail with an `message/rfc822` attachment are read exactly as today, apart from changes 2 and 3. Messages already read are not re-read automatically.

## Non-goals
The reviewer enforces each of these as a defect if present.
- **No change to the reader or the request.** `apps/web/lib/loyaltyReader.ts` is byte-unchanged: the prompt, the schema, the model constants, the retry and timeout settings. The reader's input stays exactly `{ subject: string | null, text: string }`; no new field (no origin, no flag, no count of placeholders) is added to it. The prompt is not edited to explain `[address]`.
- **No change to 42c2's decision rules, decision order, constants, states, reasons, queue actions, routes, contract schemas, page, panel, scheduler, store, surface script or registry.** No migration, no `db/schema.sql` change, no `packages/contracts` change.
- **No change to 42c1.** `analyseMessage`, `inlineForward`, `MARKER`, `PARSE`, the poll, attribution, the dedupe keys and `loyalty_inbox_messages` are unchanged. The text path does **not** re-derive "is this a registered member's forward" from `household_member_addresses`; the stored `origin` is the record of that decision. (42c1's own re-attribution already treats a stored `origin` other than `direct` as the registered-member test, `lib/loyaltyInbox.ts` line 426.)
- **No automatic re-read.** A message that already has a `loyalty_inbox_reads` row in any state other than `retry` is not offered to the reader by this change. Messages of an attached forward that were read under 42c2 (most likely `no_balance`) stay as they are. The only explicit re-reads are 42c2's: `retryFailed` for `failed` rows, and an operator's SQL delete of one reads row (42c2 OQ18). No script, route or timer is added to find and re-read them.
- **No attached original is read unless the stored origin is `attachment`.** A stranger's message with an attached `message/rfc822` part is stored with origin `direct` (42c1) and is read as its outer message only. No attachment other than the first `message/rfc822` part is read, no attachment of the attached original is read, and a forward nested inside the attached original is not unwrapped.
- **No other scrubbing.** Names (display names, salutations), postal addresses, plain phone numbers with no `tel:` scheme, member numbers, balances, dates and program names are not touched. URL schemes other than `scheme://`, `www.`, `mailto:` and `tel:` (for example `sms:`, `callto:`, `data:`) are not added. Non-ASCII e-mail addresses and an address whose local part is entirely mask characters (for example `a***@host`) are not matched and stay as written. These are stated residuals, asserted by named controls so they are decided rather than accidental.
- **No fixing of P8-42c2 NITS N3 to N10.** N8's guard regex, N7's empty catches, N10's vanished-bytes handling and the rest are not folded in; a diff that touches `loyaltyInboxRead.ts` beyond selecting and passing the stored origin is out of scope.
- **No new dependency**, no HTML-to-text library, no TLD list package, no e-mail-matching package. `mailparser` stays imported only by `apps/web/lib/domain/loyaltyInbox.ts`.
- **No logging or storage of what is sent.** Nothing the scrub removes, and nothing it leaves, is logged, stored or returned; no `console.` output; no placeholder counts persisted.
- **No JS clock and no float** in any added line (Conventions). No live Anthropic call, real mailbox or non-loopback socket in any test or command.
- **No existing test is weakened, edited or deleted, and nothing under `apps/web/lib/fixtures/loyalty-read/` or `loyalty-inbox/` changes.**

## Contracts touched
**None.** G1 SKIP is expected.

Justification, so the reviewer can check it: the only new input to the text path is the message row's `origin`, which `loyalty_inbox_messages` already stores (the column and its value type `LoyaltyInboxOrigin` exist from 42c1). The reader's input, every response shape, every schema and every constant (`LOYALTY_READ_MAX_CHARS` included) are unchanged. If the implementer finds a contract change is needed, it must stop and name it to the orchestrator; it is not made silently.

| File | Change | Class (§9.2) |
|---|---|---|
| none | none | none |

### Fixed seams (names the oracle and the integration test import; everything else is the implementer's)
- `apps/web/lib/domain/loyaltyInbox.ts` keeps exporting `textForReader`, now as `textForReader(raw: Buffer, maxChars: number, origin?: LoyaltyInboxOrigin): Promise<{ subject: string | null; text: string }>`. `origin` is the stored value; **omitted means `'direct'`**, so a call with the two existing arguments behaves exactly as a message stored `direct`. Only the value `'attachment'` changes which message is read. The result object has exactly the keys `subject` and `text`.
- `apps/web/lib/loyaltyInboxRead.ts` passes each candidate's stored `origin` (selected from `loyalty_inbox_messages`) to `textForReader`. It does not consult `household_member_addresses`.
- The implementer may add one new **pure** file, exactly `apps/web/lib/domain/loyaltyInboxText.ts`, for the scrub. It imports nothing from `mailparser`, `pg`, `next` or `@anthropic-ai/sdk`, names no environment variable, and is the only new non-test source file allowed.

## Conventions this task must honor
- **Sign:** not applicable. No amount is parsed, computed or compared. Every balance, multiplier, date and masked number in a message body passes through as opaque text and must come out **byte-identical** (negative controls 6 to 21). Nothing is negated, absolute-valued or re-signed.
- **Rounding:** none. No figure is derived from another; "once at the end or per step" does not arise. A scrub that rewrites any digit sequence is a defect.
- **Landscape + exclusions:** not applicable. No ledger row is read or written, so `landscape`, `hidden` and `exclude_from_budget` are never consulted (command 14 asserts no ledger read is added).
- **Null semantics:** `subject` is `null` when there is no subject or it is blank after the scrub (an attached original with no Subject header gives `null`, never the covering subject). `text` is the empty string when there is nothing to read; the existing caller then records `empty_message` and does not call the model (42c2). An attached original with no readable text gives the empty string and **never falls back to the covering note**. A subject consisting only of an address becomes `[address]`, which is text, not null. "No text" is never rendered or passed as the word `null`.
- **Dates and clock:** none of `new Date(`, `Date.now(`, `toISOString`, `getTime(`, `setDate(`, `setHours(`, `getTimezoneOffset`, `toLocaleDateString`, `toLocaleTimeString`, `parseFloat`, `toFixed`, `Math.round` appears in any line this task adds (command 14). "Today" in integration tests is Postgres `CURRENT_DATE`, as in 42c2.

### What the model receives (normative)
For one stored message with bytes, the caller passes its stored `origin`. Both fields below are computed from the **chosen message** and nothing else.

**1. Which message is the chosen message.**
| Stored origin | Bytes | Chosen message | Subject and text come from |
|---|---|---|---|
| `attachment` | has a `message/rfc822` part | the **first** such part in message order, parsed as a message | that original's `Subject` header and its text (the `text/plain` part when there is one, otherwise its HTML converted to text) |
| `attachment` | has no `message/rfc822` part | the outer message | as for `direct` |
| `direct` or `inline` or omitted | any | the outer message | the outer `Subject` header and the outer text, as today |

The outer subject and outer text of a message read from its attachment are **never** sent, not even when the original has no subject or no text. No header of the outer or the attached message is sent (not From, To, Cc, Delivered-To, Received, Message-ID, Date). Nothing from an attachment other than the chosen part is read.

**2. Order of operations on the chosen text** (the fixture expectations were computed in this order):
1. Line breaks normalised to LF; inline-forward header blocks removed (below). Text only; the subject has no block removal.
2. Every `[link]` replacement: `LINK_SCHEME`, then `LINK_MAILTEL`.
3. Every `[address]` replacement: `ADDRESS`.
4. `LINK_BARE` → `[link]`.
5. `trim()`.
6. Cut to at most `maxChars` code points (text) or 300 code points (subject), never splitting a surrogate pair. **The cut is last**, so a cut can never leave a partial address (control 5).

**3. The patterns** (JavaScript `RegExp` syntax, all flags `gi`). They are the reference the fixture expectations were computed from; an implementation may spell them differently only if every `cases.json` entry and every named control still holds.
- `LINK_SCHEME` (today's, unchanged): `\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'\])]+`
- `LINK_MAILTEL` (new): `\b(?:mailto|tel):[^\s<>"'\])]+` — at least one character must follow the colon, and `\b` means `Hotel:` and `Intel:` do not match.
- `ADDRESS` (new): `[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<>"'\])]*)?` — a trailing sentence period is not part of an address (a label must follow every dot), and a path, query or fragment glued directly to the address is consumed with it.
- `LINK_BARE` (new): `(?<![\w@])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::[0-9]{1,5})?(?=[/?#])[^\s<>"'\])]*` — a hostname of two or more dot-separated labels whose **last label is two to twenty-four letters only** and which is **immediately followed by `/`, `?` or `#`**. A bare hostname with no path, query or fragment is left alone.
- Placeholders are the exact strings `[link]` and `[address]`, lower case, square brackets, no space. Surrounding text is kept: `<name@host>` becomes `<[address]>`; HTML-rendered links: mailparser renders `<a href="mailto:name@host">write</a>` as `write [name@host]` (the scheme is dropped), which becomes `write [[address]]`; a `tel:` href renders as `[tel:…]` and becomes `[[link]]` (A1).

**4. The inline-forward header block.** For each line of the text, test its *stripped* form: remove any leading run of `>` quote markers (each optionally followed by one space or tab), then trim. A **marker line** is one whose stripped form matches, case-insensitively and as the whole line, two or more hyphens, optional spaces, `Forwarded message` or `Original Message`, optional spaces, two or more hyphens; or `Begin forwarded message:`. A **From line** is a line whose stripped form begins `From:`. For each marker line, if one of the twelve lines after it (first to twelfth) is a From line, the **header block** is the nearest such From line plus every directly following line up to but not including the first line whose stripped form is blank (or to the end of the text). The block's lines are removed whole. The marker line, the lines between the marker and the From line, the blank separator and everything after it are kept verbatim (quote prefixes included). Every marker in the text is processed in order, so a forward of a forward loses both blocks. A marker with no From line within reach changes nothing. This is shape-based: it applies whatever the stored origin is, and to an attached original's text.

## Toolchain prerequisites
All commands run under `/bin/bash` 3.2 from the repo root. Baselines are the 42c2 close-out figures (42c2 GATES G4); the orchestrator measures each row at G0 and a mismatch is a G0 FAIL.

| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | `psql` and a local Postgres with CREATEDB | **yes** | local install | `psql -d postgres -tAc "select 1"` → `1` | filled at G0 |
| T2 | Throwaway DB `b8_p42a_throwaway` at head with 42c2's migration (this task adds none) and no `ZQ42C` rows | **yes** | reuse; else `createdb b8_p42a_throwaway` then `DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npm run migrate:up` | `psql postgresql://localhost/b8_p42a_throwaway -Atc "select name from pgmigrations order by id desc limit 1"` ends `_loyalty_inbox_read`, and `psql postgresql://localhost/b8_p42a_throwaway -Atc "select (select count(*) from loyalty_programs where name like 'ZQ42C%')\|\|','\|\|(select count(*) from household_members where display_name like 'ZQ42C%')\|\|','\|\|(select count(*) from loyalty_inbox_messages)"` → three zeros | filled at G0 |
| T3 | Unit baseline | **yes** | existing | `npm test 2>&1 \| tail -8` → `Test Files  111 passed (111)` and `Tests  1427 passed (1427)` | filled at G0 |
| T4 | Lint baseline | **yes** | existing | `npm run lint; echo "exit=$?"` → 0 errors, not above 5 warnings | filled at G0 |
| T5 | Integration baseline | **yes** | existing | 42c2 #8's body (lines 403 to 410 of its SPEC) run on the unmodified tree → `OK 370 tests …` and `OK no fixture rows left` | filled at G0 |
| T6 | `tsc` in `apps/web` with `--incremental false` | **yes** | existing | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` → `exit=0` | filled at G0 |
| T7 | Node 22 or later (regex lookbehind, global `fetch`) | **yes** | local install | `node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22 && typeof fetch==="function" && /(?<![\w@])a/.test("a") ? 0 : 1)'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T8 | Port 3198 free and the surface script green on the unmodified tree | **yes** | existing | `lsof -nP -iTCP:3198 -sTCP:LISTEN \| wc -l` → `0`, then `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` → `OK H1-H15`, `exit=0` | filled at G0 |
| T9 | `npm run build` succeeds on the unmodified tree | **yes** | existing | `npm run build; echo "exit=$?"` → `exit=0` | filled at G0 |
| T10 | The frozen SPEC lines extracted by commands 2, 5 to 11 and 13 sit where stated. In `plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md`: line 251 starts `set -e; O="$(mktemp)"; npm run lint` and line 255 starts `echo "OK lint 0 errors`; 269 starts `set -e; B="$(git merge-base HEAD main)"` and 278 is `echo "OK dependencies"`; 374 starts `set -e; U=postgresql://localhost/b8_p42a_throwaway` and 392 is `echo "OK schema"`; 397 starts `set -e; unset ANTHROPIC_API_KEY` and 398 starts `for TZV in UTC Pacific/Auckland`; 407 starts `node -e 'const r=JSON.parse(require("fs")`, 408 starts `LEFT="$(psql `, 409 starts `[ "$LEFT" = `, 410 is `echo "OK no fixture rows left"`; 416 starts `set -e; unset ANTHROPIC_API_KEY` and 420 starts `bash -c `; 426 starts `set -e; unset ANTHROPIC_API_KEY` and 440 starts `BODY="$(sed -n `; 446 starts `set -e; unset ANTHROPIC_API_KEY` and 457 is `echo "OK surface"`; 574 starts `set -e; D=apps/web/lib/fixtures/loyalty-read; I=` and 605 is `echo "OK fixtures pinned and covered"`. Line 407 contains the digits `370` exactly twice | **yes** | frozen | `S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; for n in 251 255 269 278 374 392 397 398 407 408 409 410 416 420 426 440 446 457 574 605; do printf '%s:' "$n"; sed -n "${n}p" "$S" \| cut -c1-60; done` shows each prefix above, and `sed -n '407p' "$S" \| grep -o 370 \| wc -l \| tr -d ' '` → `2` | filled at G0 |
| T11 | Under `set -e`, a leading `!` does NOT abort when the negated command succeeds; this spec writes no `! cmd` guard | **yes** (hazard) | n/a | `bash -c 'set -e; ! true; echo reached'` → `reached` | filled at G0 |
| T12 | No iCloud-evicted (dataless) files in the checked trees | **yes** (hazard) | n/a | `find apps/web packages migrations db node_modules -flags +dataless -type f -not -path "*/.next/*" -not -path "node_modules/react-native*" -not -path "node_modules/@react-native*" -not -path "node_modules/@expo*" -not -path "node_modules/expo*" \| wc -l` → `0`, re-checked before each gate run | filled at G0 |
| T13 | Work happens on `main`, uncommitted, with the 42c2 commit as HEAD, so `git merge-base HEAD main` equals `HEAD` and every `git diff` against it is exactly this task's change; the tree is clean outside `plan/` and the fixture directory | **yes** | adjudicated at G0 | `[ "$(git merge-base HEAD main)" = "$(git rev-parse HEAD)" ]; echo "exit=$?"` → `exit=0`; `git status --short \| grep -v ' plan/' \| grep -v 'apps/web/lib/fixtures/loyalty-read-forwards' \| wc -l \| tr -d ' '` → `0` | filled at G0 |
| T14 | The fixture directory `apps/web/lib/fixtures/loyalty-read-forwards/` is on disk with 10 entries (`F01.eml` to `F08.eml`, `cases.json`, `forwards.oracle.test.ts`) and matches command 13's digest | **yes** | the orchestrator writes it (below) before G0 freezes | command 13's first three lines on the written directory | filled at G0 |
| T15 | **Non-vacuity proof of the oracle:** on the unmodified tree the oracle fails every scenario | **yes** | n/a | `(cd apps/web && npx vitest run lib/fixtures/loyalty-read-forwards/forwards.oracle.test.ts 2>&1 \| grep -E '^ +Tests ')` → `Tests  3 failed (3)` | filled at G0 |
| T16 | `env -u` and `unset` work; the commands unset every `ANTHROPIC_` variable and refuse a set `LOYALTY_IMAP_` variable | **yes** | n/a | `bash -c 'ANTHROPIC_API_KEY=x; unset ANTHROPIC_API_KEY; [ -z "${ANTHROPIC_API_KEY:-}" ]'; echo "exit=$?"` → `exit=0` | filled at G0 |
| T17 | A browser or jsdom renderer | **NO** | n/a. The page is unchanged; the surface script proves it over HTTP. | n/a | n/a |
| T18 | Live Anthropic, live Plaid, a real mailbox, any non-loopback socket, the dev database `b8_finance`, the owner's ledger | **NO** | n/a | n/a | n/a |

### Prerequisites the orchestrator creates
**The fixture directory `apps/web/lib/fixtures/loyalty-read-forwards/`**, written before G0 freezes this spec, with its digest written into command 13. The implementer does not create, edit, reformat or delete anything in it. All content is fabricated and carries the canary `ZQ42C3`. Domains are `.test`, `.example`, `.invalid`, or `example.com`, `example.net`, `example.org` only (including the host of every URL and scheme-less link). Every `.eml` is LF-terminated and carries a `Message-ID` on a `.test` domain, `MIME-Version: 1.0`, and a body canary `ZQ42C3-BODY-CANARY <ID>`.

The eight messages (the third column is the origin each is stored with in the integration test):

| Id | Content | Stored origin |
|---|---|---|
| F01 | Direct plain text. Subject with the subject canary. The body carries every collision shape of `scrub` entries that are plain text, one per line, with each scrubbable shape beside them. | `direct` |
| F02 | Inline forward from a household member: a covering line, a marker, a `From:`, `Date:`, `Subject:`, `To:`, `Cc:` header block holding member and brand addresses, a blank line, then statement body lines carrying an inner-body canary, a link, a decimal balance shape and a reply-style line `On <date>, <name> <address> wrote:`. | `inline` |
| F03 | Attached forward from a household member: an outer covering note (canary `outerNote`), an outer subject (`Fwd: …`), and a `message/rfc822` part whose headers hold From, To, Cc and Delivered-To addresses and a Subject with the inner-subject canary, and whose `text/plain` body holds the inner-body canary, a link, an address and a decimal balance shape. | `attachment` (and again as `direct`) |
| F04 | A non-member's outer note (canary `outerNote`) with a `message/rfc822` attachment whose body holds the `strangerInner` canary. | `direct` |
| F05 | HTML only: an `<a href="mailto:…">`, an `<a href="tel:…">`, an `<a href="https://…">`, visible text holding a scheme-less link and a bare address, and a `<script>` block with a canary. | `direct` |
| F06 | Attached forward (as F03) whose attached original has a `Subject` with the inner-subject canary and an **empty** `text/plain` body; the outer note carries the `outerNote` canary. | `attachment` |
| F07 | Attached forward whose attached original is **HTML only** (a `mailto:` link, a visible address, the inner-body canary). | `attachment` |
| F08 | An outer plain note with the `outerNote` canary and **no** `message/rfc822` part. | `attachment` |

**`cases.json`** has a `note` (stating it is fabricated and naming `ZQ42C3`), `canaries` (subject, body, inner subject, inner body, outer note, stranger inner, header, script, member number, key, and the list of every address and every link host used in the `.eml` files and cases), `envelope` (the fixed minimal `text/plain` header template the oracle wraps around a `scrub` or `inlineBlocks` body), and these groups. Every id named must be present; the oracle iterates every entry and ends each group with `expect(seen).toEqual(<ids from cases.json>)`.
- `shapes`: `direct-collisions` (F01, origin omitted), `inline-forward` (F02, `inline`), `inline-forward-as-direct` (F02, `direct`), `attach-member` (F03, `attachment`), `attach-member-as-direct` (F03, `direct`), `two-arg-call` (F03, origin omitted), `attach-stranger` (F04, `direct`), `html-only` (F05, `direct`), `attach-inner-empty` (F06, `attachment`), `attach-inner-html` (F07, `attachment`), `attach-origin-no-part` (F08, `attachment`). Each states the expected `subject` (a string or `null`) and, for plain-text results, the exact expected `text`; for HTML-derived results it states strings that must be contained, strings that must be absent, and exact counts of `[link]` and `[address]`.
- `scrub`: entries `{ id, body, expect }`. Scrubbed (expectation holds the placeholders): `address-plain`, `address-angle-reply`, `address-uppercase`, `address-plus-tag`, `address-in-quote-prefix`, `address-two-on-line`, `address-then-path`, `mailto-bare`, `mailto-angle`, `tel-plain`, `tel-plus-digits`, `bare-link-path`, `bare-link-query`, `bare-link-fragment`, `bare-link-port-path`, `bare-link-uppercase`, `www-link`, `scheme-link`, `link-then-address-same-line`. **Unchanged** (expectation equals the body): `balance-decimal`, `balance-comma-grouped`, `balance-comma-grouped-decimals`, `multiplier-decimal-x`, `multiplier-decimal-x-slash`, `date-dotted-dmy`, `date-dotted-ymd`, `date-slashed-dmy`, `date-slashed-mdy`, `date-iso`, `time-dotted-slash`, `percent-and-fraction`, `version-like-slash`, `masked-bullets`, `masked-letter-x`, `masked-star`, `masked-ellipsis`, `suffix-hash`, `program-dotted-abbrev`, `program-fabricated-dotted-name`, `glued-dot-no-slash`, `bare-domain-no-path`, `file-name-like`, `abbrev-slash`, `one-letter-tld`, `hotel-colon`, `intel-colon`, `tel-colon-space`, `masked-address`, `at-sign-no-domain`, `address-without-tld-dot`.
- `inlineBlocks`: entries `{ id, lines, expectLines }`: `gmail-style`, `outlook-style`, `apple-style`, `quoted-prefix`, `folded-to`, `reach-12-removed` (the From line is the twelfth line after the marker), `reach-13-kept` (the thirteenth: block kept, its addresses still become `[address]`), `no-from` (marker, no From line), `two-blocks` (a forward of a forward), `block-to-end-of-text`, `from-line-only`, `marker-kept`, `body-after-blank-kept`.
- `cap`: `cap-splits-address` (a filler length chosen so that, without the scrub, an address would begin within five characters of `maxChars`): the expected result is at most `maxChars` code points and holds no part of the address local-part canary.
- `integration`: the fabricated world for I1 to I3 (one program with a sender domain, one household member, one membership with a stored member number, one baseline reading as an offset from `CURRENT_DATE`), the reading the fake reader answers for the attached original (balance, unit, as-of offset, printed suffix; all within the 42c2 auto-apply rules), the expected resulting state and balance, and the expected `subject`/`text` the reader must receive for each of the nine stored messages.

**`forwards.oracle.test.ts`** is the three unit scenarios `T42c3-U1`, `T42c3-U2` and `T42c3-U3` (below), written by the orchestrator, importing `textForReader` from `../../domain/loyaltyInbox` and `LOYALTY_READ_MAX_CHARS` from `@b8/contracts/loyalty`. It reads every expected value from `cases.json`, never from literals, and uses no clock, no database and no network.

## Acceptance commands
All run from the repo root under `bash` (macOS `/bin/bash` 3.2). `U=postgresql://localhost/b8_p42a_throwaway`. No command uses a leading `!` as a guard (T11); absence is asserted with `if … then …; exit 1; fi` or a string comparison. Every command that runs tests first unsets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_PROFILE`, and a command that touches the database or the surface refuses a set `LOYALTY_IMAP_` variable. Dates come from Postgres, never the wall clock. File lists are built from git, never from a glob under `set -f` (42c2 A4.3). Run order: 1 to 4, then the rest (no migration step: this task adds none).

**Amendment A1 (orchestrator, at G0, 2026-11-23).** (1) The fixture directory was written by the orchestrator from a generator that holds a hand-written expectation for every case and refuses to write unless a reference implementation of "What the model receives" run over the real mailparser agrees with each one; the digest is pinned in command 13. (2) The HTML example under "The patterns" was wrong: mailparser drops the `mailto:` scheme when it renders an anchor, so a mailto link reaches the scrub as a bare address in brackets and becomes `[[address]]`. No address reaches the model either way; `F05` and `F07` pin the real counts. mailparser also wraps HTML-derived text at about 80 columns, which the `html-only` expectations follow. (3) A From line is matched case-insensitively (`/^from:/i` on the stripped line), as 42c1's `inlineForward` does; the fixtures use `From:` only, so this ruling binds the reviewer, not a test. (4) The oracle was run once against that reference implementation through a throwaway `vi.mock` file (removed afterwards): `Tests  3 passed (3)`. On the unmodified tree it gives `Tests  3 failed (3)` (T15). (5) Command 19 refused this spec's own #8, whose `sed -n` range of lines 408 to 410 reads as a comma-grouped figure (the defect 42c2's A1 met). #8 now prints the same three lines with `sed -n -e 408p -e 409p -e 410p`; the output is identical and #19 is unchanged.

**Amendment A2 (orchestrator, after G3 BLOCK cycle 1, 2026-11-23; REVIEW-1.md).** Two rules are added to "What the model receives", and both bind the implementation. (1) **Parse like the poll.** Every parse of stored bytes for the reader (the outer message and the chosen attached original) uses the same `ignoreEmbedded: true` that 42c1's poll uses. Without it, mailparser merges a `message/rfc822` part marked `Content-Disposition: inline` into the surrounding text, header lines included. The poll stores such a forward as `attachment`, so the reader must find the same part. This also stops a forward nested inside the chosen original from being unwrapped, and stops a stranger's inline original from being merged into a `direct` message. (2) **Bound before the scrub.** Step 1 of the order of operations ends by keeping only the first `maxChars + 1024` code points of the text, and the subject is cut to its first `300 + 1024` code points before step 2. The four patterns cost time that grows with the square of an unbroken run: the orchestrator measured several seconds at 80k characters, and a 1M-character run did not finish within 10 minutes. The stored-mail cap admits about 5 MB, and the run holds the read lock. The final cut in step 6 is unchanged and stays last, so the partial-address guarantee (control 5) holds for every token shorter than the 1024-character margin. The stated residual is that text whose scrub shortens it a lot (many long links) can come back shorter than `maxChars`. Fixtures: `F09.eml` (F03 with the rfc822 part marked inline, and a nested inline original inside it), the shapes `attach-inline-disposition` (F09, `attachment`) and `attach-inline-disposition-as-direct` (F09, `direct`), and a `longRun` group of four 120k-character runs (three bodies and one subject) whose expected result is the run's first `maxChars` or 300 code points. T42c3-U1 has a 30-second timeout. Against the cycle-1 code the oracle gives `Tests  3 failed (3)`: U2 fails on `attach-inline-disposition` alone, and U1 times out. Against the A2 reference implementation it gives `Tests  3 passed (3)` in about 2 s. The 42c2 fixtures R01 to R06 give the same reader input under A2 as under A1. Command 13 now expects 11 entries and 9 messages, the two new shape ids and the `longRun` group, and the new digest. The unit totals (#3) and the census (#16) are unchanged. Mutation evidence adds M15, dropping `ignoreEmbedded` (T42c3-U2), and M16, removing the bound before the scrub (T42c3-U1). The minimum stays at eight rows. Command 15's allowed-file pattern is widened from messages 1 to 8 to messages 1 to 9 (`F0[1-9]`), so that it admits F09. A2 first missed this, and the implementer's cycle-2 run of #15 caught it.

**Amendment A3 (orchestrator, after G3 BLOCK cycle 2, 2026-11-24; REVIEW-2.md).** This replaces A2's bound rule (2) and keeps A2 (1). **Token-safe bound.** Before the scrub, the text is limited to `maxChars + 1024` code points and the subject to `300 + 1024`, as in A2, with one addition. When the text is longer than the bound, and both the last kept code point and the first dropped code point are non-whitespace (the bound landed inside a token), the kept part also loses that whole trailing token, back to the last whitespace code point (`\s`) before it. If the kept part has no whitespace, it becomes empty: the text is then empty (`empty_message`), or the subject null. Why: none of the four patterns ever matches across whitespace, so every token the scrub sees is then complete, and the scrubbed prefix is a true prefix of the scrubbed full text. A2 claimed the partial-address guarantee held for tokens shorter than the margin. That was false: when the scrub shortens the text before the bound by more than the margin (many long links become `[link]`), the cut token lands inside the final `maxChars`. The orchestrator reproduced this against the A2 reference: the text sent ended in `zq42c3-an`. The final cut stays last. The stated residual is unchanged: the result can be shorter than `maxChars`, now also by the dropped token. Fixtures: the `longRun` entries carry `expect` (empty text, or a null subject, since no run has whitespace). A new `edge` group of recipes (`[text, times]` pairs) holds three cases. `cap-after-shrink` is the B1 shape and forbids `zq42c3-an`. `whitespace-past-margin` puts the first whitespace 1500 code points past `maxChars` and expects empty text, so any margin above roughly 1500 fails. `bound-on-whitespace` puts the bound on a space and expects nothing dropped. Against the cycle-2 code the oracle gives `Tests  1 failed | 2 passed (3)` (U1). Against the A2 reference, `cap-after-shrink` and `whitespace-past-margin` fail on their own. Against the A3 reference it gives `Tests  3 passed (3)`. The shapes, scrub cases, integration world and R01 to R06 are unchanged. Command 13 pins the new digest and the `edge` ids. Mutation evidence adds M17: drop the trailing-token rule, which fails T42c3-U1.

**How the carried-forward commands work (the 42a2 pattern).** Each carried block is read from the frozen 42c2 SPEC by line range, guarded by a prefix check on its first and last line so a moved line fails loudly instead of running something else, then run in its own `bash -c`. The shared lines at the top of each such command are:
`S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }`

| # | Command | Expected | Would break if |
|---|---|---|---|
| 1 | `(cd apps/web && npx tsc --noEmit --incremental false; echo "exit=$?")` | `exit=0` | the oracle's three-argument call does not type-check (so the `origin` seam is missing), or a consumer breaks |
| 2 | Lint, carried (42c2 #2), below | `OK lint 0 errors, warnings not above 5` | a lint regression, including in the oracle |
| 3 | Unit totals, below | `OK unit 112 files 1430 tests` | a missing or extra test file, an existing test broken or deleted |
| 4 | The oracle, two zones, below | two lines `OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=<zone>` | any scrub pattern, the block removal, the origin rule or the attached-original rule wrong; a no-op or stub (T15 shows it fails 3 of 3) |
| 5 | 42c2 unit scenarios, carried (42c2 #7), below | two lines `OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=<zone>` | a regression in 42c2's pinned fixtures (R01 to R06 through U4) |
| 6 | Dependencies and importers, carried (42c2 #4), below | `OK dependencies` | a dependency added; the SDK, `imapflow` or `mailparser` imported from a wrong file |
| 7 | Stored-state schema, carried (42c2 #6), plus no migration or schema change, below | `OK schema` then `OK no migration, no schema change` | a migration or schema edit; a forbidden column |
| 8 | Integration, carried (42c2 #8 with the total adjusted) plus `T42c3-I1` to `I3`, below | `OK 373 tests, … T42c2-I1-I14 each present once and passed`, `OK T42c3-I1-I3 each present once and passed in one file`, `OK no fixture rows left` | any 42c2 scenario regresses; the production wiring ignores the stored origin; a leaked row |
| 9 | Integration stability, carried (42c2 #9 chain), below | `[]`, `[]`, `OK failing set stable and within KNOWN` | an order-dependent or leaking new test |
| 10 | Regression block, carried (42c2 #10), below | two `OK 7 scenarios T42c1-U1..U7 …` lines, the eleven OK lines of 42b2 #9 and `fixture shape ok`, then `fixture shape ok`, `OK fixtures pinned and covered`, then `OK classes` | a 42a to 42c1 guarantee disturbed; a 42c1 fixture edited |
| 11 | Surface over real HTTP, carried (42c2 #11), below | `H1 PASS` to `H15 PASS` each once, last line `OK H1-H15`, then `OK surface` | any page or route behaviour changed |
| 12 | Registry unchanged, below | `OK registry unchanged` | a registry line added, removed or reclassified |
| 13 | New fixtures pinned, plus 42c2's fixtures (carried 42c2 #16), below | `fixture shape ok`, `OK new fixtures pinned and covered`, then `fixture shape ok`, `OK fixtures pinned and covered` | an edited fixture; a real-looking domain; a case id the tests never read |
| 14 | Source guards, below | `OK source guards` | a clock or float, console output, an error text, a removed line before the text section, a wrong importer, an environment read in the pure files |
| 15 | Scope guard, below | `OK scope` | a file outside the allowed set changed; a required file missing |
| 16 | Existing tests untouched and census, below | `OK existing tests untouched, census exact` | an existing test edited; an extra or missing test title |
| 17 | `npm run build; echo "exit=$?"` | `exit=0` | a type or bundling error |
| 18 | Mutation evidence, below | `OK mutation evidence rows <n>` with n at least 8 | fewer than eight recorded mutations, a mutation not shown failing |
| 19 | This spec's own public-safety scan, below | `OK spec has no money-looking text` | a figure or number in the spec |

**#2 (lint, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 251 255 'set -e; O="$(mktemp)"; npm run lint' 'echo "OK lint 0 errors'
```

**#3 (unit totals).** One new test file (the oracle, three tests) over the 42c2 baseline of 111 files and 1427 tests (T3).
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
O="$(mktemp)"; npm test > "$O" 2>&1 || true; tail -8 "$O"
[ "$(grep -cE 'Test Files +112 passed \(112\)' "$O")" = 1 ]
[ "$(grep -cE 'Tests +1430 passed \(1430\)' "$O")" = 1 ]
echo "OK unit 112 files 1430 tests"
```

**#4 (the oracle, two zones).**
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
for TZV in UTC Pacific/Auckland; do O="$(mktemp)"; (cd apps/web && TZ=$TZV npx vitest run lib/fixtures/loyalty-read-forwards/forwards.oracle.test.ts --reporter=json --outputFile="$O") || true; node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);let bad=[];for(const id of ["U1","U2","U3"]){const m=t.filter(x=>x.title.startsWith("T42c3-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const failed=t.filter(x=>x.status!=="passed").map(x=>x.title);if(bad.length||failed.length||t.length!==3||r.testResults.length!==1){console.log("FAIL",process.argv[2],bad.join(","),failed.join(";"),"files="+r.testResults.length);process.exit(1)}console.log("OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ="+process.argv[2])' "$O" "$TZV"; done
```

**#5 (42c2 unit scenarios, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 397 398 'set -e; unset ANTHROPIC_API_KEY' 'for TZV in UTC Pacific/Auckland'
```

**#6 (dependencies and importers, carried).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 269 278 'set -e; B="$(git merge-base HEAD main)"' 'echo "OK dependencies"'
```

**#7 (stored-state schema, carried, and no migration or schema change).**
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 374 392 'set -e; U=postgresql://localhost/b8_p42a_throwaway' 'echo "OK schema"'
B="$(git merge-base HEAD main)"; [ "$B" = "$(git rev-parse HEAD)" ]
[ -z "$(git diff --name-only "$B" -- migrations db packages)" ]
[ -z "$(git ls-files -o --exclude-standard migrations db packages)" ]
echo "OK no migration, no schema change"
```

**#8 (integration: 42c2's block with its total adjusted, then this task's three scenarios, then the cleanup check).** The only edit to the carried line is replacing its two occurrences of the digits `370` (the total it asserts and the total it prints) with `373`: 370 plus the three new tests. The guard asserts there are exactly two such occurrences, so any other change to that line fails.
```
set -e; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_PROFILE
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }
U=postgresql://localhost/b8_p42a_throwaway; O="$(mktemp)"; export O U
if env | grep -q '^LOYALTY_IMAP_'; then echo "FAIL a LOYALTY_IMAP_ variable is set in the environment"; exit 1; fi
G 407 "node -e 'const r=JSON.parse(require(\"fs\")"; G 408 'LEFT="$(psql '; G 409 '[ "$LEFT" = '; G 410 'echo "OK no fixture rows left"'
(cd apps/web && DATABASE_URL=$U npx vitest run --config vitest.integration.config.mts --reporter=json --outputFile="$O") || true
L407="$(sed -n '407p' "$S")"
[ "$(printf '%s' "$L407" | grep -o '370' | wc -l | tr -d ' ')" = 2 ]
bash -c "${L407//370/373}"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=r.testResults.flatMap(f=>f.assertionResults);const bad=[];for(const id of ["I1","I2","I3"]){const m=t.filter(x=>x.title.startsWith("T42c3-"+id+":"));if(m.length!==1||m[0].status!=="passed")bad.push(id+"="+m.map(x=>x.status).join("/")+"("+m.length+")")}const f=r.testResults.filter(x=>x.assertionResults.some(a=>a.title.startsWith("T42c3-")));if(bad.length||f.length!==1||!f[0].name.endsWith("apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts")){console.log("FAIL",bad.join(","),"files="+f.length);process.exit(1)}console.log("OK T42c3-I1-I3 each present once and passed in one file")' "$O"
bash -c "$(sed -n -e 408p -e 409p -e 410p "$S")"
```
The carried cleanup check counts every program named `ZQ42C%`, every household member named `ZQ42C%`, every stored message and every sender domain containing `zq42c`, so a `ZQ42C3` row left behind by the new test fails it. The new test must therefore also delete every stored message and reads row it creates.

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

**#11 (surface over real HTTP, carried).** This task adds no H step: the page and routes are unchanged, and with no key the surface server never reaches the text path. The command proves nothing regressed; the scope guard (15) proves the script itself is unchanged.
```
set -e; S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 446 457 'set -e; unset ANTHROPIC_API_KEY' 'echo "OK surface"'
```

**#12 (registry unchanged).** A guard against collateral change: a no-op implementation passes it by design; non-vacuity of the task is carried by commands 4 and 8.
```
set -ef; B="$(git merge-base HEAD main)"; R=apps/web/lib/giftSurfaceRegistry.ts
[ "$B" = "$(git rev-parse HEAD)" ]
[ -z "$(git diff --name-only "$B" -- "$R")" ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/read/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/readings/\[id\]/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
[ "$(grep -c "app/travel/page.tsx', classes: \['numeric-only'\]" "$R")" = 1 ]
[ "$(grep -c "'app/api/v1/loyalty/inbox/poll/route.ts', classes: \['no-transaction-data'\]" "$R")" = 1 ]
echo "OK registry unchanged"
```

**#13 (new fixtures pinned and covered, then 42c2's carried).** The orchestrator replaces `<DIGEST>` before G0 freezes; a command run before that fails on purpose.
```
set -e; D=apps/web/lib/fixtures/loyalty-read-forwards; IT=apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts
[ "$(ls "$D" | wc -l | tr -d ' ')" = 11 ]
[ "$(ls "$D"/*.eml | wc -l | tr -d ' ')" = 9 ]
SUM="$( (export LC_ALL=C; cd "$D"; shasum -a 256 *.eml cases.json forwards.oracle.test.ts | shasum -a 256 | cut -d' ' -f1) )"
[ "$SUM" = "92fc29ea63b53ab8d97b541c2245b870e76e6d10cf9b4f877cb326e6decd3be7" ]
node -e '
const fs=require("fs"),path=require("path");const d=process.argv[1];const bad=[];
const c=JSON.parse(fs.readFileSync(path.join(d,"cases.json"),"utf8"));
if(typeof c.note!=="string"||!/fabricated/i.test(c.note)||!c.note.includes("ZQ42C3"))bad.push("note");
const files=fs.readdirSync(d).filter(f=>f.endsWith(".eml")).sort();
for(let i=1;i<=9;i++){if(!files.includes("F0"+i+".eml"))bad.push("missing F0"+i)}
for(const g of ["canaries","envelope","shapes","scrub","inlineBlocks","cap","longRun","edge","integration"])if(!(g in c))bad.push("group "+g);
const ids=(g)=>Array.isArray(c[g])?c[g].map(x=>x.id):[];
const need={
 shapes:["direct-collisions","inline-forward","inline-forward-as-direct","attach-member","attach-member-as-direct","two-arg-call","attach-stranger","html-only","attach-inner-empty","attach-inner-html","attach-origin-no-part","attach-inline-disposition","attach-inline-disposition-as-direct"],
 scrub:["address-plain","address-angle-reply","address-uppercase","address-plus-tag","address-in-quote-prefix","address-two-on-line","address-then-path","mailto-bare","mailto-angle","tel-plain","tel-plus-digits","bare-link-path","bare-link-query","bare-link-fragment","bare-link-port-path","bare-link-uppercase","www-link","scheme-link","link-then-address-same-line","balance-decimal","balance-comma-grouped","balance-comma-grouped-decimals","multiplier-decimal-x","multiplier-decimal-x-slash","date-dotted-dmy","date-dotted-ymd","date-slashed-dmy","date-slashed-mdy","date-iso","time-dotted-slash","percent-and-fraction","version-like-slash","masked-bullets","masked-letter-x","masked-star","masked-ellipsis","suffix-hash","program-dotted-abbrev","program-fabricated-dotted-name","glued-dot-no-slash","bare-domain-no-path","file-name-like","abbrev-slash","one-letter-tld","hotel-colon","intel-colon","tel-colon-space","masked-address","at-sign-no-domain","address-without-tld-dot"],
 inlineBlocks:["gmail-style","outlook-style","apple-style","quoted-prefix","folded-to","reach-12-removed","reach-13-kept","no-from","two-blocks","block-to-end-of-text","from-line-only","marker-kept","body-after-blank-kept"],
 cap:["cap-splits-address"],
 longRun:["long-run-letters-body","long-run-dotted-body","long-run-local-part-body","long-run-dotted-subject"],
 edge:["cap-after-shrink","whitespace-past-margin","bound-on-whitespace"]};
for(const g of Object.keys(need))for(const id of need[g])if(!ids(g).includes(id))bad.push(g+" lacks "+id);
const okHost=(h)=>/(^|\.)(test|example|invalid)$/i.test(h)||/(^|\.)example\.(com|net|org)$/i.test(h);
const hosts=(t)=>{const r=[];for(const m of t.matchAll(/@([A-Za-z0-9.-]+[A-Za-z0-9])/g))r.push(m[1]);for(const m of t.matchAll(/:\/\/([A-Za-z0-9.-]+[A-Za-z0-9])/g))r.push(m[1]);for(const m of t.matchAll(/(?<![\w@])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24})(?=[\/?#])/g))r.push(m[1]);return r};
const all=[["cases.json",JSON.stringify(c)]].concat(files.map(f=>[f,fs.readFileSync(path.join(d,f),"utf8")]));
for(const [name,t] of all){if(!t.includes("ZQ42C3")&&name!=="cases.json")bad.push(name+" no canary");for(const h of hosts(t))if(!okHost(h))bad.push(name+" real-looking host "+h)}
if(bad.length){console.log("FAIL fixture shape:",bad.join(","));process.exit(1)}
console.log("fixture shape ok")' "$D"
[ "$(grep -cF 'loyalty-read-forwards' "$IT")" -ge 1 ] || { echo "FAIL $IT never loads the fixtures"; exit 1; }
for g in integration canaries shapes; do grep -qF "$g" "$IT" || { echo "FAIL the integration test never reads the group $g"; exit 1; }; done
[ "$(grep -cE "^[[:space:]]*import .*loyalty-read-forwards|loyalty-read-forwards" "$D/forwards.oracle.test.ts")" -ge 0 ]
LIT="['\"][-]?[0-9]+\.[0-9]{2,4}['\"]"
if grep -nE "$LIT" "$IT"; then echo "FAIL a figure literal in $IT"; exit 1; fi
echo "OK new fixtures pinned and covered"
S=plan/tasks/P8-42c2-loyalty-inbox-read/SPEC.md; G(){ case "$(sed -n "${1}p" "$S")" in "$2"*) ;; *) echo "FAIL $S line $1 moved"; exit 1;; esac; }; RUN(){ G "$1" "$3"; G "$2" "$4"; bash -c "$(sed -n "${1},${2}p" "$S")"; }
RUN 574 605 'set -e; D=apps/web/lib/fixtures/loyalty-read; I=' 'echo "OK fixtures pinned and covered"'
```
The `.eml` files are allowed to hold fabricated numeric collision shapes (F01 and the scrub cases need them); the check here is that every host and address domain is reserved and every `.eml` carries the canary. Figure literals are refused only in the implementer's test.

**#14 (source guards).**
```
set -ef; B="$(git merge-base HEAD main)"; [ "$B" = "$(git rev-parse HEAD)" ]
F=apps/web/lib/domain/loyaltyInbox.ts; T=apps/web/lib/domain/loyaltyInboxText.ts; R=apps/web/lib/loyaltyInboxRead.ts; IT=apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts
added(){ if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then git diff -U0 "$B" -- "$1" | grep -E '^\+[^+]' | sed 's/^+//' || true; else cat "$1"; fi; }
for f in "$F" "$R" "$IT"; do [ -f "$f" ] || { echo "FAIL missing $f"; exit 1; }; done
[ -n "$(git diff --name-only "$B" -- "$F")" ]
[ -n "$(git diff --name-only "$B" -- "$R")" ]
BAN='toISOString|new Date\(|Date\.now\(|getTime\(|setDate\(|setHours\(|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|parseFloat|toFixed|Math\.round'
for f in "$F" "$T" "$R" "$IT"; do
  [ -f "$f" ] || continue
  if added "$f" | grep -nE "$BAN"; then echo "FAIL clock or float in $f"; exit 1; fi
  if added "$f" | grep -nE '^[[:space:]]*(//|/\*|\*)' | grep -E '[0-9]+\.[0-9]{2}([^0-9]|$)|\$[0-9]'; then echo "FAIL a money-looking figure in an added comment of $f"; exit 1; fi
done
for f in "$F" "$T" "$R"; do
  [ -f "$f" ] || continue
  if added "$f" | grep -nE 'console\.'; then echo "FAIL console output in $f"; exit 1; fi
  if added "$f" | grep -nE 'err(or)?\.message|\)\.message|String\((err|error|e)\)|\.stack|JSON\.stringify\((err|error|e)\)'; then echo "FAIL a library error text may reach a log or response in $f"; exit 1; fi
done
for f in "$F" "$T"; do
  [ -f "$f" ] || continue
  if grep -nE 'process\.env|raw_mail|ANTHROPIC_API_KEY' "$f"; then echo "FAIL environment, raw_mail or key named in $f"; exit 1; fi
done
if [ -f "$T" ]; then if grep -nE "from '(mailparser|@anthropic-ai/sdk|imapflow|pg|next[^']*|@/lib/db|\./db)'" "$T"; then echo "FAIL the pure text file imports something it must not"; exit 1; fi; fi
N0="$(git show "$B:$F" | grep -n 'What the reader is sent (P8-42c2)' | head -1 | cut -d: -f1)"; [ -n "$N0" ]
if git diff -U0 "$B" -- "$F" | awk -v n="$N0" '/^@@/{split($2,a,","); s=substr(a[1],2)+0; c=(a[2]==""?1:a[2])+0; if (c>0 && s<n) bad=1} END{exit bad?0:1}'; then echo "FAIL a line before the text-for-reader section of $F was removed or changed"; exit 1; fi
PL="$(cat "$F"; if [ -f "$T" ]; then cat "$T"; fi)"
[ "$(printf '%s\n' "$PL" | grep -cF '[address]')" -ge 1 ]
[ "$(printf '%s\n' "$PL" | grep -cF '[link]')" -ge 1 ]
[ "$(grep -cE 'textForReader\(' "$R")" -ge 1 ]
[ "$(grep -cF 'b8:loyalty-inbox:read' "$R")" = 1 ]
[ "$(grep -cF 'b8:loyalty-inbox:poll' "$R")" = 0 ]
RMW="$(grep -rlF 'raw_mail' apps/web/lib apps/web/app apps/web/components apps/web/scripts | grep -vE '\.test\.ts$|gifts-surface-check\.mjs$|/fixtures/' | sort | tr '\n' ' ')"
[ "$RMW" = "apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts " ]
if grep -nE '(^|[^[:alnum:]_])(FROM|JOIN)[[:space:]]+(transactions|accounts|account_valuations)([^[:alnum:]_]|$)' "$R"; then echo "FAIL a ledger read in $R"; exit 1; fi
if grep -nE "['\"][0-9]{4,}['\"]" "$IT"; then echo "FAIL a digit-only quoted string of four or more digits in $IT"; exit 1; fi
echo "OK source guards"
```

**#15 (scope guard).**
```
set -f; B="$(git merge-base HEAD main)"; [ "$B" = "$(git rev-parse HEAD)" ]
CH="$(mktemp)"; { git diff --name-only "$B"; git ls-files -o --exclude-standard; } | grep -v '^plan/' | sort -u > "$CH"
OUT="$(grep -vE '^(apps/web/lib/domain/loyaltyInbox\.ts|apps/web/lib/domain/loyaltyInboxText\.ts|apps/web/lib/loyaltyInboxRead\.ts|apps/web/app/api/v1/loyalty/loyaltyReadForwards\.test\.ts|apps/web/lib/fixtures/loyalty-read-forwards/(F0[1-9]\.eml|cases\.json|forwards\.oracle\.test\.ts))$' "$CH" || true)"
[ -z "$OUT" ] || { echo "OUTSIDE THE ALLOWED SET:"; echo "$OUT"; exit 1; }
for f in apps/web/lib/domain/loyaltyInbox.ts apps/web/lib/loyaltyInboxRead.ts apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts apps/web/lib/fixtures/loyalty-read-forwards/cases.json apps/web/lib/fixtures/loyalty-read-forwards/forwards.oracle.test.ts apps/web/lib/fixtures/loyalty-read-forwards/F01.eml apps/web/lib/fixtures/loyalty-read-forwards/F08.eml; do grep -qxF "$f" "$CH" || { echo "MISSING $f"; exit 1; }; done
[ -z "$(git diff --name-only "$B" -- migrations db packages apps/web/package.json package.json package-lock.json 'apps/web/vitest*' evals apps/web/scripts apps/web/lib/loyaltyReader.ts apps/web/lib/loyaltyInbox.ts apps/web/lib/loyaltyInboxSource.ts apps/web/lib/loyaltyStore.ts apps/web/lib/scheduler.ts apps/web/lib/giftSurfaceRegistry.ts apps/web/lib/domain/loyaltyRead.ts apps/web/app apps/web/components)" ] || { echo "FAIL a frozen file changed"; exit 1; }
echo "OK scope"
```
The last list covers every file the Non-goals freeze; the only changed files under `apps/web/app` are untracked (the new integration test), which `git diff` against `HEAD` does not list, and the first grep already confines them.

**#16 (existing tests untouched, census exact).**
```
set -f; B="$(git merge-base HEAD main)"; [ "$B" = "$(git rev-parse HEAD)" ]
[ -z "$(git diff --name-only "$B" -- '*.test.ts' '*.test.tsx' '*.test.mts')" ] || { echo "FAIL a tracked test file changed"; exit 1; }
[ -z "$(git diff --name-only "$B" -- apps/web/lib/fixtures/loyalty-read apps/web/lib/fixtures/loyalty-inbox)" ] || { echo "FAIL an existing fixture changed"; exit 1; }
NEW="$(git ls-files -o --exclude-standard | grep -E '\.test\.(ts|tsx|mts)$' | sort | tr '\n' ' ')"
[ "$NEW" = "apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts apps/web/lib/fixtures/loyalty-read-forwards/forwards.oracle.test.ts " ] || { echo "FAIL the set of new test files is wrong: $NEW"; exit 1; }
IT=apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts; OR=apps/web/lib/fixtures/loyalty-read-forwards/forwards.oracle.test.ts
[ "$(grep -cE "^[[:space:]]*(it|test)\(" "$IT")" = 3 ]
[ "$(grep -cE "it\('T42c3-I[1-3]:" "$IT")" = 3 ]
[ "$(grep -cE "^[[:space:]]*(it|test)\(" "$OR")" = 3 ]
[ "$(grep -cE "it\('T42c3-U[1-3]:" "$OR")" = 3 ]
echo "OK existing tests untouched, census exact"
```

**#18 (mutation evidence).** The implementer records, in `plan/tasks/P8-42c3-loyalty-read-forwards/EVIDENCE.md`, one table row per deliberate mutation: `| M<n> | <file and change in words> | <the failing test id> | FAIL | reverted, green |`.
```
set -e; E=plan/tasks/P8-42c3-loyalty-read-forwards/EVIDENCE.md
[ -f "$E" ]
N="$(grep -cE '^\| M[0-9]+ \|.*\| FAIL \|.*reverted' "$E")"
[ "$N" -ge 8 ] || { echo "FAIL only $N mutation rows with FAIL and reverted"; exit 1; }
for id in 'T42c3-U1' 'T42c3-U2' 'T42c3-U3' 'T42c3-I1' 'T42c3-I2' 'T42c3-I3'; do grep -qF "$id" "$E" || { echo "FAIL no mutation row names $id"; exit 1; }; done
if grep -nE '\$[0-9]{3,}|[0-9]{1,3}(,[0-9]{3})+|ZQ42C3-[A-Z]+-[0-9]{4,}' "$E"; then echo "FAIL EVIDENCE.md holds a money-looking or number-looking figure"; exit 1; fi
echo "OK mutation evidence rows $N"
```

**#19 (this spec's own public-safety scan).** A 64-character hex digest is removed before the scan so a digest cannot trip the long-number rule.
```
set -e; S=plan/tasks/P8-42c3-loyalty-read-forwards/SPEC.md; T="$(mktemp)"; sed -E 's/[0-9a-f]{64}//g' "$S" > "$T"
if grep -nE '\$[0-9]{3,}|\$[0-9]{1,3},[0-9]{3}|\$[0-9]+\.[0-9]{2}' "$T"; then echo "FAIL a dollar figure in the spec"; exit 1; fi
if grep -nE '[0-9]{1,3}(,[0-9]{3})+' "$T"; then echo "FAIL a thousands-separated figure in the spec"; exit 1; fi
BAD="$(grep -oE '[0-9]{6,}' "$T" | sort -u || true)"
[ -z "$BAD" ] || { echo "FAIL a long number in the spec: $BAD"; exit 1; }
if grep -nEi 'member number [0-9]|balance of [0-9]' "$T"; then echo "FAIL a balance or number stated in the spec"; exit 1; fi
echo "OK spec has no money-looking text"
```

### Existing state this task must not change, and what was not carried
- 42c2 #3, #8 (totals), #12, #13, #14, #15, #17 and #18 are **not** re-run as written: they pin totals, merge-base diffs, a "no removed line in `domain/loyaltyInbox.ts`" rule this task must break inside the text section, or the 42c2 change set. Their intent is carried by commands 3, 8, 12, 14, 15, 16, 18 and 19 here.
- 42c2 #5 (migration up-down-up) is not re-run: this task adds no migration; commands 7 and 15 prove none was added and the schema is untouched.
- 42c2 #1 is re-run as command 1, #2 as 2, #4 as 6, #6 as 7, #7 as 5, #9 as 9, #10 as 10, #11 as 11, #16 as part of 13.

## Scenarios
Fixture canary `ZQ42C3`. Every expected `subject`, `text`, count and state is read from `cases.json`, never written in a test body. Group assertions end with `expect(seen).toEqual(<ids from cases.json>)`.

| Id | Observable rule | Fixture and assertion | Catches |
|---|---|---|---|
| T42c3-U1 | The scrub replaces exactly what the patterns name and leaves every collision shape byte-identical. | Oracle, over `scrub` and `cap`: each body wrapped in the `envelope` and passed through `textForReader`; the returned text equals the entry's expectation exactly. Scrubbed ids give `[address]` or `[link]` in the stated places (an address in angle brackets keeps its brackets; `mailto:` and `tel:` links become `[link]`; a scheme-less link with a path, query, fragment or port becomes `[link]`; an address followed by a path becomes one `[address]`). Unchanged ids come out equal to their input: grouped and decimal amounts, one-decimal multipliers with and without a slash, dotted and slashed and ISO dates, a dotted time before a slash, percent and fraction, a version-like string before a slash, masked bullets, letters, stars and ellipsis, a hash-prefixed suffix, dotted abbreviations and fabricated dotted program names, a sentence-end glued by a dot, a bare domain with no path, a file name, `e.g.`/`i.e.` abbreviations, a one-letter last label, `Hotel:` and `Intel:`, `Tel:` followed by a space, a masked-local address, a bare `@`, an address with no dot in its domain. `cap-splits-address` returns at most `maxChars` code points and contains no part of the local-part canary. The subject goes through the same scrub (`F03`'s original subject, F02's `Fwd:` subject). | A bare-link pattern that eats a decimal, date, multiplier, masked number or program name; a missing `mailto:` or `tel:` rule; an address pattern that skips quoted or reply lines; a cut before the scrub; a placeholder with the wrong spelling. |
| T42c3-U2 | What the model receives for each message shape. | Oracle, over `shapes`: `{ subject, text }` has exactly those keys; `attach-member` returns the **original's** subject and text (inner subject and inner body canaries present; outer note, outer subject, every outer and inner header address, the stranger canary and every address canary absent; the inner link and address replaced); `attach-member-as-direct` and `two-arg-call` return the covering note and outer subject (inner body canary absent); `attach-stranger` returns the outer note only (stranger canary absent); `attach-origin-no-part` returns the outer note; `attach-inner-empty` returns an empty text and the original's subject, with the outer note canary absent; `attach-inner-html` returns text with no markup, no `<script>` canary, the inner body canary, and no address; `html-only` returns text with the `mailto:` and `tel:` links and the visible bare address replaced, the scheme link replaced, no `href`, and the exact `[link]` and `[address]` counts the fixture states; `inline-forward` and `inline-forward-as-direct` return identical text (origin does not affect the block removal) with the header block absent, the marker line and the inner body present. | A covering note sent beside or instead of the statement; an attachment read for a stranger or for a non-`attachment` origin; the outer subject sent for an attachment; a fall-back to the outer note when the original is empty; an inner header leaked; markup or script text sent. |
| T42c3-U3 | The inline-forward header block is removed exactly as defined. | Oracle, over `inlineBlocks`: each entry's `lines` through the envelope gives exactly `expectLines` joined by LF. Gmail, Outlook and Apple shapes lose the whole block and keep the body and blank separator; a `>`-quoted block is removed with its quote prefixes while quoted body lines keep theirs; folded continuation lines go with the block; a From line on the twelfth line after the marker removes the block, on the thirteenth keeps it (its addresses still `[address]`); a marker with no From keeps everything; a forward of a forward loses both blocks; a block at the very end of the text is removed to the end; the marker line and body after the blank line are kept. | An off-by-one in the twelve-line reach; removing only the From line; removing through the body; removing the marker; removing only the first block; dropping quote-prefixed blocks. |
| T42c3-I1 | The production wiring passes the stored origin, per message, and nothing else. | DB test, seeding what it asserts on: `household_member_addresses` stays empty (asserted), one program with a sender domain, and nine stored rows from `F01` to `F08` with the stored origins of the Prerequisites table (`F03` stored twice, once `attachment`, once `direct`). A recording fake reader (mock `createMailReader`, key canary set by the test) answers every call with an empty reading. Each recorded input equals the fixture's expectation for its row exactly (object keys exactly `subject` and `text`); the reader is called eight times, not nine: `F06` is not offered (its row is `failed` / `empty_message`, attempts 1, and the outer note canary appears in no recorded input); the `attachment`-origin `F03` input holds the inner body, the `direct`-origin copy of the same bytes holds the covering note; `F04` holds no stranger canary. | A hard-coded origin; a read-time lookup of member addresses (the table is empty, so it would read the outer note); the stored origin ignored; an attached original read for `direct`; a model call for an empty original. |
| T42c3-I2 | An attached forward now yields a balance, through the unchanged decision rules, and leaks nothing. | DB test over the `integration` world: the fake reader answers with the fixture's reading only when its input's text contains the inner body canary, and with `api_error` otherwise. `F03` stored `attachment` is read once; its row ends `applied` with one new `loyalty_observations` row of source `email`, the fixture's balance, unit and as-of, and the membership's current balance is the fixture's; the reader's input subject is the original's. The same bytes stored as `direct` (a second key) are read as the covering note, the fake answers `api_error`, and that row is `retry` (attempts 1) with no observation. Across every response body and every captured log line of the file (console and logger), none contains the key canary, the full member number canary, any address in `canaries.addresses`, any link host, or the outer note canary. | A statement that still never reaches the decision rules; a stored origin that does not control the read; an address or host in a log or response. |
| T42c3-I3 | Messages already read are not re-read automatically; the explicit action still works. | DB test: an `F03` message stored `attachment` with an existing reads row in state `no_balance` (what 42c2 recorded) is not offered by `readStoredMail()` (the fake reader's call count does not grow, the row is unchanged by a whole-row checksum), and is not offered by `readStoredMail({ retryFailed: true })` either (only `failed` rows are reset). A second `F03` message with a `failed` reads row (attempts 3, code `bad_output`) is reset by `retryFailed: true` and read again, and its recorded input is the original's. A row in each of `applied`, `stale`, `pending`, `ignored` and `not_mine` state is likewise never offered. | An automatic re-read of old attached-forward messages; `retryFailed` resetting more than `failed` rows; a re-read that bypasses the lock. |

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | The covering note of an attached forward is not sent | `F03` stored `attachment`: the `outerNote` canary and the outer subject must be absent from subject and text | T42c3-U2, T42c3-I1, T42c3-I2, commands 4 and 8 |
| 2 | The attached original is read only for stored origin `attachment` | `F03` bytes with origin omitted, `direct` or `inline` (covering note read, inner body absent); `F04` (a stranger's attachment, stored `direct`) | T42c3-U2, T42c3-I1, commands 4 and 8 |
| 3 | An empty attached original never falls back to the covering note | `F06`: empty text, outer note canary absent, no model call, row `failed` / `empty_message` | T42c3-U2, T42c3-I1 |
| 4 | An `attachment` origin with no `message/rfc822` part reads the outer message | `F08` | T42c3-U2, T42c3-I1 |
| 5 | The cut comes after the scrub, so no partial address is left | `cap-splits-address`: an address beginning within five characters of the limit | T42c3-U1 |
| 6 | A decimal or comma-grouped amount is not a link | `balance-decimal`, `balance-comma-grouped`, `balance-comma-grouped-decimals` come out byte-identical | T42c3-U1 |
| 7 | A multiplier is not a link | `multiplier-decimal-x`, `multiplier-decimal-x-slash` byte-identical | T42c3-U1 |
| 8 | Dotted and slashed dates and times are not links | `date-dotted-dmy`, `date-dotted-ymd`, `date-slashed-dmy`, `date-slashed-mdy`, `date-iso`, `time-dotted-slash` byte-identical | T42c3-U1 |
| 9 | Masked member numbers and suffixes are not touched | `masked-bullets`, `masked-letter-x`, `masked-star`, `masked-ellipsis`, `suffix-hash` byte-identical | T42c3-U1 |
| 10 | Program names with dots are not links | `program-dotted-abbrev`, `program-fabricated-dotted-name`, `abbrev-slash`, `one-letter-tld` byte-identical | T42c3-U1 |
| 11 | A sentence end glued by a dot, a bare domain and a file name are not links | `glued-dot-no-slash`, `bare-domain-no-path`, `file-name-like` byte-identical | T42c3-U1 |
| 12 | Percent, fraction and version strings are not links | `percent-and-fraction`, `version-like-slash` byte-identical | T42c3-U1 |
| 13 | `Hotel:` and `Intel:` are not `tel:` links; `Tel:` followed by a space is not one | `hotel-colon`, `intel-colon`, `tel-colon-space` byte-identical | T42c3-U1 |
| 14 | A masked-local address, a bare `@` and an address with no dot in its domain are not addresses (stated residual) | `masked-address`, `at-sign-no-domain`, `address-without-tld-dot` byte-identical | T42c3-U1 |
| 15 | Every address, in any position, is replaced | `address-plain`, `address-angle-reply`, `address-uppercase`, `address-plus-tag`, `address-in-quote-prefix`, `address-two-on-line`, `address-then-path`, and the inner and outer header addresses | T42c3-U1, T42c3-U2, T42c3-I2 |
| 16 | `mailto:` and `tel:` links, including those rendered from HTML, are replaced | `mailto-bare`, `mailto-angle`, `tel-plain`, `tel-plus-digits`, `F05`, `F07`; the I-2 result `mailtoAddr:true` must now be false | T42c3-U1, T42c3-U2 |
| 17 | A scheme-less link with a path, query, fragment or port is replaced | `bare-link-path`, `bare-link-query`, `bare-link-fragment`, `bare-link-port-path`, `bare-link-uppercase` | T42c3-U1 |
| 18 | Today's `scheme://` and `www.` links are still replaced | `scheme-link`, `www-link`, `R01` of 42c2 | T42c3-U1, command 5 |
| 19 | The inline header block is removed, the body is kept | `gmail-style`, `outlook-style`, `apple-style`, `quoted-prefix`, `folded-to`, `from-line-only`, `block-to-end-of-text`, `F02` | T42c3-U3, T42c3-U2 |
| 20 | The reach is exactly twelve lines | `reach-12-removed` removed; `reach-13-kept` kept (addresses still `[address]`); `no-from` untouched | T42c3-U3 |
| 21 | Only the block goes: marker, separator and body stay; every block of a chain goes | `marker-kept`, `body-after-blank-kept`, `two-blocks` | T42c3-U3 |
| 22 | The reader's input has no key beyond `subject` and `text` | any extra key on the object | T42c3-U2, T42c3-I1 |
| 23 | Already-read messages are not re-read | reads rows in `no_balance`, `applied`, `stale`, `pending`, `ignored`, `not_mine` for stored attached forwards | T42c3-I3 |
| 24 | No address or link host appears in any response or log line | the address and host canaries of `cases.json` in every body and log line of the integration file | T42c3-I2 |
| 25 | Nothing outside the text path changed | any edit to a frozen file, a migration, the reader, the surface script, an existing test or fixture | commands 6, 7, 11, 12, 15, 16 |

## Evidence required
- `EVIDENCE.md` at `plan/tasks/P8-42c3-loyalty-read-forwards/EVIDENCE.md` with: the verbatim output of every acceptance command (numbers inside assertion diffs redacted); the docs under `node_modules/next/dist/docs/` read, if any (none is expected: no component or route handler changes).
- A **shape table** over the `shapes` fixture printing only: case id, the origin argument, whether `subject` is null, the character count of `text`, the count of `[link]`, the count of `[address]`, and PASS. Never a subject, a text, an address or a figure.
- A **control table** listing each `scrub`, `inlineBlocks` and `cap` id with PASS and no strings.
- The **before and after of the two G3 INCONCLUSIVE probes**, as booleans only, produced by calling the real `textForReader` on `F03` (stored `attachment`) and `F05`: before this task the P8-42c2 results were `embeddedBody:false` and `mailtoAddr:true`; after, the original's body is present and no address or `mailto:` host is.
- **Mutation evidence** (command 18): at least eight deliberate single-line breaks, each shown failing the named test and then reverted. The implementer chooses at least these: M1 drop the `mailto|tel` rule (T42c3-U1); M2 let the bare-link pattern accept a last label that starts with a digit, or drop the `(?=[/?#])` requirement (T42c3-U1); M3 run the cut before the scrub (T42c3-U1); M4 replace `[address]` with the empty string or leave quoted lines unscrubbed (T42c3-U1); M5 change the twelve-line reach to eleven or thirteen (T42c3-U3); M6 remove only the From line, or remove through the body (T42c3-U3); M7 always use the attached original regardless of the stored origin (T42c3-I1); M8 never use the attached original (T42c3-U2, T42c3-I2); M9 send the covering note together with the original, or fall back to it when the original is empty (T42c3-U2, T42c3-I1); M10 decide by looking up `household_member_addresses` instead of the stored origin (T42c3-I1, T42c3-I2); M11 pass the outer subject for an attached forward (T42c3-U2); M12 apply block removal only for origin `inline` (T42c3-U2); M13 let `retryFailed` reset every state (T42c3-I3).
- The residual-risk sentences of the Non-goals (names, postal addresses, plain phone numbers, masked-local and non-ASCII addresses, a word glued to a slash by a dot) reproduced, so the owner knows what still reaches Anthropic.

## Failure modes to test
- **Over-scrub: a scheme-less pattern eating content.** A host pattern without the letters-only last label or without the path requirement turns `12.5`-style decimals, comma-grouped amounts, `1.5x/dollar`, dotted dates (`20.11.2026`), dotted times before a slash, version strings, `e.g./i.e.`, `U.S.` style names, `points.Thanks` and file names into `[link]`, silently corrupting a balance or a date before the model reads it. This is the highest-cost failure of the task: the app would read a wrong or missing balance.
- **Under-scrub: order of rules.** `anna@track.brand.example/u?t=…` becoming `anna@[link]` (the local part leaks) when the bare-link rule runs before the address rule; a `mailto:` address left because the address rule ran first on a `mailto:` token and the link rule then found nothing; `Contact [[link]]` bracket handling from HTML rendering.
- **Cut before scrub.** An address straddling the character limit leaves `anna@exa` (the local part and a partial domain). The cut is last.
- **Case.** `MAILTO:`, `Tel:`, uppercase hosts and uppercase addresses must match (flag `i`), while `Hotel:` must not.
- **The attached original.** Reading the outer message instead (the 42c2 behaviour); reading both; reading the first part only when the stored origin says so; picking a later `message/rfc822` part; sending the original's headers (From, To, Cc, Delivered-To, Date); the outer `Fwd:` subject sent beside an original with no subject; an original with no text falling back to the covering note; an original that is HTML only sending markup or script text; a nested forward unwrapped; the original's own attachments read.
- **Origin handling.** A hard-coded `attachment`; the stored origin dropped on the way from the SQL row to the call; a candidate row whose `origin` is not selected; the default for an omitted argument not being `direct`; a stranger's mail with a `message/rfc822` part read as a forward because the bytes alone were inspected; a registered-address lookup at read time that returns nothing in a test with an empty table and reads the covering note.
- **Block removal boundaries.** A From line on the twelfth versus thirteenth line; the marker removed with the block; the blank separator removed and the body glued to the next paragraph; the block run into the statement body because the block ended at a line that merely looks like a header; a quote-prefixed block half-removed; a folded `To:` list leaving its continuation lines (and so addresses, which the address rule then catches, but the shape must still be removed); a forward of a forward leaving the second block; a block at the very end of the text.
- **Empty and null.** An empty original giving the string `null` or the covering note; a subject that is only an address becoming null; a subject of only a removed link becoming blank and not null; `trim` order changing which text is "empty".
- **Re-read.** A change that offers `no_balance` rows of old attached forwards again; `retryFailed` deleting more than `failed` rows; a re-read that does not take the lock.
- **Privacy.** An address, link host, covering-note text or original header in any log line, response body or stored column; the placeholder counts stored; the reader input gaining a key.
- **Size and bounds.** The 20000-code-point text bound and the 300-code-point subject bound applied before instead of after the scrub; a surrogate pair split by the cut; the bound applied to the covering note and not to the original.
- **Determinism.** A test or fixture that depends on the wall clock, the machine's time zone (commands 4 and 5 run two zones), the order of tests, or a leftover row (command 8's cleanup check).
- **Tooling traps.** A carried command whose extracted line moved (the guards fail loudly); the `370` substitution touching a different token; a glob expanding under `set -f` in a file list; a `node -e` argument read as `process.argv[2]`.

## Rollback
1. Revert the code with `git revert` of the task's commit(s): `domain/loyaltyInbox.ts`, the optional `domain/loyaltyInboxText.ts`, `loyaltyInboxRead.ts`, the new integration test and the fixture directory go together.
2. There is **no migration, no `down` and no CSV restore**: the task adds no table, column or constant.
3. Rows written while the change was live remain valid and are not rewritten by the revert: a message of an attached forward read from its original is a normal `loyalty_inbox_reads` row, and any `loyalty_observations` row it auto-applied (source `email`) is real history and stays (append-only; a wrong balance is corrected by a newer typed reading, as 42c2 states). After a revert, such a message is not re-read (it has a reads row); to read an attached-forward message again under either version, delete its reads row by SQL after checking it is not `applied` or `applied_by_hand` (42c2 OQ18), or let `retryFailed` reset a `failed` one.
4. Messages of attached forwards read under 42c2, before this task, keep their existing rows (most likely `no_balance`). Re-reading them is a deliberate operator action by the same SQL delete; this task does not do it.
# P8-42c3 — Evidence (cycle 3, amendment A3)

## Status

All 19 acceptance commands pass as written, each on its first run of cycle 3. The implementer ran every one from the
repo root under `/bin/bash`, with every `ANTHROPIC_` variable unset, no `LOYALTY_IMAP_` variable set, and
`postgresql://localhost/b8_p42a_throwaway` as the database. The runs came after the A3 change and after every mutation
was reverted. Before the run, the dataless-file check (T12) printed `0`. The iCloud conflict copy
`apps/web/lib/zq42c3-probe.test 2.ts`, which failed #2 in cycle 2, was no longer in the tree. After the run, the
throwaway database held no `ZQ42C` rows (#8's cleanup check).

Both cycle-2 problems are gone:
- #15 now allows `F0[1-9]`.
- #9 printed `[]`, `[]` and `OK failing set stable and within KNOWN` on its only run.

## What the code does (cycles 1 to 3)

- `apps/web/lib/domain/loyaltyInbox.ts`. Every change is inside the "What the reader is sent" section; command 14
  checks that.
  - `textForReader(raw, maxChars, origin = 'direct')` reads the first `message/rfc822` part only when the stored origin
    is `attachment`.
  - Every parse uses `ignoreEmbedded: true` (A2 rule 1). `READ_PARSE` carries the flag; 42c1's `PARSE` is not reused
    because it skips the HTML-to-text conversion.
  - It removes inline-forward header blocks with 42c1's own `MARKER`, `MARKER_REACH` and `unquote`.
  - Before the scrub, it bounds the text to `maxChars + SCRUB_MARGIN_CHARS` and the subject to
    `300 + SCRUB_MARGIN_CHARS` with `tokenSafePrefix` (A3).
  - It scrubs in the spec's order (URL, then `mailto:`/`tel:`, then address, then scheme-less link), trims, and cuts
    last.
- `tokenSafePrefix`, new in cycle 3:
  - It splits the text into code points once.
  - If the text fits the bound, it is returned unchanged.
  - If the last kept and the first dropped code points are both non-whitespace, a backward scan drops the trailing
    token back to the last whitespace. With no whitespace left, the kept part is empty.
  - Nothing else is dropped.
  - It is linear and runs no pattern over the kept string. The comment explains why a whole token goes: no pattern
    matches across whitespace, so every token the scrub sees is complete.
- `apps/web/lib/loyaltyInboxRead.ts` selects `m.origin`, carries it on `Candidate` as `LoyaltyInboxOrigin`, and passes
  it to `textForReader`. `retryFailed` is unchanged: it already reset `failed` rows only.
- `apps/web/app/api/v1/loyalty/loyaltyReadForwards.test.ts` is new and holds T42c3-I1 to I3.

The optional `apps/web/lib/domain/loyaltyInboxText.ts` was not created. The block removal reuses 42c1's unexported
constants, and exporting them would change a line before the text section, which command 14 refuses.

No contract was found wrong, and none was touched. No UI changed.

## Docs read and skills invoked

No document under `node_modules/next/dist/docs/` was read: no component, layout or route handler changed. The
`caveman` skill was invoked for the reports to the orchestrator only.

## Shape table (the `shapes` fixture through the real `textForReader`)

Counts and booleans only. "text chars" is a count of code points.

| case | origin argument | subject null | text chars | [link] | [address] | result |
|---|---|---|---|---|---|---|
| direct-collisions | omitted | false | 1267 | 12 | 9 | PASS |
| inline-forward | inline | false | 211 | 1 | 1 | PASS |
| inline-forward-as-direct | direct | false | 211 | 1 | 1 | PASS |
| attach-member | attachment | false | 122 | 1 | 1 | PASS |
| attach-member-as-direct | direct | false | 69 | 0 | 1 | PASS |
| two-arg-call | omitted | false | 69 | 0 | 1 | PASS |
| attach-stranger | direct | false | 56 | 0 | 0 | PASS |
| html-only | direct | false | 127 | 3 | 2 | PASS |
| attach-inner-empty | attachment | false | 0 | 0 | 0 | PASS |
| attach-inner-html | attachment | false | 52 | 0 | 2 | PASS |
| attach-origin-no-part | attachment | false | 75 | 0 | 1 | PASS |
| attach-inline-disposition | attachment | false | 45 | 0 | 0 | PASS |
| attach-inline-disposition-as-direct | direct | false | 69 | 0 | 1 | PASS |

## Control table (`scrub`, `inlineBlocks`, `cap`, `longRun` and `edge`)

| group | case | result |
|---|---|---|
| scrub | address-plain | PASS |
| scrub | address-angle-reply | PASS |
| scrub | address-uppercase | PASS |
| scrub | address-plus-tag | PASS |
| scrub | address-in-quote-prefix | PASS |
| scrub | address-two-on-line | PASS |
| scrub | address-then-path | PASS |
| scrub | mailto-bare | PASS |
| scrub | mailto-angle | PASS |
| scrub | tel-plain | PASS |
| scrub | tel-plus-digits | PASS |
| scrub | bare-link-path | PASS |
| scrub | bare-link-query | PASS |
| scrub | bare-link-fragment | PASS |
| scrub | bare-link-port-path | PASS |
| scrub | bare-link-uppercase | PASS |
| scrub | www-link | PASS |
| scrub | scheme-link | PASS |
| scrub | link-then-address-same-line | PASS |
| scrub | balance-decimal | PASS |
| scrub | balance-comma-grouped | PASS |
| scrub | balance-comma-grouped-decimals | PASS |
| scrub | multiplier-decimal-x | PASS |
| scrub | multiplier-decimal-x-slash | PASS |
| scrub | date-dotted-dmy | PASS |
| scrub | date-dotted-ymd | PASS |
| scrub | date-slashed-dmy | PASS |
| scrub | date-slashed-mdy | PASS |
| scrub | date-iso | PASS |
| scrub | time-dotted-slash | PASS |
| scrub | percent-and-fraction | PASS |
| scrub | version-like-slash | PASS |
| scrub | masked-bullets | PASS |
| scrub | masked-letter-x | PASS |
| scrub | masked-star | PASS |
| scrub | masked-ellipsis | PASS |
| scrub | suffix-hash | PASS |
| scrub | program-dotted-abbrev | PASS |
| scrub | program-fabricated-dotted-name | PASS |
| scrub | glued-dot-no-slash | PASS |
| scrub | bare-domain-no-path | PASS |
| scrub | file-name-like | PASS |
| scrub | abbrev-slash | PASS |
| scrub | one-letter-tld | PASS |
| scrub | hotel-colon | PASS |
| scrub | intel-colon | PASS |
| scrub | tel-colon-space | PASS |
| scrub | masked-address | PASS |
| scrub | at-sign-no-domain | PASS |
| scrub | address-without-tld-dot | PASS |
| inlineBlocks | gmail-style | PASS |
| inlineBlocks | outlook-style | PASS |
| inlineBlocks | apple-style | PASS |
| inlineBlocks | quoted-prefix | PASS |
| inlineBlocks | folded-to | PASS |
| inlineBlocks | reach-12-removed | PASS |
| inlineBlocks | reach-13-kept | PASS |
| inlineBlocks | no-from | PASS |
| inlineBlocks | two-blocks | PASS |
| inlineBlocks | block-to-end-of-text | PASS |
| inlineBlocks | from-line-only | PASS |
| inlineBlocks | marker-kept | PASS |
| inlineBlocks | body-after-blank-kept | PASS |
| cap | cap-splits-address | PASS |
| longRun | long-run-letters-body | PASS |
| longRun | long-run-dotted-body | PASS |
| longRun | long-run-local-part-body | PASS |
| longRun | long-run-dotted-subject | PASS |
| edge | cap-after-shrink | PASS |
| edge | whitespace-past-margin | PASS |
| edge | bound-on-whitespace | PASS |

## The two G3 INCONCLUSIVE probes from 42c2, before and after

These come from calling the real `textForReader` on `F03` (origin `attachment`) and on `F05` (origin `direct`).
- "Before" is the file at `HEAD`, which ignores the third argument.
- "After" is the working tree with A3.
- `embeddedBody` is whether the attached original's body canary is in the text.
- `mailtoAddr` is whether `F05`'s subject or text holds `mailto:`, an `@`, any fixture address or any link host.

```
before: embeddedBody:false mailtoAddr:true
after: embeddedBody:true mailtoAddr:false
```

Rows in the shape and control tables cover the two review findings:
- REVIEW-1 F1 (an inline-disposition original) is the `attach-inline-disposition` row.
- REVIEW-2 B1 (a token cut by the bound surviving into the final text) is the `cap-after-shrink` row of the `edge`
  group.
Both pass.

## Residual risk (reproduced from the spec's Non-goals, A2 and A3)

What still reaches Anthropic in a message the read path sends:

- Names: display names and salutations are not touched.
- Postal addresses are not touched.
- Plain phone numbers with no `tel:` scheme are not touched.
- Member numbers, balances, dates and program names are not touched. They are what the model is asked to read.
- URL schemes other than `scheme://`, `www.`, `mailto:` and `tel:` (for example `sms:`, `callto:`, `data:`) are not
  replaced.
- Non-ASCII e-mail addresses, and an address whose local part is entirely mask characters (for example `a***@host`),
  are not matched and stay as written.
- A word glued to a slash by a dot, whose last label is letters only, is read as a scheme-less link and becomes
  `[link]`.
- A3: the result can be shorter than `maxChars`, both because the scrub shortens the text and because the bound drops
  the token it lands in. A text whose first `maxChars + 1024` code points hold no whitespace is sent as nothing
  (`empty_message`); the same holds for a subject in its first `300 + 1024` code points (null subject).

## Mutation evidence

Each row is one deliberate single-line change. A script applied it, ran the named test file, then restored the
original file byte-for-byte; `cmp` against a copy taken before the first mutation confirmed each restore.
- The first test id in each row is the one the spec names. The others also failed.
- Unit mutations ran against the oracle and integration ones against `loyaltyReadForwards.test.ts`. M7, M8 and M9
  ran against both.
- In cycle 3 every row, M1 to M17, was re-run against the A3 code, not only the ones A3 could affect. Each failed as
  shown.
- M3, M11, M12 and M16 were re-targeted to the A3 lines (`tokenSafePrefix` replaced `firstChars` in the pre-scrub
  bound). Each means what it meant before.
- No earlier row became invalid.

| Id | Change | Failing test | Result | After |
|---|---|---|---|---|
| M1 | `lib/domain/loyaltyInbox.ts`: the `mailto:`/`tel:` replacement removed from the scrub chain | T42c3-U1 (also T42c3-U2) | FAIL | reverted, green |
| M2 | `lib/domain/loyaltyInbox.ts`: the `(?=[/?#])` requirement dropped from the scheme-less link pattern | T42c3-U1 (also T42c3-U2) | FAIL | reverted, green |
| M3 | `lib/domain/loyaltyInbox.ts`: the token-safe pre-scrub bound replaced by a plain cut at exactly `maxChars`, so the cut at the limit happens before the scrub | T42c3-U1 | FAIL | reverted, green |
| M4 | `lib/domain/loyaltyInbox.ts`: the address placeholder made the empty string | T42c3-U1 (also T42c3-U2, T42c3-U3) | FAIL | reverted, green |
| M5 | `lib/domain/loyaltyInbox.ts`: the From-line reach shortened from twelve lines to eleven | T42c3-U3 | FAIL | reverted, green |
| M6 | `lib/domain/loyaltyInbox.ts`: only the From line of a forwarded header block removed | T42c3-U3 (also T42c3-U2) | FAIL | reverted, green |
| M7 | `lib/domain/loyaltyInbox.ts`: the attached original always read, whatever the stored origin | T42c3-I1 (also T42c3-I2, T42c3-U2) | FAIL | reverted, green |
| M8 | `lib/domain/loyaltyInbox.ts`: the attached original never read | T42c3-U2 (also T42c3-I1, T42c3-I2, T42c3-I3) | FAIL | reverted, green |
| M9 | `lib/domain/loyaltyInbox.ts`: an empty attached original falls back to the covering note | T42c3-U2 (also T42c3-I1) | FAIL | reverted, green |
| M10 | `lib/loyaltyInboxRead.ts`: the origin decided by whether any `household_member_addresses` row exists instead of the stored origin | T42c3-I1 (also T42c3-I2, T42c3-I3) | FAIL | reverted, green |
| M11 | `lib/domain/loyaltyInbox.ts`: the outer (covering) subject sent for an attached forward | T42c3-U2 | FAIL | reverted, green |
| M12 | `lib/domain/loyaltyInbox.ts`: header-block removal applied only for origin `inline` | T42c3-U2 (also T42c3-U3) | FAIL | reverted, green |
| M13 | `lib/loyaltyInboxRead.ts`: `retryFailed` deletes every reads row not in `retry`, not only `failed` ones | T42c3-I3 | FAIL | reverted, green |
| M14 | `lib/loyaltyInboxRead.ts`: the stored origin not passed to `textForReader` | T42c3-I1 (also T42c3-I2, T42c3-I3) | FAIL | reverted, green |
| M15 | `lib/domain/loyaltyInbox.ts`: `ignoreEmbedded: true` dropped from `READ_PARSE` (A2) | T42c3-U2 | FAIL | reverted, green |
| M16 | `lib/domain/loyaltyInbox.ts`: the bound before the scrub removed (A2); run with `-t T42c3-U1`, which failed at its 30-second timeout after the event loop was blocked for over a minute | T42c3-U1 | FAIL | reverted, green |
| M17 | `lib/domain/loyaltyInbox.ts`: the trailing-token rule dropped from `tokenSafePrefix` (the backward scan line removed), so the bound is a plain cut again (A3) | T42c3-U1 | FAIL | reverted, green |

After the last revert, `cmp` confirmed both source files byte-identical to the pre-mutation copies. The commands
below were run on that restored tree.

## Verbatim output of the acceptance commands

Three changes from the raw output:
- The integration log lines (JSON objects starting `{"time"`) are left out of #8 and #9. They are about fabricated
  fixtures, and include the existing `relation "webauthn_credentials" does not exist` lines that other suites trigger
  on purpose.
- In H13 of #11, point figures are replaced with `[n]`. This file is public, and a figure cannot be told apart from a
  real one.
- Temporary file paths are printed as the commands printed them.

Everything else is verbatim.

**#1** (tsc)
```
exit=0
```

**#2** (lint, carried)
```

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
```

**#3** (unit totals)
```
 Test Files  112 passed (112)
      Tests  1430 passed (1430)
   Start at  18:17:51
   Duration  7.25s (tests 66%, import 22%, transform 11%, worker 2%)

    Isolate  112 workers spawned · ~135ms startup each (spawn + environment, per file)
             at least ~2.02s faster with isolate: false — reuses workers across files instead of one per file

OK unit 112 files 1430 tests
```

**#4** (the oracle, two zones)
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.y3mOUfpFSe
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.QOy3tDqcju
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=Pacific/Auckland
```

**#5** (42c2 unit scenarios, carried)
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.KUtPPuAq5b
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.ljE8ggf8V2
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
```

**#6** (dependencies and importers, carried)
```
OK dependencies
```

**#7** (stored-state schema, carried, and no migration)
```
OK schema
OK no migration, no schema change
```

**#8** (integration)
```
(node:97929) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:97929) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:97929) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(node:97940) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:97940) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:97972) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:97972) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:97996) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:97996) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:97996) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
T42c2-I10 loopback connections: 1
(node:98017) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98017) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
p41c C9 lock observations:
C9(a) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(b) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(c) backend waiting (Lock/transactionid) on: SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at, (g.created_at::date)::text AS created_date, g.state, g.amount::text AS amount, g.merchant, g.account_id, g.window_start::text AS window_start, g.window_end::text AS window_end, g.reveal_date::text AS reveal_date, CURRENT_DATE::text AS today FROM gifts g WHERE g.id = $1 AND g.giver_user_id = $2 FOR UPDATE
C9(d) iteration 0: backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(d) iteration 5: backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
(node:98032) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98032) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98043) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98043) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98058) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98058) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98064) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98064) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98075) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98075) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98081) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98081) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98092) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98092) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98098) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98098) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98124) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98124) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98129) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98129) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98155) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98155) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
[reid-dump pg01] [{"id":1786,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1367,"property_id":598,"plaid_transaction_id":"p640f-new-1"},{"id":1787,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1368,"property_id":599,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
[reid-dump pg04] [{"id":1800,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1367,"property_id":598,"plaid_transaction_id":"p640f-new-1"},{"id":1801,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1368,"property_id":599,"plaid_transaction_id":"p640f-new-3"},{"id":1802,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":1369,"property_id":600,"plaid_transaction_id":"p640f-old-3"}]
(node:98175) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98175) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98178) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98178) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98180) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98180) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98186) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98186) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98188) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98188) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.fOHfRR5jgI
OK 373 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 and T42c1-I1-I12 and T42c2-I1-I14 each present once and passed
OK T42c3-I1-I3 each present once and passed in one file
OK no fixture rows left
```

**#9** (integration stability, carried)
```
(node:98288) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98288) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98315) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98315) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98342) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98342) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98342) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
T42c2-I10 loopback connections: 1
(node:98360) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98360) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
p41c C9 lock observations:
C9(a) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(b) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(c) backend waiting (Lock/transactionid) on: SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at, (g.created_at::date)::text AS created_date, g.state, g.amount::text AS amount, g.merchant, g.account_id, g.window_start::text AS window_start, g.window_end::text AS window_end, g.reveal_date::text AS reveal_date, CURRENT_DATE::text AS today FROM gifts g WHERE g.id = $1 AND g.giver_user_id = $2 FOR UPDATE
C9(d) iteration 0: backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(d) iteration 5: backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
(node:98375) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98375) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98390) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98390) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98405) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98405) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98421) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98421) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98423) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98423) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98432) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98432) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98440) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98440) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98472) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98472) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98474) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98474) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98481) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98481) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98495) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98495) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98497) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98497) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98497) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
[reid-dump pg01] [{"id":1786,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1383,"property_id":605,"plaid_transaction_id":"p640f-new-1"},{"id":1787,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1384,"property_id":606,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
[reid-dump pg04] [{"id":1800,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1383,"property_id":605,"plaid_transaction_id":"p640f-new-1"},{"id":1801,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1384,"property_id":606,"plaid_transaction_id":"p640f-new-3"},{"id":1802,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":1385,"property_id":607,"plaid_transaction_id":"p640f-old-3"}]
(node:98532) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98532) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98539) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98539) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98541) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98541) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98543) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98543) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98552) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98552) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.FLYPgzDMPC
[]
(node:98619) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98619) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98650) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98650) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98675) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98675) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98675) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
T42c2-I10 loopback connections: 1
(node:98692) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98692) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
p41c C9 lock observations:
C9(a) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(b) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(c) backend waiting (Lock/transactionid) on: SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at, (g.created_at::date)::text AS created_date, g.state, g.amount::text AS amount, g.merchant, g.account_id, g.window_start::text AS window_start, g.window_end::text AS window_end, g.reveal_date::text AS reveal_date, CURRENT_DATE::text AS today FROM gifts g WHERE g.id = $1 AND g.giver_user_id = $2 FOR UPDATE
C9(d) iteration 0: backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(d) iteration 5: backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
(node:98711) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98711) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98722) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98722) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98738) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98738) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98744) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98744) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98755) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98755) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98761) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98761) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98777) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98777) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98805) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98805) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98811) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98811) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98816) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98816) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98819) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98819) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
[reid-dump pg01] [{"id":1742,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1399,"property_id":612,"plaid_transaction_id":"p640f-new-1"},{"id":1743,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1400,"property_id":613,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
[reid-dump pg04] [{"id":1756,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":1399,"property_id":612,"plaid_transaction_id":"p640f-new-1"},{"id":1757,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":1400,"property_id":613,"plaid_transaction_id":"p640f-new-3"},{"id":1758,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":1401,"property_id":614,"plaid_transaction_id":"p640f-old-3"}]
(node:98830) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98830) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98830) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.
(node:98860) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98860) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98863) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98863) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98876) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98876) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98882) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98882) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:98884) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98884) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.BZJJOS30te
[]
OK failing set stable and within KNOWN
```

**#10** (regression block, carried)
```
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.JlIdwikK8p
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.Joinnd16o1
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.C6VeLAew44
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.MD2Tqy5Ru9
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.MdBYnaqwLd
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
JSON report written to /var/folders/qh/lg29sc8x2xzd3z935xj3kb6h0000gn/T/tmp.w3JcVsIqdw
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
OK as-of bound
NOTICE:  database "b8_p42a2_empty" does not exist, skipping
OK failure class
NOTICE:  truncate cascades to table "loyalty_earn_rules"
NOTICE:  truncate cascades to table "household_member_addresses"
NOTICE:  truncate cascades to table "loyalty_inbox_messages"
NOTICE:  truncate cascades to table "loyalty_inbox_reads"
leak-free tokens=14
leak-free tokens=14
OK import end to end
OK sidebar
apps/web/lib/loyaltyInbox.ts:231:    const raw = await source.fetch(env.id);
apps/web/lib/loyaltyInboxSource.ts:139:  fetch(id: string): Promise<Buffer>;
apps/web/lib/loyaltyReader.ts:1:import Anthropic from '@anthropic-ai/sdk';
apps/web/lib/loyaltyInboxSource.ts:26:// This file may use `new Date(` and `toISOString` to bridge imapflow's Date values to ISO text and
apps/web/lib/loyaltyInboxSource.ts:226:        const uids = await client.search({ since: new Date(`${since}T00:00:00Z`) }, { uid: true });
apps/web/lib/loyaltyInboxSource.ts:235:            receivedAt: new Date(m.internalDate ?? 0).toISOString(),
OK source guards
OK fixtures fabricated
OK coarse source checks
fixture shape ok
fixture shape ok
OK fixtures pinned and covered
OK classes
```

**#11** (surface over real HTTP, carried)
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7479 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: a gift-held fee is no fee for either; revealed, fee date 2026-11-18 and expected by 2027-01-02 (Postgres dates), then overdue, received, no state without a benefit, and no Earns into once unlinked; the held row's name and amount appear on neither /travel nor the API
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: estimate [n] points since 2026-11-03 (reading) with the held row excluded for both, counted once revealed, excluded again when held; comparison 2026-11-03 to 2026-11-18 estimated [n] reported [n] ([n]%, worth a look false); cleared and unlinked show no figure; the held row's name and the payment, fee and held amounts appear on neither /travel nor the API
H14 sample Loyalty inbox | Raw mail is kept 30 days, then deleted. | Check inbox now | Not checked yet | Mail from unknown senders: 3 | attacker.test × 2 | other-sender.test × 1 | Forwarding | ZQ42A Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42B2 Surface Member: no forwarding address set | Edit forwarding addresses | ZQ42C Surface Anna: last mail 2026-11-21 | zq42c-anna@example.com | Edit forwarding addresses | ZQ42C Surface Quiet: forwarding quiet for 46 days | zq42c-boris@example.net | Edit forwarding addresses | Reading stored mail | Reading mail is not set up | Set ANTHROPIC_API_KEY on the server; stored mail waits, unread, until then. | Not read yet
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel shows 9 phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; 10 responses hold none of the body canary, the password, the user or the loopback host
H15 PASS both users, /travel and /api/v1/loyalty: 21 phrases present and 2 absent with reading not set up; the read route is 200 disabled for the owner, 401 with no cookie and 403 for a read-scope token; apply on the unique item is 200, reaches the membership's balance in the API and on /travel, and a second apply is 409; the ambiguous item refuses another program's membership with 400; not mine and ignore empty the queue; 19 responses hold no full member number, key or loopback host
OK H1-H15
OK surface
```

**#12** (registry unchanged)
```
OK registry unchanged
```

**#13** (new fixtures pinned, and 42c2 fixtures)
```
fixture shape ok
OK new fixtures pinned and covered
fixture shape ok
OK fixtures pinned and covered
```

**#14** (source guards)
```
OK source guards
```

**#15** (scope guard)
```
OK scope
```

**#16** (existing tests untouched and census)
```
OK existing tests untouched, census exact
```

**#17** (build)
```

> b8@0.1.0 build
> npm run build -w @b8/web


> @b8/web@0.1.0 build
> next build

▲ Next.js 16.3.0 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 13ms

  Creating an optimized production build ...
✓ Compiled successfully in 2.3s
  Running TypeScript ...
  Finished TypeScript in 2.4s ...
  Collecting page data using 7 workers ...
(node:1730) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1730) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:1732) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1732) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:1733) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1733) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
(node:1734) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1734) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
  Generating static pages using 7 workers (0/45) ...
  Generating static pages using 7 workers (11/45) 
  Generating static pages using 7 workers (22/45) 
  Generating static pages using 7 workers (33/45) 
✓ Generating static pages using 7 workers (45/45) in 169ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /accounts
├ ƒ /accounts/[id]
├ ƒ /api/v1/accounts
├ ƒ /api/v1/accounts/[id]
├ ƒ /api/v1/accounts/[id]/balance
├ ƒ /api/v1/accounts/[id]/statement
├ ƒ /api/v1/accounts/[id]/statement/transfers
├ ƒ /api/v1/accounts/[id]/valuation
├ ƒ /api/v1/accounts/reconcile
├ ƒ /api/v1/accounts/reorder
├ ƒ /api/v1/agent/proposals/[id]/decide
├ ƒ /api/v1/auth/invitations
├ ƒ /api/v1/auth/login/options
├ ƒ /api/v1/auth/login/verify
├ ƒ /api/v1/auth/logout
├ ƒ /api/v1/auth/me
├ ƒ /api/v1/auth/register/options
├ ƒ /api/v1/auth/register/verify
├ ƒ /api/v1/auth/users/[id]/revoke
├ ƒ /api/v1/budget/settings
├ ƒ /api/v1/budget/unspent
├ ƒ /api/v1/budget/unspent/allocate
├ ƒ /api/v1/budget/unspent/close
├ ƒ /api/v1/cash-counts
├ ƒ /api/v1/cash-transfers
├ ƒ /api/v1/categories
├ ƒ /api/v1/categories/[name]/balance
├ ƒ /api/v1/categories/reorder
├ ƒ /api/v1/chat
├ ƒ /api/v1/gifts
├ ƒ /api/v1/gifts/[id]
├ ƒ /api/v1/gifts/[id]/attach
├ ƒ /api/v1/gifts/[id]/cancel
├ ƒ /api/v1/gifts/[id]/candidates
├ ƒ /api/v1/gifts/[id]/choose
├ ƒ /api/v1/import/csv
├ ƒ /api/v1/loyalty
├ ƒ /api/v1/loyalty/inbox/poll
├ ƒ /api/v1/loyalty/inbox/read
├ ƒ /api/v1/loyalty/inbox/readings/[id]
├ ƒ /api/v1/loyalty/instruments
├ ƒ /api/v1/loyalty/instruments/[id]
├ ƒ /api/v1/loyalty/members
├ ƒ /api/v1/loyalty/members/[id]
├ ƒ /api/v1/loyalty/memberships
├ ƒ /api/v1/loyalty/memberships/[id]
├ ƒ /api/v1/loyalty/memberships/[id]/member-number
├ ƒ /api/v1/loyalty/memberships/[id]/observations
├ ƒ /api/v1/loyalty/programs
├ ƒ /api/v1/loyalty/programs/[id]
├ ƒ /api/v1/overview
├ ƒ /api/v1/plaid/create-link-token
├ ƒ /api/v1/plaid/exchange-token
├ ƒ /api/v1/properties
├ ƒ /api/v1/properties/[id]
├ ƒ /api/v1/properties/[id]/balance
├ ƒ /api/v1/properties/[id]/tenant-funds
├ ƒ /api/v1/properties/[id]/valuation
├ ƒ /api/v1/properties/[id]/valuation/[valuationId]
├ ƒ /api/v1/push/web
├ ƒ /api/v1/push/web/status
├ ƒ /api/v1/receipts
├ ƒ /api/v1/receipts/[id]
├ ƒ /api/v1/receipts/[id]/candidates
├ ƒ /api/v1/receipts/[id]/image
├ ƒ /api/v1/rules
├ ƒ /api/v1/rules/apply
├ ƒ /api/v1/sync
├ ƒ /api/v1/transactions
├ ƒ /api/v1/transactions/[id]
├ ƒ /api/v1/transactions/[id]/counterparts
├ ƒ /api/v1/transactions/[id]/receipt
├ ƒ /api/v1/transactions/bulk
├ ƒ /api/v1/transfers
├ ○ /apple-icon.png
├ ƒ /budget
├ ƒ /categories
├ ƒ /categories/[name]
├ ƒ /dashboard
├ ƒ /digest
├ ƒ /gifts
├ ƒ /import
├ ○ /insights
├ ○ /login
├ ○ /manifest.webmanifest
├ ƒ /net-worth
├ ○ /offline
├ ƒ /profit-loss
├ ƒ /properties
├ ƒ /properties/[id]
├ ƒ /receipts
├ ƒ /rules
├ ƒ /sandbox
├ ƒ /transactions
└ ƒ /travel


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
```

**#18** (mutation evidence)
```
OK mutation evidence rows 17
```

**#19** (spec public-safety scan)
```
OK spec has no money-looking text
```

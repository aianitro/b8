# REVIEW-1 — P8-42c2-loyalty-inbox-read
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer

No BLOCK found. Every decision rule, the attempt-before-call rule (A2.1), the lock, the bounds and the privacy cuts hold when read against the spec. I also checked the amended acceptance commands for vacuous passes: #4 after A4.1, #13 after A4.2/A4.3 (the `$TC` scans really run over 9 component files) and #11 after A4.4. None passes without the intended behaviour. Two privacy questions about forwarded mail cannot be settled by reading and are listed under Inconclusive. There are ten NITs.

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | #4 after A4.1 passes without the reader importing the SDK. | Read cmd #4: `imp` requires the exact importer list `chat/route.ts categorySuggester.ts loyaltyReader.ts receiptReader.ts`. `apps/web/lib/loyaltyReader.ts:1` has `import Anthropic from '@anthropic-ai/sdk'`. A missing or extra importer breaks the string equality. `chat/route.ts` is not in git status as changed. | REFUTED |
| 2 | #13 after A4.3: the `$TC` component scans still check nothing (empty list, or noglob stops word splitting). | Read cmd13.sh lines 32-36. `set -f` turns off globbing only; unquoted `$TC` still splits on newlines. `[ -n "$TC" ]` stops the command if the list is empty. `$TC` holds 9 changed or new `.tsx` files (LoyaltyInboxCoverage, LoyaltyInboxPanel, LoyaltyMembershipLine, LoyaltyProgramCard, TravelBoard, LoyaltyFromMailLine, LoyaltyInboxReadPanel, LoyaltyReadQueueItem). The import scan and the forbidden-text scan therefore run over real files. | REFUTED |
| 3 | #13 after A4.2: the panel can use `ANTHROPIC_API_KEY` as a value and still pass. | Read `apps/web/components/LoyaltyInboxReadPanel.tsx:62`. The only use is JSX text, `Set ANTHROPIC_API_KEY on the server; …`. There is no `process.env` and no identifier use. The `AK` list check pins the two allowed files. The guard regex itself is weak (see NIT N8), but the diff does not exploit it. | REFUTED (diff); gate weakness noted as N8 |
| 4 | Lines 11-13 of #13 skip the readings route because `[id]` is a glob in a git pathspec. | `added` calls `git ls-files --error-unmatch` on an untracked path, which fails, so the function falls back to `cat` of the whole file. The `[id]` route is scanned in full. | REFUTED |
| 5 | #11 after A4.4 lets a key from `.env.local` back into H15. | Read the `gifts-surface-check.mjs` diff lines 456-462. The script strips every `ANTHROPIC_` variable, then sets `ANTHROPIC_API_KEY=''` and points `ANTHROPIC_BASE_URL` at a closed loopback port. `readerAvailable` trims, so blank means disabled. H15 asserts `readable === false` and a `disabled` outcome. | REFUTED |
| 6 | Jump check uses `>=` or float arithmetic, so an exactly-50% change queues or a just-beyond change applies. | `apps/web/lib/domain/loyaltyRead.ts:250-257`: BigInt minor units, `diff*100 > 50*b`, no division. usd is in cents via `padEnd(2,'0')` on canonical text. | REFUTED |
| 7 | A stored zero against a non-zero candidate applies, or zero against zero queues. | `loyaltyRead.ts:254`: b==0 gives `pass` only when c==0, else `no_baseline`. | REFUTED |
| 8 | Zero is treated as falsy and dropped. | Rule 1 tests `=== null`. The balance is the string `"0"`. The CHECK `balance_iff_reading_had_one` keeps zero distinct from null. | REFUTED |
| 9 | An ambiguous suffix picks the first match. | `matchSuffix` (`loyaltyRead.ts:223-229`) returns `ambiguous` whenever there are 2 or more hits. Rule 3 queues `ambiguous_suffix` with membership null. | REFUTED |
| 10 | A suffix that matches only another program's membership applies. | `decideAndStore` loads only `WHERE program_id = $1` (P). `matchSuffix` filters `programId` again. | REFUTED |
| 11 | A not-mine record outranks a real membership. | `loyaltyRead.ts:332-336`: the not-mine list is consulted only on `unmatched`. I6 adds a membership carrying the suffix afterwards and gets `no_baseline`, not `not_mine_known`. | REFUTED |
| 12 | Equal as-of applies (strict newer is implemented as not-older). | `loyaltyRead.ts:345`: `reading.asOf <= stored.asOf` gives `stale`. `YYYY-MM-DD` text from Postgres `::text` orders exactly. | REFUTED |
| 13 | A future as-of (more than +1 day) auto-applies, or tomorrow is wrongly refused. | `latestAsOf = (CURRENT_DATE + 1)::text` is read inside the transaction. The test is `asOf > latestAsOf`. Manual apply uses `$1::date > CURRENT_DATE + 1`. | REFUTED |
| 14 | A unit mismatch applies, or the comparison is against the wrong unit when the membership has no reading. | `loyaltyRead.ts:340` compares to `stored.unit`, or to `defaultUnit` when there is no reading. With no reading, rule 7 queues `no_baseline` anyway. | REFUTED |
| 15 | A program mismatch with a unique suffix applies. | Rule 2 runs before every suffix-based rule. CHECK `mismatch_queues` refuses any other state with `mismatch` except `no_balance`. | REFUTED |
| 16 | A malformed stated program name turns a contradiction into `not_stated`. | `programNameForm` (`loyaltyRead.ts:121-125`) returns null for any `<`/`>` or more than 60 alphanumerics, which yields `not_stated`. This is consistent with Goal 1 (the clean pass nulls malformed fields) and gives an attacker nothing beyond returning null. It is still fail-open. | CONFIRMED as NIT N3 (not spec-violating) |
| 17 | A balance is rounded, re-signed or mis-scaled. | `cleanBalance` strips commas only when every group is exactly 3 digits, then calls the shared `parseBalance` (`domain/loyalty.ts:69-75`). That parser refuses rather than rounds; usd with one fractional digit is padded. The DB CHECK `unit_scale` and `balance < 1e12` back it up. No `Number`, `parseFloat` or `toFixed` is applied to a balance anywhere in the pipeline. | REFUTED |
| 18 | A balance with no unit, or a unit with no balance, gets through half-set. | `cleanReading` sets `unit` null whenever `balance` is null, and the CHECK `balance_with_unit` enforces the pair. | REFUTED |
| 19 | Some decision produces a row the CHECKs refuse, which would loop as `store_failed`. | Walked every decided state against every CHECK in `db/schema.sql` diff lines 736-791: reason_suffix, reason_as_of, pending_membership, rules_passed, not_mine_known_unmatched, mismatch_*, balance_iff, resolved_iff, the JSON shapes. Each decision branch yields a storable row. I3 passes over all 28+ decision ids. | REFUTED |
| 20 | Auto-apply and its reads row are not one transaction, leaving an observation with no state. | `decideAndStore` (`loyaltyInboxRead.ts:194-267`) does BEGIN, then `FOR UPDATE` on memberships, then observation INSERT, then the reads UPDATE. It throws when the UPDATE touched no row (ROLLBACK), then COMMITs. | REFUTED |
| 21 | "Current" is taken from query order rather than the newest-wins reduction. | `currentObservationByMembership` gets the same `recordedAt` to_char format as `loyaltyStore.ts:221`. | REFUTED |
| 22 | The attempt is not counted before the call, so a thrown reader costs nothing (A2.1). | `countAttempt` commits `retry`/`api_error` (or `failed` on attempt 3) before `bytesOf` and the reader. `readBounded` turns a throw into `api_error`. I4 `throw-counts-attempt` passes. | REFUTED |
| 23 | Retries are unbounded, or `refused`/`empty_message` are retried. | `recordFailure` makes `TERMINAL` codes, or attempts >= 3, `failed`. Candidates are only rows with no reads row or state `retry`. `countAttempt`'s ON CONFLICT requires `state='retry' AND attempts=$5-1`. | REFUTED |
| 24 | A rate limit burns attempts on messages it never reached. | `return 'rate_limited'` right after the first such result. Later candidates are never passed to `countAttempt`. | REFUTED |
| 25 | A hung reader holds the lock. | `readBounded` races the call against `setTimeout(timeout+5s)`, and the `finally` always runs `releaseLock`. I4 `hang-bounded` and I5 check `lockHeld` is false afterwards. | REFUTED |
| 26 | One bad message blocks the rest. | Per-message try/catch (`loyaltyInboxRead.ts:322-348`) catches, then `continue`s. I4 `isolation-after-failure` passes. | REFUTED |
| 27 | Two runs overlap, or the read lock collides with the poll lock. | `pg_try_advisory_lock(hashtext('b8:loyalty-inbox:read'))` on a dedicated client. The poll's key text differs. I5 covers both cases. | REFUTED |
| 28 | Two simultaneous applies give two observations. | `resolveReading` takes `SELECT … FOR UPDATE`; the second caller sees a non-pending row and gets 409. I5 asserts `[200, 409]` and +1 observation. | REFUTED |
| 29 | Manual apply accepts another program's membership or a future date. | `loyaltyInboxRead.ts:502-507` checks membership-of-program, then `> CURRENT_DATE + 1`. I6 covers both. | REFUTED |
| 30 | A read-scope token can trigger a read or an action (spending money or appending balances). | Both routes call `callerOf` first. I6 and H15 assert 403 `INSUFFICIENT_SCOPE` and no change. | REFUTED |
| 31 | Free model text reaches the DB or the page. | `cleanReading` reads 7 named keys only. Stored columns are enums, dates, canonical decimal text, a 3-4 char suffix and JSONB checked by `jsonb_path` CHECKs. `programName` is never stored. I7 scans every text column. | REFUTED |
| 32 | The full member number reaches a payload. | `candidateMembershipIds` is computed in SQL and selects only ids (`loyaltyInboxRead.ts:573-577`). `maskedSuffix` is bullets plus the stored suffix of at most 4 chars. The contract refines the masked form. | REFUTED |
| 33 | Headers, addresses or links reach the model for a direct message. | `textForReader` (`domain/loyaltyInbox.ts:290-298`) sends only `parsed.subject` and `parsed.text`, with `scheme://` and `www.` URLs replaced and text cut at 20000 code points. U4 and I14 pass over R01-R06. | REFUTED for direct mail |
| 34 | For forwarded mail, the household's addresses reach the model. | Inline forward: `parsed.text` holds the quoted `From:`/`To:` block, and only URLs are stripped, so those addresses are sent. The spec accepts body-borne content, so this is NIT N1. Attached `message/rfc822` forward: `textForReader` omits 42c1's `ignoreEmbedded: true`, and mailparser's default treatment of the embedded part could not be read (node_modules is not readable here). | CONFIRMED (inline) as NIT N1; INCONCLUSIVE (attached), see I-1 |
| 35 | `mailto:` or scheme-less links survive the URL scrub. | `URL_IN_TEXT` needs `scheme://` or `www.`. A `mailto:x@y` href (rendered by html-to-text) or `track.brand.test/u?t=…` survives. | CONFIRMED as NIT N2 (render path INCONCLUSIVE, I-2) |
| 36 | Library error text or the key reaches logs or responses. | The reader logs code, status, model, tokens and refusal `category`. The pipeline logs codes and counts. There is no `err.message`. I9, I10 and I13 scan captured lines for the key canary. | REFUTED (N9: `category` is an extra field) |
| 37 | With no key, something is written or attempted. | `readStoredMail` returns `disabled` before taking the lock. The daily purge still deletes expired rows, which the I13 wording requires. I1 asserts zero rows and an unchanged state row. | REFUTED |
| 38 | Retention is off by one, or the not-mine list or state row gets purged. | `received_on < CURRENT_DATE - 400::int`. Only `loyalty_inbox_reads` is deleted. | REFUTED |
| 39 | Coverage says `no` for a program never read, or counts retry/failed rows. | LATERAL picks the newest row with `state NOT IN ('retry','failed')`. No row gives `not_read`. The rendering maps `not_read` to `not read yet`. | REFUTED |
| 40 | `fromMail` shows a pending or unmatched row. | The WHERE clause limits state to applied/applied_by_hand/stale/no_balance with membership not null. Mismatch no_balance rows keep membership null (rule 1 plus CHECK). | REFUTED |
| 41 | A JOIN double-counts: candidates or overview items repeat when a key is shared. | `loyalty_inbox_reads.dedupe_key` is UNIQUE, so the LEFT JOIN is 1:1. Candidate ids come from a scalar `ARRAY(subquery)`. | REFUTED |
| 42 | Server/client boundary: a client component pulls in db, pg, mailparser or the SDK. | The new or changed components import only contracts types, `./Loyalty*` and `@/lib/domain/loyalty` (pure, pre-existing). #19 build exit 0. | REFUTED |
| 43 | Non-deterministic tests (wall clock, random). | Dates come from `pgDay` (Postgres). Fake timers are advanced explicitly. `Math.random()` appears only in an unused default label of `store()`; every call passes a label. | REFUTED |
| 44 | Real-looking data in the diff. | Fixtures are the orchestrator's pinned set (#16). Test literals use `ZQ42C2` canaries. #13 line 49 found no 4+ digit quoted strings. | REFUTED |
| 45 | A swallowed error hides a real failure. | Per-message and run catches record `store_failed` or a classified code. Empty `.catch(() => {})` on ROLLBACK, and `req.text().catch(() => '')` in the read route. | CONFIRMED as NIT N7 (no data loss) |
| 46 | `Check inbox now` skips the read after a failed poll, or sends something else. | `LoyaltyInboxPanel.tsx` checkNow: poll, then the read unconditionally, then refresh. | REFUTED |
| 47 | `null` is rendered as `0` or as `null` in the new UI. | QueueItem uses `no number shown` / `no date`. FromMailLine prints an amount only when non-null and `no expiry stated` otherwise. The panel prints `Not read yet`. | REFUTED |
| 48 | The overview's count and list disagree under concurrency. | `loadReadOverview` runs the count and the list as separate pool statements in `Promise.all` (no snapshot), so the `needsAttention.length <= needsAttentionTotal` refine can be broken during a concurrent run. There is no runtime validation, so the only effect is a contract-invalid body. | CONFIRMED as NIT N6 |

## Findings

No BLOCK.

### [NIT] N1 apps/web/lib/domain/loyaltyInbox.ts:290 — forwarded mail sends household addresses to Anthropic
For an inline-forwarded statement (the main way a household feeds the inbox), `parsed.text` contains the quoted `From: … / To: <member's own address>` block. `textForReader` strips only URLs, so the member's e-mail address goes to the model. The function's own docstring ("no address or routing detail leaves the machine") is false for this path. U4 and I14 cover direct mail (R01-R06) only. The spec accepts body content, so this is a follow-up, not a violation. Suggested follow-up: drop inline forward header blocks before sending, or test with a forwarded fixture. The attached `message/rfc822` case is I-1.

### [NIT] N2 apps/web/lib/domain/loyaltyInbox.ts:262 — the URL scrub misses `mailto:` and scheme-less links
`URL_IN_TEXT` needs `scheme://` or `www.`. `mailto:addr`, `tel:` and bare `host.tld/path?token` survive into the prompt. OQ3 says "every URL replaced by [link]".

### [NIT] N3 apps/web/lib/domain/loyaltyRead.ts:121-125 — the program check fails open on malformed names
A stated program name that contains `<`/`>` or is longer than 60 alphanumerics becomes `not_stated`, so the reading continues to the suffix rules instead of queuing `program_mismatch`. It does not violate the spec (the clean pass nulls malformed fields, and the model could return null anyway). Fail-closed (`mismatch`) would be stricter.

### [NIT] N4 apps/web/lib/loyaltyInboxRead.ts:296, 563-566 — a retry row whose bytes are purged disappears from view
Example: a message gets `rate_limited` on day 29 and its bytes are purged at day 30. The row stays in `retry` forever. It is counted in neither `waiting` (requires bytes) nor `failed`, so the page never shows that the mail was not read.

### [NIT] N5 apps/web/lib/loyaltyInboxRead.ts:403-409 — the response and the stored last read can disagree
`recordState('ok')` runs before `purgeExpiredReads()`. If the purge then throws, the response is `error/store_failed` while the state row says `ok`.

### [NIT] N6 apps/web/lib/loyaltyInboxRead.ts:558-604 — panel counts and list are not read in one snapshot
`needsAttentionTotal`, `waiting` and `needsAttention` come from separate statements on the pool. A run finishing between them can produce a body that breaks the `length <= total` refine. Wrapping them in one REPEATABLE READ transaction would fix it.

### [NIT] N7 apps/web/lib/loyaltyInboxRead.ts:262, 541; apps/web/app/api/v1/loyalty/inbox/read/route.ts:29 — empty catches
`.catch(() => {})` on ROLLBACK breaks AGENTS.md's no-empty-catch rule. `req.text().catch(() => '')` turns a failed body read into `{}` and starts a full, paid read run.

### [NIT] N8 SPEC #13 line 26 (A4.2 guard) — the regex misses space-separated assignments
`ANTHROPIC_API_KEY[^ ]*[=:(\[]` does not catch `const ANTHROPIC_API_KEY = x` or `{ ANTHROPIC_API_KEY }`. The panel is clean today. This is a gate weakness owned by the orchestrator.

### [NIT] N9 apps/web/lib/loyaltyReader.ts:205 — refusal log carries an extra field
The log includes `category`, which goes beyond the spec's "outcome, counts, error code, model name, token counts". It is an enum and not sensitive.

### [NIT] N10 apps/web/lib/loyaltyInboxRead.ts:323-326 — vanished bytes become a terminal failure
If the bytes disappear between candidate selection and `bytesOf` (a concurrent 42c1 purge), the message becomes terminal `failed/empty_message` instead of being left alone.

## Scope violations
- None. `plan/QUEUE.md` is under `plan/`, which #14 excludes. #14 printed no output.

## Inconclusive — requires execution
- **I-1.** Does `textForReader` read an attached `message/rfc822` forward, and does it pass the embedded headers' addresses to the model? Run from the repo root:
  `cd apps/web && node -e 'const {simpleParser}=require("mailparser");const raw=["From: zq42c2-anna@example.com","To: zq42c2-inbox@example.net","Subject: Fwd: statement","MIME-Version: 1.0","Content-Type: multipart/mixed; boundary=\"B\"","","--B","Content-Type: text/plain","","see attached","--B","Content-Type: message/rfc822","","From: statements@zq42c2-brand.test","To: zq42c2-member@example.org","Subject: ZQ42C2 inner","Content-Type: text/plain","","ZQ42C2-EMBEDDED-BODY","--B--",""].join("\r\n");simpleParser(Buffer.from(raw),{skipTextToHtml:true,skipTextLinks:true,skipImageLinks:true,keepCidLinks:true}).then(p=>console.log(JSON.stringify({embeddedBody:String(p.text).includes("ZQ42C2-EMBEDDED-BODY"),memberAddr:String(p.text).includes("zq42c2-member@example.org"),brandAddr:String(p.text).includes("statements@zq42c2-brand.test")})))'`
  - `embeddedBody:false`: forward-as-attachment mail is always `empty_message`, so a 42c1-supported path never yields a balance. Record as a NIT or follow-up.
  - `memberAddr:true`: an address from inside the attachment reaches the model, against OQ3's "no attachment, no address". Escalate to the orchestrator as a possible BLOCK.
- **I-2.** Does a `mailto:` href in an HTML-only mail reach the model text? Run:
  `cd apps/web && node -e 'const {simpleParser}=require("mailparser");const raw=["From: s@zq42c2-brand.test","Subject: x","MIME-Version: 1.0","Content-Type: text/html","","<p>Hi <a href=\"mailto:zq42c2-member@example.org\">write</a> <a href=\"https://t.zq42c2-brand.test/u?t=TOK\">go</a></p>",""].join("\r\n");simpleParser(Buffer.from(raw),{skipTextToHtml:true,skipTextLinks:true,skipImageLinks:true,keepCidLinks:true}).then(p=>{const t=String(p.text).replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"\x27\])]+/gi,"[link]");console.log(JSON.stringify({mailtoAddr:t.includes("zq42c2-member@example.org"),token:t.includes("TOK")}))})'`
  - Expected: `token:false`.
  - `mailtoAddr:true` confirms NIT N2.

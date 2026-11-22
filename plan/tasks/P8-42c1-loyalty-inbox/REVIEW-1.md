# REVIEW-1 — P8-42c1-loyalty-inbox
**Verdict:** BLOCK
**Reviewer:** adversarial-reviewer

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | Display-name, local-part, Reply-To, Return-Path, Sender or Received spoofing could pick the sender. | Read `singleMailbox`, `senderDomainOf` and `headerValues` in `apps/web/lib/domain/loyaltyInbox.ts`. Only the From header's parsed `address` is used. The domain is taken after the last `@`. The display name is dropped. | REFUTED |
| 2 | A Unicode look-alike could be lower-cased into an allowlisted ASCII domain. Example: U+212A KELVIN SIGN lower-cases to `k`, so `x@Klm.com` would become `klm.com`, which is seeded. | Read `normaliseLoyaltyInboxEntry` (packages/contracts/loyalty.ts:553). It lower-cases only text that is entirely printable ASCII. Non-ASCII text is left as it is, so `isLoyaltyHostname` refuses it. Fullwidth characters and dotless i fail the same way. | REFUTED |
| 3 | A trailing dot, upper case, several From headers, two mailboxes in one From, or group syntax could be misread. | Traced the code. The HOSTNAME regex refuses a trailing dot. ASCII is lower-cased. `values.length !== 1` gives null. `parsed.length !== 1 \|\| group !== undefined` gives null. | REFUTED |
| 4 | An encoded-word From (`=?utf-8?B?…?=` that decodes to a brand address) could give an attacker a way in. | Reasoned from the code. The download decision uses the IMAP ENVELOPE address, which would have no address part, so the message is unknown and never downloaded. Even if it were decoded, a plain spoofed From gives the same result, and the spec states From is unauthenticated (non-goal "No sender authentication"). | REFUTED (no gain beyond the stated limit) |
| 5 | A stranger's forged rfc822 attachment or forged inline block could be honoured. | Read `analyseMessage`. Both paths are gated on `member = isRegistered(outerFrom)`. F10 and F27 are covered by U4 and I2. | REFUTED |
| 6 | Nested rfc822, or an rfc822 parsed inline by mailparser, could escape rule 1. | Read the mailparser and mailsplit source. `ignoreEmbedded: true` is a real option. At message-splitter.js:659 it keeps every rfc822 part as an attachment. Only the first top-level `message/rfc822` attachment is used, and its own nested parts are opaque. | REFUTED |
| 7 | Inline-forward text inside an HTML-only part could be missed or wrongly honoured. | `skipHtmlToText` leaves `outer.text` undefined for HTML-only mail, so it falls through to `direct`. The spec says "text body", so this conforms. | REFUTED |
| 8 | A forged X-Forwarded-For naming a member, when the outer sender is a stranger, could change the sender judgement. | X-Forwarded-For feeds attribution tier 2 only. The sender is still the outer From. An attacker who spoofs an allowlisted From can attribute mail to a member and advance that member's `last_received_on`. That masks a quiet forwarder, but it follows from the stated no-authentication limit. | REFUTED (within stated limit) |
| 9 | The tier order could be wrong, a non-member address could stop the walk, or ambiguity could be guessed. | Read `attributeMessage` and the tier construction. A tier stops the walk only when it holds a registered address. Two members in the deciding tier give `ambiguous`. Received headers are read oldest first via `.reverse()`. | REFUTED |
| 10 | A message that mailparser cannot parse (malformed or over a limit) could abort the poll instead of being counted `(unreadable)`. | Read `collect` (lib/loyaltyInbox.ts:222-226). There is no per-message try/catch around `analyseMessage`. simple-parser.js:48 rejects on any parser 'error', including non-fatal ones. message-splitter.js:13-14 and 509-590 raise EMAXLEN for a header block over 1 MiB or more than 1000 child nodes. | CONFIRMED (BLOCK 1) |
| 11 | The oversize cap could be enforced after the download. | `env.size > MAX` is checked before `source.fetch`, from the envelope's RFC822.SIZE. | REFUTED |
| 12 | The size cap could be bypassed when the server omits the size, and the download has no limit of its own. | Adapter: `size: m.size ?? 0`. `fetchOne(..., { source: true })` has no `maxLength`. The poller does not check `raw.length` after the fetch. | CONFIRMED (NIT 2) |
| 13 | The timeout could leave the lock held. | The `collect` race is bounded, but `finally { await source.close() }` runs before `releaseLock` and has no bound. The real `close()` awaits `client.logout()`, which is `run('LOGOUT')`. A server that keeps the socket alive without completing LOGOUT would hold the lock and block `runLoyaltyInboxDaily`, and so the digest after it. The fake's `close()` resolves at once, so I3 never exercises this path. | INCONCLUSIVE (NIT 3) |
| 14 | A write could land after a timeout, once the lock is released. | `stopped()` is checked before every write. A `recordMessage` already in flight finishes, and is protected by ON CONFLICT. | REFUTED (harmless) |
| 15 | The lock could leak on the error path. | `takeLock` calls release(true) on a throw. `releaseLock` destroys the client if unlock fails. An error in `recordState` or the purge still reaches `finally releaseLock`. | REFUTED |
| 16 | Dedupe could recount unknowns or double-store. | `recordUnknown` and `recordMessage` use ON CONFLICT DO NOTHING and count a conflict as a duplicate. The `known` set reads both tables. A no-Message-ID unknown is keyed by `envelopeKey`, which is stable across polls. | REFUTED |
| 17 | F16 (no Message-ID) could be re-fetched on every poll forever. | Confirmed for up to 30 days per message: `known` is built only from listed Message-ID keys, so the `rawKey` is computed after the download. A3.4 ratified this. | REFUTED (accepted by A3) |
| 18 | Key-space collision: an attacker-chosen Message-ID `<envelope:UID:time:size>` would equal the `envelopeKey` of another message. | Possible in principle, but the attacker needs the target's UID, INTERNALDATE and size in advance. Dedupe poisoning through a guessed Message-ID is inherent to the spec's key design (OQ3). | REFUTED (impractical, spec design) |
| 19 | The mailbox could be written to, or the fetch could set \Seen. | `mailboxOpen(..., { readOnly: true })` maps to EXAMINE (imapflow commands/select.js:115). The source fetch uses `BODY.PEEK`/`BINARY.PEEK` (commands/fetch.js:61-111). The strict proxy refuses any other method. | REFUTED |
| 20 | The SEARCH `since` boundary could differ between UTC and CURRENT_DATE. | `since` comes from Postgres `CURRENT_DATE - 30` and is sent as midnight UTC. Day granularity in any time zone returns the same day or one day earlier, never later. The poller drops anything older with the same `<` as the purge. | REFUTED |
| 21 | A secret could leak through a log, a response or `describeInboxConfig`. | Every log call carries counts and codes only. `MailSourceError` has a fixed message. `classifySourceError` reads code fields only. imapflow `logger: false`. `describeInboxConfig` returns configured, problem and the missing names only. The route returns the poll object only. | REFUTED |
| 22 | Raw mail could reach a response, a page or the overview. | `loadInboxOverview` never selects `raw_mail`. Only `reattributeInbox` reads it, inside the lib file. No route returns it. | REFUTED |
| 23 | Retention could be off by one, or skipped after an on-demand poll. | `received_on < CURRENT_DATE - 30` in both tables. The purge runs inside `pollLoyaltyInbox` after every locked poll, and in the daily step. | REFUTED |
| 24 | Poll route auth could run after work starts, or a cookie POST could be forged cross-site (CSRF). | `callerOf(req)` is the route's first statement. The cookie is `sameSite: 'lax'` (lib/sessionToken.ts:127), which blocks cookies on cross-site POST, the same protection as every other loyalty write route. | REFUTED |
| 25 | An editor could fail atomicity, mis-map 409s, mishandle `[]`, or echo the input. | Each editor runs in one transaction. `fromPgError` maps the 23505 constraint names. `domain <> ALL('{}')` deletes every row, so `[]` clears. The messages are fixed text. Provider and suffix refusal is in the contract. | REFUTED |
| 26 | Re-attribution could reassign a matched row or move a date backward. | `WHERE attribution <> 'matched'` in both the SELECT and the UPDATE. `GREATEST(COALESCE(...))`. | REFUTED |
| 27 | A poll could race an address PATCH and leave a message unmatched for good. | `collect` loads `memberOf` once at its start. A PATCH that commits mid-poll re-attributes only the rows committed so far. A message stored later in that poll with the stale routing stays `unmatched`, because no later trigger re-attributes it. | CONFIRMED (NIT 4) |
| 28 | Health could use the wrong threshold, a negative or null day count, or count unattributed mail. | The SQL uses `> 45`, `GREATEST(0, …)`, null when n = 0, and the CASE order quiet, no_mail_yet, ok. Only matched mail moves `last_received_on`. | REFUTED |
| 29 | A null could render as `0` or as the text `null`. | Panel and Coverage use phrase branches for null `lastCheck` and `lastSeenOn`. The DB CHECK guarantees `errorCode` is not null when outcome is error, so `failed (null)` cannot render. | REFUTED |
| 30 | Server/client boundary: a client component could import imapflow, mailparser, db or `process.env`. | Read the component imports. They are type-only contracts imports, `./LoyaltyRequest`, `./LoyaltyListEditor` and React. Command #4/#13 import checks passed at G2. | REFUTED |
| 31 | Scope: a Claude call, body extraction, a new route beyond poll, or a scheduler or timer change. | None found. The scheduler gains one awaited call between the syncs and the digest. | REFUTED |
| 32 | A1, A2 and A3 could hide a defect. | Read each one. A3.1 excludes `/fixtures/` from the PW and RM scans, which is legitimate because cases.json names the variable. A3.4 accepts re-fetching no-Message-ID mail. A2.3 GREATEST(0). None weakens a guarantee beyond what it states. | REFUTED |

## Findings

### [BLOCK] apps/web/lib/loyaltyInbox.ts:226 — one message that fails to parse aborts the whole poll, on every poll, for up to 30 days
**Failure scenario:**
1. Anyone can send to the dedicated mailbox, and From is unauthenticated.
2. Send it a message with `From: x@marriott.com` (seeded). Give it a `multipart/mixed` body of 1001 tiny parts, or a header block over 1 MiB. The size is far under `LOYALTY_INBOX_MAX_BYTES`.
3. The envelope sender is allowlisted, so the message is fetched. `analyseMessage` then runs `simpleParser`, which rejects with code `EMAXLEN` (mailsplit `MAX_CHILD_NODES = 1000`, `MAX_HEAD_SIZE = 1 MiB`). simple-parser.js:48 settles on the first 'error', even a non-fatal one.
4. `collect` rejects. `pollLoyaltyInbox` records `last_outcome = 'error'`, `last_error_code = 'source_failed'`, and `/travel` shows `failed (source_failed)`. The owner is told the mailbox failed.
5. No key is recorded for the poison message, so every later poll fetches it again and aborts at the same point.
6. Envelopes come in ascending UID order, so every legitimate allowlisted message received after the poison is never stored. This lasts until the poison falls out of the 30-day window, and re-sending one poison message every 30 days makes the outage permanent.

The same applies to any input mailparser rejects, including the inner `simpleParser(attached.content)` of a member's forward.

**Contradicts:** SPEC Goal 3, which says "Mail whose sender cannot be read is counted under the sentinel `(unreadable)`, never stored", and Goal 2, which says allowlisted mail is stored. It also undermines OQ10's classified-code intent: a parser fault is reported as a mailbox fault.

**Minimal fix:** wrap the parse in its own try/catch and record the message unknown under `(unreadable)` with its key, so it is never fetched again. No test covers a malformed message.

### [NIT] apps/web/lib/loyaltyInboxSource.ts:226,233 — the size cap depends on the server reporting RFC822.SIZE, and the download is unbounded
`size: m.size ?? 0` treats a missing size as 0, so the message is fetched in full whatever its size. There is no `source: { maxLength }` on `fetchOne`, and the poller does not check `raw.length > LOYALTY_INBOX_MAX_BYTES`. A server that omits the size therefore stores bytes over the cap. Compliant servers always return the size when asked, hence NIT.

### [NIT] apps/web/lib/loyaltyInbox.ts:317 — `source.close()` is awaited before `releaseLock` with no bound of its own
The real `close()` is `await client.logout()`, which is `run('LOGOUT')`. Two cases can hold it indefinitely:
- A server that drips bytes, so the socket inactivity timeout never fires.
- A server that never completes LOGOUT behind a stalled pipelined command.

Either case holds the advisory lock, and since `runDailyJob` awaits the step, it also blocks the digest. The spec's failure-mode list names "a stalled source that holds the lock past its timeout". I3's fake `close()` resolves at once, so the real path is never exercised.

**Fix:** use `client.close()` (synchronous), or race `logout` against a short bound.

### [NIT] apps/web/lib/loyaltyInbox.ts:174 + apps/web/lib/loyaltyStore.ts:553 — a member PATCH racing a poll can leave a message `unmatched` for good
1. A poll loads `memberOf` at the start of `collect`.
2. The owner adds address X while the poll is running.
3. The PATCH's `reattributeInbox` runs before message M (for X) is committed, so it does not see M.
4. The poll stores M as `unmatched`, using the stale routing.
5. Nothing re-attributes M until another address edit.

This is a narrow window, and the PATCH takes neither the advisory lock nor a re-check.

## Scope violations
- None found.

## Inconclusive — requires execution
1. **BLOCK 1, confirm the parser rejects.** From the repo root:
   `node -e 'const {simpleParser}=require("mailparser");const p=Array.from({length:1001},(_,i)=>"--b\nContent-Type: text/plain\n\nx"+i).join("\n");const raw=Buffer.from("From: a@zq42c-brand.test\nMessage-ID: <zq42c-poison@zq42c-brand.test>\nContent-Type: multipart/mixed; boundary=b\n\n"+p+"\n--b--\n");simpleParser(raw,{ignoreEmbedded:true,skipHtmlToText:true,skipTextToHtml:true}).then(()=>console.log("PARSED"),e=>console.log("REJECTED",e.code))'`
   `REJECTED EMAXLEN` confirms BLOCK 1.
2. **BLOCK 1, the poll-level effect.** In a scratch copy of loyaltyInbox.test.ts, install a fake listing the poison message first and F01 second. Expect `outcome: 'error'`, `errorCode: 'source_failed'`, F01 not stored, and the same on a second poll. If so, BLOCK 1 is confirmed end to end.
3. **NIT 3.** In a scratch test, install a fake whose `close()` returns `new Promise(() => {})` and whose `list` stalls, with `LOYALTY_IMAP_TIMEOUT_SECONDS=1`. Assert that `pollLoyaltyInbox()` resolves within 5 s. By reading, it will not resolve, and the lock stays held. Whether real imapflow `logout()` can hang that way against a live server is still unsettled.

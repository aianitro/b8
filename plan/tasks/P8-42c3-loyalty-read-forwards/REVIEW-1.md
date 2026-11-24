# REVIEW-1 — P8-42c3-loyalty-read-forwards
**Verdict:** BLOCK
**Reviewer:** adversarial-reviewer (cycle 1, 2026-11-23)

There is one defect. The read path parses with options that differ from 42c1's on one flag, `ignoreEmbedded`. As a
result, an attached forward whose `message/rfc822` part has `Content-Disposition: inline` is stored `attachment` but
read as the outer message. The model then gets the covering note, the outer subject and the original's header lines.
The fixtures never use that disposition, so all 19 green commands cannot see it.

## Falsification log
| # | Hypothesis | Result |
|---|---|---|
| 1 | Stored `attachment` origin plus bytes holding an rfc822 part does not always pick that part. `READ_PARSE` (loyaltyInbox.ts:409) lacks 42c1's `ignoreEmbedded: true` (:137). mailsplit then inlines an rfc822 part with `disposition === 'inline'` and 7bit/8bit/binary encoding, and mailparser writes its From/Subject/Date/To/Cc lines into the outer text. | CONFIRMED (BLOCK F1) |
| 2 | Fixtures exercise the inline-disposition case. There is no `Content-Disposition` in F03, F04, F06 or F07. | CONFIRMED that no test covers it |
| 3 | A stranger's `direct` mail with an inline rfc822 part has the original merged into its text. This is identical to 42c2 (same options), so not a regression. | CONFIRMED as pre-existing; folded into F1's fix |
| 4 | A nested inline rfc822 part inside the chosen original is unwrapped. This contradicts the non-goal. | CONFIRMED (same root cause as F1) |
| 5 | The rfc822 contentType check misses casing, parameters or an octet-stream `.eml`. The comparison is identical to 42c1's at :263. | REFUTED |
| 6 | The covering note is used as a fallback when the original is empty. | REFUTED |
| 7 | Membership is re-derived from `household_member_addresses`. | REFUTED |
| 8 | Another production caller of `textForReader` skips the origin. There is one call, loyaltyInboxRead.ts:332. | REFUTED |
| 9 | The scrub order is wrong. | REFUTED |
| 10 | The cut happens before the scrub. | REFUTED |
| 11 | The four patterns differ from the spec. | REFUTED |
| 12 | Subject, CRLF and quoted lines slip past the scrub. | REFUTED |
| 13 | Block removal is off by one or eats the marker or body. | REFUTED |
| 14 | Block removal alters a balance, date, suffix or program line. | REFUTED (spec-conformant) |
| 15 | 42c2 decision rules, retry or lock changed. | REFUTED |
| 16 | `retryFailed` resets more than `failed` rows. | REFUTED |
| 17 | Integration asserts something weaker than the real reader input. | REFUTED |
| 18 | A command passes vacuously. The #13 line with `-ge 0` is vacuous but not load-bearing. | REFUTED for task gates |
| 19 | Money-looking figures sit in tracked or added lines. | REFUTED |
| 20 | Logging, console output or swallowed errors were added. | REFUTED |
| 21 | Quadratic regex cost on a long uncut body, because the scrub runs before the cut. | INCONCLUSIVE (N1) |

## Findings
### [BLOCK] F1 — apps/web/lib/domain/loyaltyInbox.ts:409: `READ_PARSE` lacks `ignoreEmbedded: true`
A registered member forwards a statement as an attachment, and the rfc822 part carries `Content-Disposition: inline`.
- The poll's `PARSE` keeps that part as an attachment and stores origin `attachment`.
- `READ_PARSE` inlines it, `outer.attachments.find(...)` returns undefined, and the model gets the outer subject, the
  covering note, the original's header lines and its body.
- Addresses are scrubbed, but display names, the date and the inner subject still go out.

Same root cause: a nested inline rfc822 part inside the chosen original gets unwrapped.

Fix: add `ignoreEmbedded: true` to `READ_PARSE`, so read-time classification equals poll-time classification, and add
a test with an inline-disposition variant.

### [NIT] N1 — loyaltyInbox.ts:375-380: the scrub runs over the whole uncut body
`ADDRESS_IN_TEXT` has no anchor or lookbehind, and `BARE_LINK` has a nested `+`. Both go quadratic on long runs. The
run holds the advisory lock, and no timer can interrupt it.

### [NIT] N2 — SPEC.md:279 (orchestrator-owned): `-ge 0` is always true
It is not load-bearing.

## Orchestrator's command results (I5)
- **F1 confirmed.** A throwaway probe, F03 with `Content-Disposition: inline` added to the rfc822 part and read with
  origin `attachment`, printed `outerNote:true, outerSubject:true, headerLines:true, innerBody:true`.
- **N1 confirmed and upgraded to BLOCK.** The probe timed one `textForReader` call over a single unbroken run:
  - 20k characters: 0.24 s.
  - 40k characters: 0.97 s.
  - 80k characters: 3.9 s.
  - 80k characters of `a.` pairs: 11.3 s.
  - 1M characters did not finish within 10 minutes.

  Time quadruples each time the length doubles. The stored-mail cap (`LOYALTY_INBOX_MAX_BYTES`) admits about 5 MB, so
  one crafted mail could hold the read lock for hours. 42c2's single scheme-anchored pattern did not have this cost,
  so it is a regression this diff introduces.

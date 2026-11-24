# REVIEW-1 — P8-42d-loyalty-screenshot
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (cycle 1, 2026-11-24)

42 hypotheses tried by reading. 38 REFUTED, 3 CONFIRMED as nits, 1 INCONCLUSIVE (I-1) that the orchestrator resolved
by command.

## Falsification log (condensed)
| # | Area | Hypothesis | Result |
|---|---|---|---|
| 1-5 | read route | body read before auth; unknown membership starts a paid call; size/type check after the model or trusting the header; a 413 with a new code; a stream error read as an empty image | REFUTED |
| 6-9 | reader | household data in the request; a request without a key; a throw becomes a 500; error, base64 or model text in a log | REFUTED |
| 10-16 | answer and checks | full printed or stored number in the answer; suffix from the membership; clean pass skipped; comma decimal read as grouped; suffix not normalised; program check re-implemented; unit check ignores the current reading | REFUTED |
| 17-18 | D8 | equal date treated as older; the form's standing disagrees with the reducer for a future-dated current row | REFUTED |
| 19-26 | D3 | off by one at T; null last-seen treated as recent; `not_read` treated as `yes`; future-dated row due; ids repeated across domains; "current" not the reducer's; a sixth statement or a JS clock; coverage definition diverging | REFUTED |
| 27-32 | confirm | client picks the source; future limit or unit rule skipped; unknown membership 500 or leak; second user or non-user member treated differently; junk `[id]`; typed path changed by the refactor | REFUTED (32 via I-1 below) |
| 33-39 | client and hygiene | second encoder or stored image; null pre-filled as 0; mismatch blocks; double tap; client pulls in db or SDK; manifest or migration; figures in tests | REFUTED |
| 40 | tests | U4's household-canary loop can fail | CONFIRMED (N1) |
| 41 | read route | a database failure before the body becomes a 500 | CONFIRMED (N2) |
| 42 | surface | H16(g) checks H15's expectText in full | CONFIRMED subset only (N6) |

**I-1 (typed path unchanged), resolved by the orchestrator:** `git diff -U0 HEAD -- apps/web/lib/loyaltyStore.ts`
removes exactly two lines, the INSERT's `VALUES (..., 'typed')` line and its parameter line; both reappear in
`appendObservation` with the source passed in. Every other line of the old `addObservation` body is unchanged in
`appendObservation`. REFUTED.

## Findings (all NIT)
- **N1 — lib/loyaltyScreenshotReader.test.ts:105-107:** the household-canary loop restates the reader's signature and
  cannot fail. The real guard is the two-block and key-set assertions.
- **N2 — loyaltyStore.ts:844 / screenshot/route.ts:35:** a database failure in `screenshotTargetOf` escapes as a
  generic 500. Outside D10's scope (read outcomes), but the only unhandled path on the route.
- **N3 — loyaltyInboxRead.ts:687-694:** the due SQL restates the coverage statement's "newest settled read" and the
  reducer order. Equivalent today, kept in agreement only by T42d-I1.13.
- **N4 — screenshot/route.ts:42:** the body is fully buffered before the size bound (as the receipts route does), and a
  paid route has no per-caller throttle.
- **N5 — LoyaltyScreenshotCapture.tsx:102:** "Nothing could be read" shows whenever the balance is null, even if a
  suffix or date was read. Cosmetic.
- **N6 — gifts-surface-check.mjs:922:** H16(g) checks a filtered subset of H15's expectText; expectAbsent in full.

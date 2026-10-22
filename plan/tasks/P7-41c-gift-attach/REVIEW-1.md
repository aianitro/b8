# REVIEW-1 — P7-41c-gift-attach
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer · 2026-10-22

Persisted from the reviewer's final report, condensed (each hypothesis keeps its method and outcome).

## Falsification log
| # | Hypothesis | Outcome |
|---|---|---|
| H1 | A non-giver tells "exists" from "unknown id" on candidates — both go through the same `failure({code:'NOT_FOUND'})` | REFUTED |
| H2 | A non-giver's malformed attach body gets 400 — ownership is checked before the body is read | REFUTED |
| H3 | The read-scope 403 leaks existence — decided before any lookup, independent of id; C6 asserts byte identity | REFUTED |
| H4 | The recipient's read token on GET leaks — giver-scoped lookup, 404 | REFUTED |
| H5 | The two routes differ for a non-giver — same id parse, giver-scoped lookup, NOT_FOUND | REFUTED |
| H6 | The list includes a row masked for the giver — read through `visibleTransactions(viewer)`; masked rows have a null Plaid id and are refused; C5 | REFUTED |
| H7 | The list includes a row held by a sibling or revealed gift — `giftLinkedSql`; C5 | REFUTED |
| H8 | Hidden rows dropped or a tracking filter added — none; C4 lists a hidden row | REFUTED |
| H9 | Registry wrong or X1 vacuous — candidates text-bearing/X1, attach guarded-write/C1; X1 probe asserts 404s and the giver's view | REFUTED |
| H10 | Attach records or files differently from `linkFreshRows` — the three statements are textually the same; C1, C3 | REFUTED (drift: N3) |
| H11 | A `choose` gift flips to `matched` — `stateAfterClaim('choose', …)` stays `choose`; C2 | REFUTED |
| H12 | Attach deadlocks with sync — sync takes row locks (upserts, deletes) before gift locks; attach goes row then gift | REFUTED |
| H13 | Attach deadlocks with choose, cancel or the sweep — attach waits for a gift only while holding an unlinked row | REFUTED |
| H14 | The 23505 catch hides failures — only that code, only the link insert | REFUTED |
| H15 | Criteria checked on a stale read — re-read after both locks; C9(b), M12 | REFUTED |
| H16 | N7 changes the reset UPDATE or the sweep — only the open-gift select; a gift revealed today no longer claims in sync (intended) | REFUTED |
| H17 | Floor and today on different calendars — same statement, same session time zone | REFUTED |
| H18 | Cap or order disagree with the contract — same order, cap equals the schema max | REFUTED |
| H19 | Form shows a server date or mismatches on hydration — null server snapshot, then the local date | REFUTED |
| H20 | Form stale after midnight — fine before a submit; after a submit, see N1 | PARTIAL (N1) |
| H21 | Money-looking figures in tracked non-test files | REFUTED |
| H22 | Scope exceeded | REFUTED |
| H23 | C5's zero and refund controls exercise the money-out guard — the gift's amount criterion refuses them first | CONFIRMED vacuous (N2) |

## Findings
- **N1 (NIT) — `components/GiftForm.tsx` reset** sets both dates explicitly after a submit, so they stop following
  today; a form left open past midnight starts a day late. Fix: reset to the blank form. **Fixed in G3 cycle 1.**
- **N2 (NIT) — C5's zero and refund controls never reach the money-out guard**; add a merchant-only gift with matching
  zero and refund rows. **Fixed in G3 cycle 1.** GATES.md's M4 note was also wrong (C5 does seed a zero row) — corrected.
- **N3 (NIT) — the link statements are duplicated** between `attachToGift` and `linkFreshRows`; C1 pins category, rule
  flag, link and state against the sync twin but not the prior values (C3 covers those). Follow-up.
- **N4 (NIT, rare) — attach to a `choose` gift holding nothing gives `choose` with one candidate**, where sync would
  reset it to `awaiting` first and give `matched`. Reachable only if links vanish by cascade outside a sync. Follow-up.
- **Observation (spec-level), corrected by the orchestrator:** the reviewer reported that the sweep turns `awaiting`
  into `unmatched` six days after the window ends, ending attach early. It does not: `runGiftSweep` only sets
  `notice_at` then (the "nothing matched yet" notice), and sets `unmatched` only on the reveal date (`expire`). Attach
  keeps working until the reveal date.

## Inconclusive — run by the orchestrator
1. `git diff 68e83a1 -- apps/web/lib/giftStore.ts | grep -nE '^[-+].*(COALESCE|NULLIF|CANDIDATE_LABEL)'` → the removed
   expression is exactly the existing label; `GET /api/v1/gifts` is unchanged.
2. `linkFreshRows` changes only by `AND g.reveal_date > CURRENT_DATE` (the rest of the range printed was the new attach
   function below it).

# NITS — P8-42b2-card-earn-estimate

From REVIEW-1 (ACCEPT_WITH_NITS). REVIEW-1's NIT 1, a rate literal in a comment, was fixed at G3 by the orchestrator
and is not listed here. None of the rest changes any output on the fixture.

- **N1 — two definitions of the annual-fee phrase.** `lib/loyaltyEarn.ts` and `lib/loyaltyStore.ts` each define
  `FEE_WORDS`. They agree today, but a future edit to one would make the fee watch and the estimate disagree. Export a
  single constant.
- **N2 — the category match trims only spaces on the row side.** `btrim(s.mapped_category)` leaves tabs and other
  whitespace, while the stored rule text is fully trimmed. Use the same whitespace set on both sides.
- **N3 — the income test is case-sensitive.** `bc.name = c.mapped_category` is exact, so a credit whose category
  differs from an income budget category only in case counts as a refund. Case-fold it, as the category rule does.
- **N4 — read skew across pool connections.** The descriptions, rows and figures are separate statements, so a response
  that races a concurrent earn PATCH can mix old and new rules. Observations and fee watches already work this way.
- **N5 — the editor draft is not reset.** Cancel keeps the unsaved draft, and state is not re-synced after another
  user's change.
- **N6 — a raw `FROM transactions` in the surface script's scratch-DB harness** (`scripts/gifts-surface-check.mjs`
  H13). It is a test harness, not a read path, but it overlaps the spec's wording.

# P7-41c-gift-attach — follow-ups (from REVIEW-1, 2026-10-22)

- **N3 — one definition of "link a row to a gift".** `attachToGift` and `linkFreshRows` carry the same three statements
  (record prior, file, move state). Extract one helper both call, with a scenario comparing prior values too. Needs
  `linkFreshRows` to change beyond the one line this task allowed.
- **N4 — attach to a `choose` gift holding no rows** leaves it `choose` with one candidate where sync would reset and
  match. Reachable only when links vanish by cascade (an account deleted) between syncs. Run the same reset first.
- **M6 is an equivalent mutant** (amounts via `Number` vs exact cents agree for every value the app can hold). If
  amounts ever arrive from a source that is not `numeric(12,2)` or the contract, add a case that tells them apart.

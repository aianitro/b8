# P5-36-digest — follow-ups (from REVIEW-1, 2026-10-20)

For step 37 (the weekly report's content), which will reword the digest anyway:
- **N1 — the `findings` headline overstates who reported.** "N findings reported by 9 of 9 sources" reads as if every
  evaluated source produced a finding. Say "from the 9 of 9 sources evaluated", or name the sources that reported.
- **N5 — a conversion failure takes the page down.** `assembleFindings` runs outside the per-source `attempt`, so a
  producer value that makes its conversion throw is a page error, not "not evaluated". Decide whether to convert per
  source inside the guard.

Guards (a small hardening task, any time):
- **N2 — W2 false negatives:** destructured consts, `let` tables, method-call helpers, `Object.values`/`.find` on a
  table, same-name const shadowing.
- **N3 — W1 false negatives:** typed-literal clock inputs (`DATE 'today'`, `TIMESTAMP 'now'`, `TIMESTAMPTZ 'now'`).
- **N4 — comment:** the loader's log comment overclaims what a driver error contains; reword when next touched.

Still open from P5-35: N2 (the `INDEXES` cache) was disposed of here by a comment, per Q8.

# P8-42a2 — loyalty follow-ups before the owner's first import

**Origin:** REVIEW-1 of P8-42a (`194f049`), NITS N1, N3 and N4 in
`plan/tasks/P8-42a-loyalty-model-page-import/NITS.md`. Owner asked for this task on 2026-11-19, before running the
import against the real sheet. Five-agent pipeline. No contract change expected (G1 SKIP); if the spec finds one is
needed, say why.

## The request

1. **N1 — an empty save must not erase a stored member number.** On `/travel`, tapping a masked member number opens
   an empty editor (`LoyaltyInlineText` `startEmpty`, used by `LoyaltyMembershipLine.tsx`). Saving it empty sends
   `PATCH {memberNumber: null}` and the stored number is gone; a re-import does not restore it. After this task an
   empty save on that field changes nothing and sends no request. Clearing a number stays possible, but only through
   a separate, explicit control (the spec decides its form, e.g. a "Remove number" action that asks to confirm).
   Other fields using `LoyaltyInlineText` keep their current behaviour unless the spec shows the same hazard.
2. **N3 — the import refuses a far-future `--as-of`.** `--as-of` later than Postgres's `CURRENT_DATE + 1` (the same
   one-day slack the API uses, read from the database, never the JS clock) is a usage refusal: exit 2, a message with
   no data, nothing written, in dry run and `--apply` alike. Today's date and tomorrow's are accepted.
3. **N4 — the import names the failure class when the database fails.** The catch that prints "import could not run;
   nothing was changed" also writes, on stderr only, the error's SQLSTATE or errno code (e.g. `code=42P01`,
   `code=ECONNREFUSED`) — never `message`, `detail`, `hint`, a value, or a stack. The 20-line stdout contract of P8-42a
   is unchanged.

## Constraints

- P8-42a's acceptance commands that still apply must keep passing (the spec names which, and re-runs them), in
  particular #9's stdout contract and the leak checks.
- The page's member number stays masked everywhere; the copy action is unchanged.
- No real data; `ZQ42A` fixtures; no figures in comments or commit messages.
- Out of scope: N2, N5, N6 (stay in P8-42a's NITS.md), and anything from 42b onward.

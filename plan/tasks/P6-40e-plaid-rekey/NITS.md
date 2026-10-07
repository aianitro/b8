# NITS — P6-40e-plaid-rekey (follow-ups, not absorbed)

From REVIEW-1 (ACCEPT_WITH_NITS, 25 hypotheses, 0 BLOCK).

1. **RC-03 does not pin cursor clearing.** After one successful sync of a mixed item every account of
   the token holds the new cursor and the next sync is incremental — true by reading
   (`WHERE id = ANY($2)` over all group ids) but untested. Add a third leg to RC-03.
2. **H-d widens H-g exposure.** A mixed item now always re-walks its full history, which is where the
   reproduced, unfixed H-g cross-page re-claim can strand an id. No trigger today (no NULL or mixed
   cursors). Fix H-g before an account is next added to an existing item.
3. **Backup in a plan→backup race** holds sync's id rather than the planned old id; counts and the
   restore recipe stay correct.
4. **No savepoint per UPDATE:** a concurrent uncommitted insert of a planned new id fails the whole
   item (exit 1, re-runnable). Run `--apply` outside the scheduler's sync window.
5. **Acceptance #14's `&&` form** short-circuits on a correct zero count — vacuous as written; G2 ran
   the halves separately. Don't reuse the form in future specs.

**Also from the implementer (reported, not fixed):** H-f (unrefuted alternative root cause for the
laptop-era window: a cursor-less sync before account ids were remapped drops statements as
unrecognized while the cursor advances) and **H-g** (reproduced: `syncItem` can re-claim a row it
renamed on an earlier page). Proposed follow-up: `P6-40f-sync-reidentification-hardening`.

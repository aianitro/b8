# P8-42c4 — the loyalty read: robustness follow-ups

**Origin:** REVIEW-1 of P8-42c2 (`fda9eb9`), NITS N4, N5, N6, N7 and N10 in
`plan/tasks/P8-42c2-loyalty-inbox-read/NITS.md`. P8-42c3 (`0c6b2ae`) closed N1, N2 and N11. The owner asked to move on
to this task on 2026-11-24. Five-agent pipeline. No contract change expected (G1 SKIP); if the spec finds one is
needed (for example a new state or error code), say why.

**Why now:** each item makes the reading panel or the stored state disagree with what actually happened, and N7 can
start a full, paid read run from a request whose body could not be read.

## The request

1. **N7a — a failed body read is refused, not treated as empty.** `apps/web/app/api/v1/loyalty/inbox/read/route.ts`
   turns `req.text()` failing into `''`, which becomes `{}` and starts a full read run. After this task a failed body
   read answers the route's existing invalid-request response and starts nothing. An absent or empty body is still
   `{}`, as today.
2. **N7b — no empty catch.** The two `ROLLBACK` handlers in `apps/web/lib/loyaltyInboxRead.ts` that swallow errors with
   an empty arrow function comply with the repo's no-empty-catch rule. The spec fixes how: logged with no mail
   content, or another form the rule accepts. The original error still decides the outcome.
3. **N5 — the stored last read matches the answer.** Today `recordState` runs before `purgeExpiredReads`, so a purge
   that throws answers `error/store_failed` while the stored state says `ok`. After this task the response and the
   stored state agree for every combination of read, state-write and purge failure. The spec picks the order or the
   rule and names each combination.
4. **N4 — a `retry` row whose bytes are gone is visible.** Today it stays `retry` and is counted in neither `waiting`
   nor `failed`. After this task it is either counted as failed or closed when the bytes go. The spec picks one and
   says what the panel shows.
5. **N10 — bytes that vanish between selection and read are not a terminal failure.** Today `bytesOf` returning null
   after `countAttempt` records `failed/empty_message`. After this task such a message is left as it was before the
   run (or follows the rule item 4 picks for purged bytes), and an empty message whose bytes are present is still
   `failed/empty_message`.
6. **N6 — the panel's counts and list come from one snapshot.** `loadReadOverview` runs its queries in parallel as
   separate statements, so a run finishing between them can break the `length <= total` check. After this task they
   are read in one REPEATABLE READ (or stronger) read-only transaction.

## Constraints

- P8-42c2's decision rules, prompt fields, model, retry limits, lock and storage are unchanged, and P8-42c3's reader
  input (attached forwards, header-block removal, scrub, bounds) is unchanged. Their acceptance commands that still
  apply keep passing; the spec names which and re-runs them, including the pinned fixtures, the oracle digests and the
  HTTP surface check.
- No log line carries a subject, text, address, balance, member number or model output.
- Messages already read are not re-read automatically.
- No real data: fabricated `ZQ42C4` fixtures, `example.*`/`.test` domains only, and no figures in comments or commit
  messages.
- Out of scope: P8-42c2's N3 (program-name fail-closed), N8 and N9, P8-42c3's NITS, and anything from 42d onward.

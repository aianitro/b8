# REVIEW-1 — P8-42e1-loyalty-stays
**Verdict:** ACCEPT_WITH_NITS, with one spec defect escalated (N1) and two inconclusive items (I1, I2)
**Reviewer:** adversarial-reviewer (cycle 1, 2026-11-24)

31 hypotheses tried by reading. 29 REFUTED, 1 CONFIRMED as a spec-level defect (N1), 1 INCONCLUSIVE (collation).

## Falsification log (condensed)
| # | Area | Hypothesis | Result |
|---|---|---|---|
| 1-3 | candidates | balance-settled messages skipped; the balance reader called or its tables written; airline or byte-less mail read | REFUTED |
| 4-10 | pass | shared or leaked lock; model called before the attempt is committed; terminal codes retried; rate limit not stopping; daily step can reject; purge re-exposes a message; purge reaches stays | REFUTED |
| 11-15 | records | dedupe split by case or dash or merged across programs; concurrent writers duplicate or 500; supersession grid wrong; typed write clears evidence; mail moves the membership | REFUTED |
| 16 | supersession | an "older" re-forwarded confirmation is recognised as older | CONFIRMED (N1: `received_on` is arrival in the inbox) |
| 17-19 | attribution, hold, nights | guessing; hold actions; nights off by one, wrong year, 0 for NULL | REFUTED |
| 20 | A2 | domain and contracts helpers disagree | REFUTED |
| 21-26 | privacy, routes, migration | full code leaks; guest data stored; household data sent; body before auth; down harms other tables; a valid decision fails a CHECK | REFUTED |
| 27 | collation | JS `\p{Cc}` and PG `[:cntrl:]` disagree | INCONCLUSIVE, resolved below |
| 28-31 | A3, boundary, vacuity, figures | A3 hides a real duplicate; client imports server code; vacuous tests; figures | REFUTED |

## Findings
- **N1 (spec defect, escalated):** a re-forward of an old confirmation after a cancellation gets a later `received_on`
  and re-books the stay. Fixed by amendment A5 (mail never revives a cancelled stay); G3 cycle 2 follows.
- **N2:** an undated cancellation for a known code cancels without D9's program or suffix checks, while a dated one is
  held. Low probability; inconsistent.
- **N3:** when a stay is already on another membership (sticky), the read row and a "place" tap can name a membership
  the stay is not on, with nothing on the page saying so.
- **N4:** a count of one renders "1 night counted in <year>" (grammatical, not literal to the pinned format).
- **N5:** a contracts comment claims the property check equals the DB CHECK; true only for the collation in use.

## I1/I2 (orchestrator, by command)
- Throwaway and production databases: provider `c` (libc), `en_US.UTF-8`.
- `[:cntrl:]` on soft hyphen, zero-width space, U+2028, U+0085: `f|f|f|t` on both; BEL `t`. This matches JS `\p{Cc}`,
  so the clean pass and the CHECK agree. REFUTED; no BLOCK.

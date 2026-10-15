# P7-41a-second-user — follow-ups

From REVIEW-1 (2026-10-15), deferred at G3 rather than absorbed:

- **N2 — bind the invitation to the registration challenge.** Options with live code A and verify with live code B
  enrols under B while the authenticator holds A's handle and name. Separately, a read-scope bearer plus a code is
  treated as no session (and redeems), while a full-scope bearer plus a code is refused. Neither gains authority. Fix:
  store the code hash with the registration challenge and require the same code at verify; treat any bearer plus a
  code as S9's refusal.
- **N4 — future gates:** a "no user predicate" grep should exclude `client_user_id` explicitly instead of using `\b`,
  which stops matching compound `*_user_id` columns.

From REVIEW-2 (2026-10-15):

- **R2-N1 — S16 does not lock in `FOR SHARE`.** Removing it (keeping `revoked_at IS NULL`) still passes S16, measured.
  Add a forced-overlap probe in S6's style: hold the user row `FOR UPDATE`, start an enrolment, wait for its Lock
  wait in `pg_stat_activity`, then commit a revoke, and assert no credential row survives.
- **R2-N2 — sidebar section headers below the brand contrast floor** (`text-cyan-100/70` at 10px, about 3.3:1).
  Pre-existing; same fix as N1.
- **R2-N3 — S6 leaves `racing` un-awaited on its failure path.** Noisier failures only.
- **R2-N4 — pre-existing revoke-versus-decide deadlock.** Revoking a user while that user confirms a proposal they
  proposed can abort one transaction with 40P01 (a 500, no wrong data). Retry, or lock in a consistent order.

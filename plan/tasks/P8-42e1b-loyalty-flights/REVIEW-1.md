# REVIEW-1 — P8-42e1b-loyalty-flights (G3 cycle 1)
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (2026-11-24)

36 hypotheses tried by reading. 31 REFUTED, 5 CONFIRMED as nits, no BLOCK.

These hold:
- privacy (no passenger fields stored, codes masked everywhere);
- read-once and the airline-only candidates;
- the 42e1 tables untouched;
- the lock;
- attempts committed before the call;
- retry and stop rules;
- the scheduler order;
- the purge;
- partial itineraries refused;
- leg identity;
- A5 for mail;
- concurrency;
- the typed route;
- the CHECKs and the down;
- the display windows;
- the client boundary.

Nits are in NITS.md. N4 (stale evidence) was fixed by the orchestrator.

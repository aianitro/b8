# REVIEW-2 — P8-42e1-loyalty-stays (G3 cycle 2)
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer (2026-11-24)

14 hypotheses tried by reading. 13 REFUTED. One CONFIRMED, but it is behaviour A5 allows (N6).
- A5 holds on every mail path: dated, undated, insert-race fallback, retry, stale classification. `byHand` is true
  only at the hold's `place` call. U7, I5 and I8 each fail when either half of the rule regresses. Typed re-book works.
- N5 withdrawn (I1/I2 measured).

# NITS — P8-42e1-loyalty-stays (open, for a follow-up task)
- N2: an undated cancellation for a known code cancels the stay with no program, not-mine or suffix check (`lib/loyaltyBookingRead.ts` undated path), while the same mail with dates is held.
- N3: the first membership sticks, so a pass decision or a `place` tap for membership M updates a stay that is on M'. The read row still records M, and the page does not say this happened.
- N4: a count of one renders "1 night counted in <year>", while the pinned format is "<n> nights counted in <year>" (`components/LoyaltyStaysSection.tsx`).
- N6: a re-forwarded old confirmation held as `no_suffix` can be placed with one tap, which re-books a cancelled stay. A5 allows this, but the queue item gives no warning. Options:
  - the pass marks such a booking `stale` when its code already has a cancelled stay;
  - the queue item says the code is cancelled.
- Residuals 1-7 in EVIDENCE.md (including A2's duplicated helpers and A5 point 4).

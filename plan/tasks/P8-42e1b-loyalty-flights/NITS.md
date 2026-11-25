# NITS — P8-42e1b-loyalty-flights (open)
- N1 (42e1 N6 class, a new path): a held booked mail placed with one tap can rebook legs the person typed as cancelled.
  The typed cancellation keeps the older mail evidence, so by hand only the date rule applies. The queue item does not
  show the code's current state. (`lib/loyaltyFlightRead.ts` place, `lib/loyaltyFlightStore.ts` queue item.)
- N2 (42e1 N3 again): `placed_by_hand` records the chosen membership while the legs stay on the code's first
  membership. D7 says it records "that membership", while the migration comment says "the chosen membership".
- N3: a re-forward of the original confirmation, received after a change mail, applies as newer. Being `complete`, it
  cancels the changed leg and may bring back the old one. The code follows D7 and D8; this is a stated residual.
- N4: EVIDENCE.md still showed command 22 failing. FIXED by the orchestrator (A6 history kept).
- N5: the mutation table lacks rows for several named breaks: a 42e1 `flight` row touched, attempt counted after the
  call, not_mine reaching hotel items, a hidden retry, the other read schemas widened, purge reaching segments, a
  cancelled row deleted. The scenarios assert each of these by reading; the gap is in the evidence only.

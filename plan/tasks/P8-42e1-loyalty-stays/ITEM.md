# P8-42e1 — Nights & miles: stays and flights from the inbox

**Origin:** `plan/LOYALTY-ROADMAP.md` §5 (`loyalty_stays` / `loyalty_segments`), §6 42e, §7 guardrails; ROADMAP.md §5
Phase 8 step 42e. The owner asked for 42e on 2026-11-24, after P8-42d (`88e0737`). Five-agent pipeline.

**Split.** 42e is sized M–L, so it is split the way 42c was:
- **42e1 (this task):** confirmation and cancellation emails become stays and flight segments; this year's
  qualifying nights per hotel program; a "Stays & flights" section on `/travel`.
- **42e2 (later):** a stay or segment matched to its ledger charge (reads the ledger, so gift-sensitive), award
  bookings as redemptions with the displaced cash price, the instrument marked used, and elite progress where a
  program reports a target.

**42e's exit criterion, which 42e1 starts and 42e2 finishes:** this year's nights per program are right without
anyone counting them, and every award booking appears as a redemption. 42e1's own exit: every hotel stay and flight
whose confirmation reaches the inbox appears on `/travel` within a day, and a cancellation removes it from the count.

## The request

1. **Read bookings from stored mail.** The 42c pipeline (collect, store raw mail for a fixed time, read with Claude,
   structured output, `clean*` pass) gains a booking read: is this message a hotel confirmation, a hotel cancellation,
   a flight confirmation, a flight cancellation, a change, or none of these. For bookings it extracts only what the
   model needs to count and show: program, member-number suffix as printed, property or carrier name, check-in and
   check-out dates (or each flight segment's date, origin and destination airport codes, flight number), the
   confirmation code, and whether it was paid with points or a certificate (recorded as a flag only here; 42e2 makes
   it a redemption). The spec decides whether this is one read with a wider schema or a second read per message, and
   how a message already read for a balance by 42c2 gets its booking read without re-reading balances.
2. **Stays and segments are their own records.** New tables (contract change and migration, through
   contract-guardian): a stay (membership, property, check-in, check-out, nights derived, confirmation code, state
   booked / cancelled, the evidencing message) and a segment (membership, date, origin, destination, carrier, flight
   number, confirmation code, state). A later confirmation or change for the same program and confirmation code
   updates the record rather than duplicating it; a cancellation marks it cancelled, never deletes it.
3. **Attribution follows 42c.** The forwarder and the suffix rules decide the membership, as 42c2's auto-apply does;
   a booking that cannot be attributed with confidence goes to the existing Needs-attention queue with one-tap
   choices, never guessed.
4. **Nights counted, not typed.** `/travel` shows, per hotel program and member, this calendar year's nights from
   stays that are not cancelled and whose check-out is on or before today, plus upcoming stays and flights. Year and
   today are Postgres `CURRENT_DATE`. "Qualifying" means every counted night in 42e1; program-specific qualifying
   rules are out of scope and the page says so.
5. **Typed fallback.** A stay or segment can be added or corrected by hand (path D, source `typed`); a later email for
   the same confirmation code supersedes typed fields, as observations do.

## Constraints

- **Privacy (LOYALTY-ROADMAP §7).** A confirmation carries the guest's name, address, phone and often a card's last
  digits. The read prompt asks for booking fields only; nothing else is stored. The confirmation code is an
  identifier: stored in full, shown masked like member numbers, never in logs, push, mail, the agent's context or an
  API v1 payload except for the one record a caller asks for. No price, total or card digits are stored in 42e1
  (cash prices are 42e2's redemption question).
- **No ledger read** in 42e1. Charge matching is 42e2. `/travel` stays at its current gift class unless the spec finds
  a reason to change it; any new route is registered and covered by the surface script.
- 42c's balance read, auto-apply, retry, lock and retention, and 42d's screenshot path, are unchanged; their
  acceptance commands that still apply keep passing. A change to an existing pinned test or fixture is named in the
  spec with an exact-diff check.
- No real data: fabricated `ZQ42E` programs, properties, airports and confirmation codes, `.test`/`example.*` domains
  only, no figures in comments, fixtures, tests or commit messages.
- Out of scope: charge matching, redemptions, cash prices, instrument use and elite targets (42e2); transfers (42f);
  alerts (42g); the agent tool (42h); 42c2's N3.

**Cut (owner, 2026-11-24):** hotel stays only; flight segments move to P8-42e1b. The SPEC is binding where it narrows
this item.

# P8-42e1b — Nights & miles: flight segments from the inbox

**Origin:** split from P8-42e1 by the owner's approval of the hotels-only cut (2026-11-24); `plan/LOYALTY-ROADMAP.md`
§5 (`loyalty_segments`), §6 42e, §7 guardrails. The owner asked for 42e1b on 2026-11-24, after P8-42e1 (`bbde450`).
Five-agent pipeline.

## The request

1. **Flight mail becomes segments.** 42e1's booking read already classifies `flight` mail and stores the read row with
   state `flight`, extracting nothing (D2 of 42e1's SPEC). 42e1b extracts flight confirmations and cancellations:
   per segment the date, origin and destination airport codes, carrier, flight number; the confirmation code; and the
   award flag. The spec decides whether the existing booking read widens (the schema, the prompt, a re-read of rows
   left in state `flight`) or a separate pass runs, and how rows 42e1 already marked `flight` get read once, without
   a second paid read of any message.
2. **Segments are their own records.** A new table (contract change and migration, through contract-guardian): a
   segment (membership, date, origin, destination, carrier, flight number, confirmation code, state booked /
   cancelled, source typed / email, the evidencing message). One confirmation may carry several segments. A later
   confirmation or change for the same program and confirmation code updates its segments rather than duplicating
   them; a cancellation marks them cancelled, never deletes them. The spec decides how segments of one code are
   matched across mails (date + flight number, or the whole itinerary replaced). 42e1's supersession rules, including
   A5 (mail never revives a cancelled record), apply.
3. **Attribution follows 42e1.** Forwarder and suffix rules (42c2 / 42e1 D9); an unattributable flight booking joins
   42e1's held-booking list with the same one-tap actions, never guessed.
4. **On `/travel`.** The Hotel stays section shows upcoming flights (and recent completed ones), with the confirmation
   code masked. No flight count or mileage figure is computed in 42e1b (status credits and miles are program-specific;
   the page says so if it shows anything per airline program).
5. **Typed fallback.** A segment can be added or corrected by hand (source `typed`); D12-style rules as for stays.

## Constraints

- Same as P8-42e1: privacy (passenger names, ticket numbers, seat, frequent-flyer numbers beyond the suffix, prices,
  card digits are never stored, logged or returned; codes always masked), no ledger read, 42c/42d/42e1 behaviour
  unchanged with any changed pin named in the spec with an exact-diff check, any new route registered and covered
  by the surface script, fabricated `ZQ42E` data only, no figures in comments, fixtures, tests or commit messages.
- Out of scope: 42e2 (charge matching, redemptions), 42f, 42g, 42h, and 42e1's open nits (NITS.md N2, N3, N4, N6).

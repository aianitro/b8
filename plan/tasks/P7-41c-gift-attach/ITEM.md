# P7-41c — attach an already-synced transaction to a gift, and a sane default window

**Origin:** owner request, 2026-10-22, after two real gifts missed their purchase. Not a ROADMAP §5 step: a
follow-up to P7-41b (`6472c64`, gifts) and its authorized-date fix (`e7c7232`). Five-agent pipeline, because
it changes what is masked from whom.

## What happened (no figures; see GATES.md of P7-41b for the code paths)

1. Gift 1: a one-day window; the card row was authorized that day and posted the next. Matching used the
   posted date only, so the row was stored unlinked and shown unmasked until linked by hand. Fixed in
   `e7c7232` (either date counts).
2. Gift 2: created in the evening with "Expected from" set to the NEXT day; the outflow was dated the day
   of creation. The matcher correctly refused it. Because sync matches only rows it first inserts, and only
   for gifts that already exist, there is no way left to attach that row: the gift waits until it expires.

Both are the same gap: once a row has synced, nothing can link it to a gift.

## The request

1. **Attach a transaction to a waiting gift.** On a gift that is `awaiting` (and, the spec decides,
   `choose`), the GIVER sees recent unlinked outflows that satisfy the gift's amount, merchant and account
   criteria while IGNORING the window, picks one, and it is linked exactly as sync would link it: prior
   category and `rule_applied` recorded, filed in the gift category, gift state moved, masked from the
   recipient from that statement on. Only the giver may see the candidate list or attach.
2. **Default "Expected from" to today** in the gift form, today being the giver's LOCAL calendar date (never
   `toISOString().slice(0, 10)`), so the obvious case cannot start a day late.

## Constraints the spec must honour

- The candidate list is itself a surface: it shows transaction text (merchant, name) and must be served
  only to the giver, never to the recipient or anyone else; classify the new route in
  `lib/giftSurfaceRegistry.ts` and extend the gift surface tests. The recipient must not be able to infer a
  gift exists from any response to the new route (status codes, counts, timing aside).
- Attach must refuse: a row already linked to any gift; a row that is not a money-out Plaid row (the same
  `manual_`/`csv_`/pending/sign rules as `isCandidate`); a gift that is revealed, cancelled, matched or
  unmatched; a row that fails the non-date criteria. Concurrency with a sync that is linking the same row
  must be safe (one link per row; the existing lock order in `linkFreshRows`).
- Reuse `isCandidate`'s rules minus the window rather than a second definition; a pure function with
  scenarios.
- How far back candidates go is the spec's to decide and justify (e.g. since the gift's creation minus N
  days, or the last N days), with a default for the owner to confirm.
- Contract surface expected: `packages/contracts/gifts.ts` (request/response shapes for the candidate list and
  attach). G1 with the lease. No migration expected; if one is needed, say why.
- Open from P7-41b NITS: N7 (a gift past its reveal date claiming a row before the sweep) sits next to this —
  the spec decides whether attach must refuse a revealed gift (it must) and whether to fix N7 here.
- Public repo: no real names, merchants or money figures; fixtures fabricated.

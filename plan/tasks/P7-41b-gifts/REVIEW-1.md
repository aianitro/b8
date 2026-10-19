# P7-41b — adversarial review, cycle 1 — 2026-10-19

**Verdict: ACCEPT_WITH_NITS.** Persisted by the orchestrator from the reviewer's report (the reviewer is read-only).
Reading found no text-bearing surface that shows an unrevealed gift's real text to a non-giver: every SQL site reading
name, merchant_name, note, plaid_category or plaid_raw for a viewer goes through `visibleTransactions(viewer)`; the
only raw text reader is `lib/sync.ts` (ingest; outputs links and counts). Insert and link commit in one transaction.
Totals sum raw `transactions`.

## Findings (all NIT)
- **N1** `migrations/1792400000000_gifts.sql:77`, `lib/giftStore.ts:134` — `gifts.id` is SERIAL and returned to the giver;
  a user who creates two gifts sees the gap and learns another gift exists (with two users, one for them). Contradicts
  "Existence is not visible". Fix needs a contract change (opaque id).
- **N2** `lib/giftStore.ts:346-350` — a revealed matched gift whose row is deleted or removed is reset to `awaiting`;
  the sweep then marks it `unmatched` and pushes a false notice; a late row could be re-filed. Fix: reveal conjunct.
- **N3** `lib/sync.ts:482-484` + `giftStore.ts:346` — a replacement delivered in a later sync than its removal (after the
  sweep marked the gift `unmatched`), or a re-auth duplicate whose name changed, is stored ordinary and unmasked.
  Spec-level gap: S2 covers only the same-walk reissue.
- **N4** `app/transactions/page.tsx:87,187`, `api/v1/transactions/route.ts:84 vs 103-104` — the watched chip and watched
  sums differ by viewer when the giver watches the gift; the recipient's drill-down rows do not add to spent + pending.
  A conflict inside the spec (allowlist nulls the flag; conventions require identical counts).
- **N5** `components/GiftForm.tsx` — no recipient field; with two or more other live users every UI create is a 400.
- **N6** `lib/domain/giftMask.ts:79` — masked `name = 'Gift'` where the allowlist says null. No leak; accepted deviation.

## Falsification log (28 hypotheses; summary)
REFUTED: raw text readers outside the read path (every site enumerated and read); `group_peers` subquery; server
actions / client DB access; a column missing from `TRANSACTION_COLUMN_MASK` (27/27 classified); search and merchant
filter oracles; chat tool results and system prompt; rationale and proposal cards; stored overdraft charges and
recurring list; a sync statement visible between insert and link (one BEGIN … COMMIT, reissue inside); `modified`
refresh re-filing a held row; a gift claiming a conflict-refresh, re-identified or tombstoned row; retroactive match
mid-sync; viewer failing open; a cache crossing viewers; masking changing a sum or duplicating a row; an unlocked
write path (every writer checks and repeats the condition in its WHERE); gift-route existence oracle by status/body;
nav or `/gifts` hinting; push body or recipient push; log lines carrying a criterion; money figures or real names;
`name = 'Gift'` as a leak; `property_id` as a leak.
CONFIRMED: N1 (id sequence), N2 (reset), N4 (watched counts).
INCONCLUSIVE → orchestrator: I1 production logging, I2 split-sync reissue (N3), I3 N2 reproduction, I4 registry count.

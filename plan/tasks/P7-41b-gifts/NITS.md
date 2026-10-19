# P7-41b-gifts — follow-ups

From REVIEW-1 (2026-10-19). N2 is returned to the implementer in G3 cycle 1; the rest are deferred.

- **N1 — sequential gift ids are an existence oracle.** `gifts.id` is SERIAL and returned to the giver, so a user who creates two gifts can see a gap and infer the other person made one. Fix: an opaque public id (contract change; G1).
- **N3 — a replacement row in a later sync can land unmasked.** If Plaid removes a matched row in one sync and adds its replacement in a later one, after the sweep has marked the gift `unmatched`, or if a re-auth duplicate's name changes so re-identification fails, the replacement is ordinary and shows its real merchant. Needs a design: what a matched gift that lost its row before the reveal becomes, and how long it keeps matching.
- **N4 — watched counts differ by viewer.** When the giver watches the gift row, the recipient's watched chip and watched sums are lower, and the recipient's drill-down rows don't add up to spent plus pending. A conflict in the spec between the allowlist and identical counts.
- **N5 — no recipient field in the gift form.** With two or more other users, every create from the UI fails with 400. The API accepts `recipientUserId`.
- **N6 — masked `name` is `'Gift'`, not null.** An accepted deviation from the allowlist; no real text reaches any surface.

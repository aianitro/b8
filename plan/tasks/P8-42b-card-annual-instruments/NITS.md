# NITS — P8-42b-card-annual-instruments

From REVIEW-1 (ACCEPT_WITH_NITS). None changes any output today.

- **N1 — the refund-pairing subquery is redundant** (`lib/loyaltyStore.ts`, the `f2` subquery in the `fee` lateral).
  Because only the latest fee matters and a cancelling refund must be dated on or after it, the subquery always
  returns that fee. Confirmed at G3: with it deleted, `loyaltyCard.test.ts` still passes 10/10. The "two refunds
  cancel one fee" gap is therefore unobservable. Simplify, or keep it as documentation if older fees ever count.
- **N2 — the window input coerces hex and exponent text** (`components/LoyaltyCardLink.tsx`, `Number(windowText)`).
  `0x1F` saves 31 days and `1e1` saves 10, against the file's comment. The contract still bounds it to 1–365. Fix:
  accept only `^[0-9]+$` client-side.
- **N3 — two checks narrower than the spec text, ratified at G3:**
  - H12 step 2 on `/accounts/<card>` checks the held name for the recipient only, not the amount. The page is
    text-bearing, and H3 already proves the giver sees their own row.
  - U4's "no db import" is scoped to loyalty page files, because four unrelated existing components import `@/lib/db`.
- **N4 — evidence gap:** the spec's phone and desktop screenshots were not taken. UI wording and state are proved
  over HTTP (H12) and by U4. Look at `/travel` and a linked card's account page after deploy.

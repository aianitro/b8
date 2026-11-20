# P8-42b — cards and their annual instruments

**Origin:** ROADMAP §5 Phase 8, step 42b; `plan/LOYALTY-ROADMAP.md` §4 B ("What b8's ledger already knows") and §6
42b. Owner asked to start it on 2026-11-20 after P8-42a (`194f049`) and P8-42a2 (`2f244d4`) deployed. Five-agent
pipeline.

**Scope split (orchestrator, 2026-11-20):** the roadmap's 42b also names an **earn estimate** (card spend × the card's
multipliers). It needs per-card, per-category multiplier data and its own surface, and is independent of the fee
logic, so it is deferred to a separate step **42b-2**. This task is the link, the fee, and the instrument it should
bring.

## The request

The owner's spreadsheet has three columns per co-branded card — annual fee, annual bonus, bonus availability — that
are typed by hand today. b8 already syncs those cards' transactions. After this task:

1. **A membership can be linked to the credit card account that earns into it** (the existing nullable
   `loyalty_memberships.card_account_id`, unused until now). Linking and unlinking happen on `/travel`; the card's
   `/accounts/[id]` page shows which program it earns into.
2. **The card's annual benefit is described once on the link:** what it issues each year (an instrument kind and a
   short description, e.g. a free night, a companion fare, a points deposit) and how many days after the fee posts
   it normally arrives (a window with a sensible default). A link with no benefit described is valid (a card whose
   fee buys nothing to watch for).
3. **The annual fee is detected in the ledger, not typed.** For a linked card, the most recent annual-fee charge on
   that account is found among its transactions. Measured on the owner's data (read-only, 2026-11-20, no figures):
   fee rows are named `ANNUAL MEMBERSHIP FEE`; Plaid's detailed category is `BANK_FEES_OTHER_BANK_FEES` on some and
   empty on others, and other rows in `BANK_FEES_*` are late fees and interest — so the category alone is not the
   rule. One linked-looking card has no Plaid feed (hand-entered/CSV rows), so detection must not depend on Plaid-only
   columns. A refunded fee (a matching credit) is not a posted fee. Ledger history starts in 2026, so most cards
   show at most one fee so far.
4. **The expectation is derived, never stored:** for a linked card with a benefit described, the state is one of
   *no fee seen*, *awaiting* (fee posted, window open, no instrument yet), *received* (an instrument of that kind on
   that membership issued — or, if its issue date is unknown, recorded — on or after the fee date), or *overdue*
   (window passed, nothing received). This is the spreadsheet's "availability" column, computed.
5. **Shown where the owner looks:** on the membership's line on `/travel` and on the card's account page — the fee
   date, the expected benefit, and the state, with "expected by <date>" while awaiting. No push, dashboard card or
   digest in this task (42g).

## Constraints the spec must honour

- **No stored fee figure and no stored state.** The fee comes from the ledger at read time; the state is derived.
  (LOYALTY-ROADMAP §1, §5.) The fee amount may be *shown* on the page — it is the user's own ledger — but never copied
  into a loyalty table.
- **Gifts.** Fee detection reads ledger rows and their text. It must read through the gift read path
  (`visibleTransactions(viewer)` / `lib/giftReadPath.ts`), and any changed page or route must stay correctly
  classified in `lib/giftSurfaceRegistry.ts` and `scripts/gifts-surface-check.mjs` (a page that now shows a
  transaction's date/amount may change class — the spec decides and proves it).
- **Sign conventions:** the ledger's sign convention (positive = money out for a card charge) is respected and
  stated; a fee is money out, a refund is money in.
- **Linking rules:** only an account of type credit can be linked; one card may earn into more than one membership
  only if the spec justifies it (default: a card links to at most one membership); unlinking leaves the instruments
  untouched.
- **Contract surface expected:** columns for the benefit description and window (on memberships or a small table —
  the guardian decides), route/contract changes for link/unlink and the derived state in the membership view. G1 with
  the lease. `card_account_id` already exists.
- **Dates:** calendar dates as text, no JS clock for "today" on the server (Postgres `CURRENT_DATE`, as P8-42a2 does);
  the window arithmetic is date arithmetic.
- **Public repo:** fabricated fixtures (`ZQ42B` canary), no figures in comments or commit messages, no real card or
  program names in fixtures.
- **Out of scope:** the earn estimate (42b-2), email reading (42c), alerts/push/dashboard/digest (42g), transfers.

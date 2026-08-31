# Roadmap item — P0-09a-tenant-held-funds

**Lineage:** ROADMAP.md §5 Phase 0 (truthful domain model), addendum to step 9 (per-property
P&L / ledger). Not in §5 as written; authored by the orchestrator and recorded here, since
`ROADMAP.md` is kept local and this queue is the tracked record.

## The item

A rental holds money that is not the owner's. Two kinds, and they are **not** the same:

- **Security deposit** — refundable, owed back to the tenant at move-out. Every rental has one.
  It is a genuine liability: the cash sits in the property's trust checking account and the app
  currently counts all of it as the owner's money.
- **Last month's rent held** — some properties hold one, some do not. It is **the owner's money,
  just delayed**: the payment already arrived as cash and the cash-basis P&L already counted it
  as rent income on the day it landed. Calling it a liability now would contradict a statement
  the app has already made.

## Required outcome

1. Net worth is reduced by **security deposits only**. Last-month holdings do not reduce it.
2. Both amounts are visible where the owner reads a property, because "you are holding $X of
   tenant money" is true of both — the difference is whether it is *owed back*, not whether it
   is *designated*.
3. A property that holds no last month's rent shows that it holds none — not `$0` as though the
   tenant paid nothing.

## Decided by the owner, recorded here so it is not re-litigated

Last month's rent is treated as the owner's money. Under strict accrual accounting it would be
unearned revenue and therefore a liability. It is not treated that way here, deliberately: this
app is cash-basis throughout (`computePropertyPnl` sums transactions), the payment was already
recognized as income when it arrived, and booking it as a liability would make the net-worth
statement and the P&L disagree about the same dollar.

## Real amounts are data, not code

The live deposit figures were given verbally and are **not** to appear in specs, fixtures,
tests, commit messages, or `EVIDENCE.md`. They are entered through the UI like every other
valuation. All test data is fabricated.

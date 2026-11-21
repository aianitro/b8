# P8-42b2 — earn estimate for a linked card

**Origin:** `plan/LOYALTY-ROADMAP.md` §1 ("an earn figure derived from card spend is an estimate … never a stored
balance"), §4 B ("Earn estimate"), §6 42b ("Earn estimate on the card page, labelled as one"). Split out of P8-42b by
the orchestrator on 2026-11-20; the owner asked to start it the same day, after P8-42b (`c5c6c48`) deployed.
Five-agent pipeline.

## The request

For a card linked to a membership (P8-42b's `card_account_id`), b8 estimates the points or miles that the card's
spend should have earned, and says how that compares with what the program actually reports.

1. **Earn rules, described once per link.** A base rate (units per currency unit of spend), plus zero or more bonus
   rules. Each bonus rule matches spend either by **b8 category** (`mapped_category`) or by **merchant text** (e.g.
   "hyatt" for a hotel card's own-brand bonus), and carries its own rate. The first matching rule wins, in a stated
   order; the base rate applies otherwise. No caps, tiers, or rotating categories in this task. Say so on the page.
2. **The estimate is derived at read time and never stored.** Spend = the card's purchases (money out) less refunds
   (money in) over a period, excluding transfers and card payments, and excluding the annual fee rows that P8-42b
   recognises. Per rule, then summed, rounded only at display.
3. **The period is "since the last reading".** The estimate covers spend dated after the membership's current reading
   (`as_of`) up to Postgres `CURRENT_DATE`. With no reading, it covers the last 30 days and says so. The page shows
   "≈ N <unit> estimated since <date>", labelled *estimated* everywhere.
4. **Comparison with the next reading.** When a newer reading arrives, the change between the two readings is
   compared with the estimate over the spend between their `as_of` dates. That comparison is shown on the membership
   as the latest "estimate vs actual" (estimated, actual, and the difference as a percentage). A miss beyond a stated
   threshold is marked as worth a look (a retention bonus, a category that did not code), but no alert or push.
5. **Shown** on the card's `/accounts/[id]` page (under P8-42b's "Earns into" block) and on the membership's line on
   `/travel`.

## Measured on the owner's data (read-only, 2026-11-20, counts only)

- Credit-card rows by Plaid primary category: about a third have none (the non-Plaid card and others), so rules must
  match on b8's `mapped_category`, which every row has, never on Plaid categories.
- Card rows include loan disbursements, card payments, income and transfer-ins, all money in. Spend must be defined
  by sign plus a transfer exclusion, and the spec must say how card payments and refunds are told apart.
- No membership is linked and no reading exists in prod yet; the import has not run. All tests use fabricated data.

## Constraints

- **No stored estimate, no stored comparison.** Rules are configuration and may be stored; every figure derived from
  them is computed at read time (LOYALTY-ROADMAP §1, §5).
- **Gifts.** Spend is read through `visibleTransactions` (`lib/giftReadPath.ts`). The estimate must be the same for
  every viewer. The spec decides whether a gift-held row counts as spend (P8-42b's precedent excluded held rows from
  fee detection) and proves it. Any changed page or route stays correctly classified in the gift surface registry
  and `scripts/gifts-surface-check.mjs`. Merchant-text matching reads row text, which bears on the class.
- **Money and units:** spend is NUMERIC in SQL and never a JS float. Rates are decimals, and units follow P8-42a's
  unit scales. The estimate is rounded once, at display, by a stated rule. P8-42a's decimal-text conventions apply.
- **Dates:** Postgres `CURRENT_DATE`, never a JS clock, and calendar dates as text.
- **Contracts:** the rule storage (table or columns, decided by the guardian), and the membership view gains the
  estimate and the comparison. G1 with the lease.
- **Public repo:** fabricated ZQ42B2 fixtures, no real card or program names, no figures in comments or commit
  messages.
- **Out of scope:** caps, spend tiers, rotating categories, sign-up bonuses, alerts, push, the dashboard, the digest
  (42g), email reading (42c), transfers (42f), and stays (42e).

# P8-42a — loyalty model, the `/travel` page, and a one-time import

**Origin:** ROADMAP §5 Phase 8, step 42a (added 2026-11-19 at the owner's request). Design, integration
analysis and the owner's answers: `plan/LOYALTY-ROADMAP.md` — read §2, §3, §5, §7 and §8 before writing
the spec. Five-agent pipeline: a new domain, a migration, a contract, a new page and API routes.

## The request

The household tracks its loyalty accounts (airline miles, hotel points and free nights, a card's
transferable points, travel-agency cash, a car maker's points) in a spreadsheet. This step makes b8 hold
that data and show it, so later steps (42b–42h) can fill it automatically. Nothing in this step reads
email, Plaid or screenshots.

1. **A model** (LOYALTY-ROADMAP §5, core tables only): household members (a person who may or may not be
   a b8 user), programs, memberships (program × member, member number, tier, optional link to a card
   account), append-only balance observations (as-of date, balance, unit, source), and instruments
   (certificates, companion fares, travel credits: issued, expires, used).
2. **A page, `/travel`, labelled "Nights & Miles"**, in the sidebar after Properties and before Gifts:
   one card per program, one line per membership (member, balance with its unit, tier, as-of date, source
   badge, masked member number with a copy action), then the instruments sorted by expiry. Every field is
   editable in place; an edited balance is a new observation with source `typed`, not an update.
3. **A one-time import** of the owner's spreadsheet export: a local script the owner runs once on the
   home server against a CSV. Dry run by default; prints counts only.

## Constraints the spec must honour

- **Not net worth, not accounts.** No change to `accounts`, `account_valuations` or `computeNetWorth()`;
  a negative control proves net-worth output is identical with loyalty rows present.
- **Units belong to the balance.** Points/miles are whole numbers; a cash-denominated balance (travel
  credit, travel-agency cash, a cash-back card) is money: `NUMERIC` with scale 2. The spec states the unit
  vocabulary and how a balance's unit is validated against it.
- **Current balance is derived:** the newest observation by as-of date, ties broken deterministically,
  never newest by arrival and never a stored "current" column. Re-importing or re-entering an older
  reading must not roll a balance back. Use or extend the repo's existing newest-wins reducer rather than
  writing a second one.
- **null is unknown, never 0.** A membership with no observation shows no balance, not zero. The
  spreadsheet has many empty balance cells; they import as no observation.
- **Member numbers are stored in full and emitted masked.** No API response carries a full member number
  except one route that returns a single membership's number for the copy action; never in logs. The
  spec decides the mask (e.g. last 3–4 visible).
- **Members:** a member may be linked to a `users` row or not. Both b8 users see and edit everything (they
  are peers). A member who is not a user has no access and needs none.
- **Programs:** the catalog must not fingerprint the household. Either seed a broad list of well-known
  programs (wider than the household's) or let programs be created by the import/UI — the spec decides and
  justifies. Columns that later steps need (sender domains for 42c, expiry rules for 42g) are out of scope
  here unless trivially nullable; say which.
- **The annual-fee column** of the sheet is not imported as a stored figure — 42b derives it from the
  ledger. The "annual bonus" + "availability" columns map to an instrument only where availability says
  it is issued and unused; the spec states the exact mapping and what happens to a bonus cell with no
  availability.
- **Import script:** idempotent (a second `--apply` run creates nothing new), dry run by default, refuses
  rows naming a program or member it cannot resolve rather than guessing, and prints counts only — no
  names, numbers or balances on stdout. Tested against a fabricated CSV fixture in the repo.
- **Surfaces:** the page in `lib/giftSurfaceRegistry.ts` **and** `scripts/gifts-surface-check.mjs` PAGES;
  every new `route.ts` in ROUTES. Loyalty carries no transaction text, so `no-transaction-data` is
  expected — the spec confirms.
- **API v1 + contracts:** routes under `app/api/v1/`, shapes in `packages/contracts/` (G1 with the lease),
  migration + `db/schema.sql`.
- **UI:** the `uiux-promax` skill governs the page (tokens, palette, phone layout). The installed PWA on a
  phone is a primary target.
- **Public repo:** no real program balances, member numbers, names or fees in fixtures, tests, comments or
  commit messages. Fabricated programs and figures in fixtures.

## Out of scope (later steps)

Card ↔ fee detection and earn estimates (42b), the email inbox (42c), screenshot capture (42d), stays,
segments and redemptions (42e), transfers (42f), expiry alerts, dashboard/digest/push (42g), the agent
tool (42h).

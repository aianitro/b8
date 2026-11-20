# Nights & miles — a loyalty roadmap for b8

**Planning doc, not a spec. Written 2026-11-19 at the owner's request; the owner's answers to its
open questions were folded in the same day (§8).** A companion to the root `ROADMAP.md`, the way
the net-worth revision was: once accepted, it folds in as a §5 phase, and this file becomes the
record of why it is shaped this way.

> **This file is tracked, and the repo is public.** It describes the *shape* of the household's
> loyalty portfolio (counts and kinds), never a member's name, a member number, a balance, an
> annual fee or a certificate's value. The spreadsheet it was planned from stays on the owner's
> machine. Program names appear only to say how a program can be reached, which is a fact about the
> program and not about this household.

---

## 1. What the owner asked for

Track reward **nights and miles** inside b8, across every loyalty account the household holds,
and **"integrate with those accounts as much as possible with no need to put data manually."**

That last clause is the design constraint for the whole doc. It reverses the backlog entry this
promotes — ROADMAP.md *[P3] Reward nights, miles and points tracker* (2026-09-22, widened
2026-10-19) — which concluded *"a manual-entry domain first."* That was correct about Plaid (it
carries none of this) and wrong to stop there: the programs' own emails are an automatic source no
program can switch off (§4 A), and b8's ledger already holds half of what the spreadsheet tracks by
hand (§4 B). Everything else in that entry stands and is carried forward here — the entry itself is
now a pointer to this doc (merged 2026-11-19):

- **Why at all:** the balances that pay for travel belong next to the money that does, and the
  failure this prevents is an expiry quietly passing.
- **Scope:** airline and hotel balances, award nights, elite status and expiries, **and credit card
  rewards — transferable points and cash back.**
- **Points stay unvalued and out of `computeNetWorth()`.** A cents-per-point figure is a guess that
  differs per program and would look authoritative in a net-worth line.
- **A redemption log is the one honest value figure:** what each award night or flight displaced
  in cash, observed at the time, never applied back to a balance (42e).
- **Transfers between programs are events** with two sides, not two unrelated balance changes (42f).
- **An earn figure derived from card spend is an estimate** (multipliers, caps and exclusions vary
  by card), never a stored balance (42b).

## 2. What the spreadsheet says about the shape

The owner's sheet is the system this replaces. Read for structure only:

| Dimension | What is there |
|---|---|
| Rows (memberships) | 29 |
| Distinct programs | 19 — 11 airline, 5 hotel, 1 bank card currency, 1 travel-agency cash, 1 car maker |
| People | 3 — the owner, the second user (Phase 7), and a household member who is **not** a b8 user |
| Columns | balance · annual fee · annual bonus · bonus availability · member number |

What the columns reveal that a naïve "points balance" table would miss:

1. **A balance is not always points.** One airline row is a cash-denominated travel credit; the
   travel-agency program is cash too, and so is any cash-back card the household adds. The unit
   belongs to the balance, not to the program.
2. **"Annual fee" and "annual bonus" are about a co-branded credit card, not the program.** The fee
   is a charge that already arrives through Plaid on a card b8 already syncs. The bonus is an
   *instrument* the card issues each year — a free-night certificate, a companion fare, a points
   deposit. "Availability" is that instrument's state: issued and unused, or not.
3. **Most rows are empty.** Many memberships exist only to hold a member number (for adding to a
   booking) with no balance anyone has bothered to type. That is what manual tracking produces; the
   point of automation is that the empty cells fill themselves.
4. **Memberships belong to people, and one person cannot sign in.** b8's `users` table holds people
   who have passkeys. A loyalty member is a household person, user or not.
5. **The highlighted cells** mark what the owner currently cares about — the balances worth acting
   on. b8's equivalent is a surface that only speaks when something is actionable (§3).

"Nights" in the request means two different things, and both are in scope: **free-night
instruments** (certificates and award stays — balance-like things that expire) and **elite
qualifying nights** (progress toward status, counted from stays). Miles likewise: the redeemable
balance, and the status-qualifying figures some programs report beside it.

All 19 programs are tracked the same way, including the car maker and the travel-agency cash (§8).

## 3. Where it lives in the app

**A new top-level page, `/travel`, labelled "Nights & Miles"**, in the sidebar after Properties and
before Gifts. Not under `/accounts` and not under `/net-worth`, deliberately:

- `/accounts` is the ledger: every row there has a currency balance and (mostly) a Plaid feed, and
  `accounts`/`account_valuations` assume both. Putting loyalty rows there would either bend those
  tables or show a points balance in a column readers parse as dollars.
- `/net-worth` sums. Points summed into net worth need a cents-per-point guess — the backlog entry's
  objection, unchanged.
- Properties is the precedent that works: a domain of its own, with its own page, linked to ledger
  accounts where a real link exists.

The page, top to bottom:

1. **Needs attention** — only when non-empty: an instrument expiring, points at risk from
   inactivity, a card fee posted with no certificate seen, a transfer that left one program and has
   not arrived in the other, a person's forwarding gone quiet, a reading b8 could not place.
2. **By program** — one card per program; inside it, one line per member (balance, unit, status,
   as-of date, source badge: *email* / *screenshot* / *typed*). The member number is masked with a
   tap-to-copy, because the real use of that column is pasting it into a booking.
3. **Certificates & credits** — every instrument with its expiry, sorted by expiry.
4. **Stays & flights** — upcoming and this year's, with qualifying nights per hotel program.
5. **Transfers** — points moved between programs, each with both sides.
6. **Redemptions** — what was booked with points, how many, and the cash price it displaced where
   one was observed; the year's total of cash not spent is the page's only money figure.

**Who sees what** (§8): both b8 users are full peers and see every membership, as they see every
account. The household member who is not a user sees nothing and needs no access; alerts about
their memberships go to the owner.

It reaches the rest of the app in five places, each added in its own step:

| Surface | What it shows | Step |
|---|---|---|
| `/accounts/[id]` of a co-branded card | "Earns into <program>", the instrument it issues, and its state | 42b |
| Dashboard | A card only when *Needs attention* is non-empty — nothing otherwise | 42g |
| Daily digest | One widget, same rule. **Needs an allowlist amendment** (§7) | 42g |
| Push | Expiry and missing-certificate alerts, to the member's own user (owner for a non-user member) | 42g |
| Chat agent | One read-only tool: balances, instruments, expiries, transfers | 42h |

## 4. How data gets in without anyone typing it

**A for balances and everything else the programs announce, B for what the ledger already knows,
C as the no-typing fallback, D as a last resort.**

### A. A dedicated loyalty inbox — the primary source

Every program emails its members: monthly statements with the balance, booking confirmations,
"your free night is here", "your points expire in 60 days", "your transfer is complete". The
household's mailboxes already receive all of it. Reading it is the one integration no program can
switch off.

**Shape:** a dedicated mailbox only b8 reads. **Each person sets up a filter in their own mailbox
that forwards only loyalty senders to it** (§8) — including the member who does not use b8. b8 polls
it over IMAP on the daily job (and on demand), keeps only mail from a per-program sender allowlist,
and reads each message with Claude using structured output — the receipt reader's pattern,
including *"a proposal, never a fact"* and a `clean*` pass after the schema.

**Auto-apply rule** (this is what makes it zero-typing rather than a queue to clear): a reading is
applied without asking when the sender is on the program's allowlist, the member number in the
message matches a known membership (programs print it, often masked — the visible suffix is
enough), the as-of date is newer than the stored one, and the figure passes sanity checks. Anything
else lands in *Needs attention* as one tap: "apply / not mine / ignore".

**Forwarding health, per person.** A filter can break silently — a changed mailbox, a disabled
rule. b8 records which person's mailbox each message came through (the forwarded message keeps its
original recipient) and flags a person whose forwarding has been silent for longer than the longest
statement cycle among their programs. This is the inbox's equivalent of Plaid feed health.

Why a forwarding inbox and not Gmail OAuth over each person's mailbox:

- **Least privilege.** Gmail's read scope is whole-mailbox; b8 would read every email the household
  receives to find the few it needs. A filter decides what b8 sees, in the person's own mailbox.
- **Gmail's read scope is a restricted scope.** An unverified app in "Testing" status gets refresh
  tokens that expire after seven days — the integration would silently die every week. Verification
  for a restricted scope is a security assessment, not a form.
- **It works for every provider**, whatever mail service each person uses.
- **The cost:** a filter per person, once, and confirming the forwarding address.

**The known gap:** some programs send no balance by email, or send it rarely. Step 42c measures
which, after the inbox has seen a full statement cycle; those programs get path C.

### B. What b8's ledger already knows

No new integration, just joining loyalty to Plaid data b8 already has:

- **The annual-fee check.** A co-branded card's fee posts as a transaction. When it does, the card's
  annual instrument should be issued within the program's usual window; if no email has shown it by
  then, b8 says so. This is the spreadsheet's "availability" column, computed instead of typed.
- **Earn estimate.** Spend on a linked card × the card's published multipliers ≈ points to expect on
  the next statement. Shown as *estimated*, never written to a balance, and compared against the
  next real reading — a large miss is a finding (a retention bonus, a category that did not code).
- **Stays matched to charges.** A hotel charge in the ledger matched to a stay from 42e, the same
  way receipts match captures to charges.

### C. Screenshot share — the no-typing fallback

For a program the inbox cannot read a balance from, the person screenshots the program's app and
shares it to b8. This reuses the receipt pipeline end to end: the PWA capture, `receiptReader`'s
structured-output read, the confirm form. One tap to share, one tap to confirm. Not zero-touch, but
zero typing — and *Needs attention* asks for it only when that program's balance is older than its
usual cycle.

### D. Typed — always available, never the plan

Every field stays editable, because every automatic source is sometimes wrong. A typed value is
recorded as an observation with source *typed*, so the next automatic reading still supersedes it
when newer.

### Rejected

- **A third-party aggregator (AwardWallet's Account Access API).** It would be the broadest balance
  source — OAuth, a read-only scope, and it already reads the blocked airlines' emails — but it means
  the household's loyalty logins live with a third party. **The owner declined it (§8).** Revisit
  only if the owner changes that answer; nothing in the model would have to change, it would be one
  more observation source.
- **Storing loyalty passwords in b8 and logging in on a schedule** (headless browser or scraping).
  It puts airline credentials behind a network-reachable surface, breaks on every MFA prompt and
  page change, and is the activity several carriers sent cease-and-desist letters over.
- **Gmail OAuth over each person's mailbox.** §4 A: whole-mailbox reach, and seven-day tokens.
- **Plaid.** It has no loyalty coverage, and its card products carry no rewards balance. Revisit if
  Plaid ships a rewards product.
- **Valuing points into net worth.** Unchanged from the backlog entry.

## 5. The model, sketched

A sketch for `contract-guardian`, which owns the real schema. None of it touches `accounts`
or `computeNetWorth()`:

- **`household_members`** — a person who can hold a membership: display name, and an optional
  `user_id` (a b8 user is a member; not every member is a user), and the mailbox address their
  forwarding arrives from. This is the one table that carries a name, and it lives only in the
  database.
- **`loyalty_programs`** — the catalog, seeded from a fixture of public facts: name, kind (airline,
  hotel, card currency, travel cash, car, other), default unit, sender domains for the inbox, and
  its expiry rule as data (inactivity months, or none).
- **`loyalty_memberships`** — program × member: member number (full value stored, never emitted —
  §7), current tier, optional `card_account_id` → `accounts(id)` for a co-branded card.
- **`loyalty_observations`** — append-only: membership, as-of date, balance, unit, optional
  qualifying figures (JSON — every program counts status differently), source
  (`email` / `screenshot` / `typed`), source reference (message id, capture id).
  **The current balance is the newest observation by as-of date, not by arrival** — a re-forwarded
  old statement must not roll a balance back. The same lesson as `account_valuations`.
- **`loyalty_instruments`** — certificates, companion fares, travel credits: membership, kind,
  description, issued on, expires on, used on, and the observation or email that evidenced it.
- **`loyalty_stays`** / **`loyalty_segments`** *(42e)* — from confirmations: program, member,
  dates, nights or segment, confirmation code, optional matched transaction.
- **`loyalty_redemptions`** *(42e)* — membership, the stay or segment it paid for, points (or
  certificate) spent, and the **displaced cash price with its source** (`email` when the
  confirmation shows it, `screenshot` of the cash rate at booking, `typed`), or none. Nullable on
  purpose: a redemption with no observed cash price is recorded and contributes nothing to the
  "cash not spent" total, rather than a guessed one.
- **`loyalty_transfers`** *(42f)* — from-membership, to-membership, amount out, amount in (they
  differ by the transfer ratio and any bonus), initiated on, completed on, and the two emails that
  evidence each side. A transfer is *open* until its arrival is seen.

## 6. The phase — proposed as Phase 8, step 42

Numbered to follow Phase 7's step 41; renumber if anything has taken 42 since. Delivered through
the five-agent pipeline, one task folder per sub-step, as usual.

**42a — The model, the page, and a one-time import.** *(M)* §5's core tables (members, programs,
memberships, observations, instruments); `/travel` with the program cards and the instruments list;
edit-in-place (path D). A local, one-off script imports the owner's spreadsheet export — run on the
home server, the export never committed. Registered in the gift surface registry as
`no-transaction-data`, and in the screenshot script's PAGES table.
*Exit: the page shows every membership from the sheet, nothing typed twice.*

**42b — Cards and their annual instruments.** *(S–M)* Path B. Link a co-branded card account to its
membership (from the card's account page). Detect its annual fee among the card's transactions;
open an expectation for the instrument; close it when a reading shows the instrument; alert when it
does not arrive in the window. Earn estimate on the card page, labelled as one.
*Exit: the sheet's "annual fee / annual bonus / availability" columns are computed, not typed.*

**42c — The loyalty inbox.** *(L)* Path A. Mailbox + IMAP poller on the daily job; per-program
sender allowlist; Claude read with structured output; the auto-apply rule; the one-tap queue;
forwarding health per person. Statement emails first: balances, expiry warnings, instruments. Raw
mail kept a short, fixed time for re-reading after a parser fix, then deleted. A coverage readout on
`/travel` lists, per program, the last statement seen and whether it carried a balance — this is
where the gap §4 A predicts becomes a list.
*Exit: every program that emails a balance updates within a day of that email, untouched.*

**42d — Screenshot share.** *(S–M)* Path C, for the programs 42c's coverage readout shows the inbox
cannot reach. Reuses the receipt capture and reader with a loyalty schema.
*Exit: no program needs typing to stay current.*

**42e — Stays and flights: the "nights".** *(M–L)* Confirmation and cancellation emails from the
inbox become stays and segments; qualifying nights per hotel program per year; elite progress where
the program reports a target; a stay matched to its ledger charge. An award booking (points or a
certificate) becomes a **redemption**: the instrument is marked used, and the displaced cash price is
taken from the confirmation where printed, otherwise offered as a one-tap screenshot of the cash
rate, otherwise left empty.
*Exit: this year's nights per program are right without anyone counting them, and every award
booking appears as a redemption.*

**42f — Transfers between programs.** *(M)* Card-currency transfers out and airline/hotel credits
in, each read from its own confirmation email, paired into one transfer by program pair, member,
date window and ratio. An unpaired side stays open; one open past the program pair's usual delay is
a finding. A typed transfer is allowed and is superseded by its emails when they arrive.
*Exit: a transfer shows both sides without anyone recording it, and one that goes missing is flagged.*

**42g — Speaking up.** *(S–M)* Expiry rules evaluated daily (instrument expiry; inactivity expiry
from the program's rule and the last observed activity); dashboard card and digest widget that
appear only when *Needs attention* is non-empty; push to the member's own user — the second user
about their memberships, the owner about theirs and the non-user member's.
*Exit: nothing expires without at least one notice a set number of days before.*

**42h — The agent tool.** *(S)* One read-only tool — `get_loyalty_summary` — with member numbers
masked in its output. Plus golden questions in `evals/golden/` with fabricated programs and figures.

*Phase exit: the owner stops opening the spreadsheet. Every balance on `/travel` carries an as-of
date no older than the program's own statement cycle, and no row was typed after the import.*

**Order:** 42a → 42b → 42c → (42d ∥ 42e) → 42f → 42g → 42h. 42b comes before the inbox because it
needs no new integration and computes two of the sheet's five columns. The forwarding filters can
be set up as soon as the mailbox exists, before 42c ships — mail that arrives early is read when the
parser lands, so 42c's coverage readout starts with history. 42g may start after 42b with
instruments only.

## 7. Guardrails that apply from step one

- **Public repo.** No member number, balance, fee, certificate value or member name in a commit,
  comment, fixture or test. Fixtures use invented programs. The spreadsheet export stays outside the
  repo.
- **Member numbers are identifiers, not secrets — but they enable social engineering.** Stored in
  full (tap-to-copy is the real use), shown masked, never in logs, mail, push, the agent's context, or
  an API v1 payload unless the caller asks for that one membership.
- **The outbound allowlist** (`plan/tasks/P0.5-33-delivery-channel/DECISION.md`) currently excludes
  balances. A digest widget saying "a certificate expires in N days" needs a recorded amendment
  before 42g, and it should carry no balance and no number.
- **What goes to Anthropic.** Loyalty emails and screenshots are read by Claude, as receipts are. A
  statement email can carry a name and address; the read prompt asks for program fields only, and
  only the extracted fields are stored beside the raw message, which is deleted on schedule.
- **The mailbox credential** lives with the Plaid secrets (`.env.local` / the server's secret store),
  never in the database in clear, never in the repo. The mailbox receives only forwarded loyalty
  mail, so a leak of it exposes that and nothing else.
- **Gifts.** Loyalty surfaces carry no transaction text, so they register as `no-transaction-data` —
  except 42b's fee detection and 42e's charge matching, which read ledger rows and must read through
  `visibleTransactions`. A gift bought with points is out of scope for now; flag it if it comes up.

## 8. The owner's answers (2026-11-19)

1. **Third-party aggregator — no.** AwardWallet is rejected (§4 Rejected); the inbox is primary.
2. **Forwarding — each person sets up their own filter**, including the member who does not use b8.
3. **Access — the second user has it already** (a full peer since Phase 7). **The non-user member
   has not asked for any**; they get none, and alerts about their memberships go to the owner.
4. **Car-maker points and travel-agency cash — tracked like everything else.**
5. **Transfers between programs — in this phase** (step 42f).
6. **Merge with the P3 backlog entry** — done; its redemption log and cash-back scope were the two
   things this doc lacked (§1).

## 9. Decisions to record as ADRs

- Loyalty is a separate domain on `/travel`, not accounts, and is never summed into net worth.
- No third-party aggregator and no stored program credentials: b8 learns balances from the
  programs' own emails, the ledger, and screenshots.
- A forwarding inbox over mailbox OAuth, for least privilege and refresh-token lifetime.
- Observations are append-only and current state is newest-by-as-of, not newest-by-arrival.
- A transfer is one event with two evidenced sides, open until both are seen.
- Value is observed per redemption (cash displaced), never assumed per point.

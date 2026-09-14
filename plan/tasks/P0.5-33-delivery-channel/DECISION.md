# DECISION — P0.5-33 outbound destination and allowlist

**Type:** `BUILD.md` §5.1 human escalation — *"Any change that would put real financial data behind a
network-reachable surface."* This file is the recorded decision that trigger requires. It exists
because the choice was the owner's to make and because two later steps inherit it.

**Decided by:** the owner, 2026-09-03, in response to an orchestrator escalation that presented three
destinations and three allowlist postures with their trade-offs stated.

## The decision

1. **Destination: SMTP via a cloud mail provider.** Nodemailer against a hosted provider, credentials
   in `.env.local`.
2. **Allowlist: names and figures.** Category names, amounts and ratios may leave the process —
   e.g. *"Dining Out at 71% on day 8, projecting 266% of budget."*

## What the owner was told before deciding, and accepted

The option was presented with its costs written on it, not buried:

- **A third party holds the content in transit and at rest.** A hosted mail provider stores what is
  sent to it. This is the first time any real figure from this app leaves the machine.
- **It contradicts ROADMAP.md §5 Phase 5 step 38's non-goals** — *"no third-party service holding the
  ledger, no cloud mail provider"* — and therefore requires an amendment to that line rather than a
  quiet contradiction. Amended below.
- **"Names and figures" is the largest of the three allowlists offered**, and the note attached to it
  read: *"couple this with local-only, or accept the exposure."* The owner chose the cloud transport
  and the full payload together, having been shown that pairing explicitly.

**The concern was raised once, in advance, and the decision is the owner's.** It is recorded here so
that neither the reasoning nor the fact that the trade-off was surfaced depends on anyone's memory.

## What this decision does NOT authorise

Stated narrowly, because two later steps import this allowlist and an unbounded reading would carry
further than intended:

- **Not a third-party service holding the ledger.** A mail provider receiving a short alert is not
  the database living in someone's cloud. That non-goal survives intact.
- **Not raw transaction rows.** Step 38's *"no attachment containing raw transaction rows"* is
  untouched. The allowlist covers a category name, its figures and its ratio — not merchant names,
  not account identifiers, not balances, not transaction-level detail.
- **Not a second destination.** Per §5's outbound carve-out, the §5.1 escalation recurs **every time
  the destination changes**. This decision covers one provider, chosen once.
- **Not sending during development.** No agent sends a message to any real address at any point in
  building this.

## Consequences the spec must carry

- SMTP credentials join `.env.local` — gitignored, gitleaks-gated on every commit, **never committed**
  (§0). A new secret is a new way to leak one.
- TLS is not optional; plaintext SMTP would put these figures on the wire in clear.
- **The coverage interaction is the sharpest one.** Step 32 established that the headline refuses
  authority below 95% coverage, and the owner's real August sat at **7.7%**. A guardrail that emails
  a figure the dashboard itself will not stand behind is incoherent — the spec must decide what is
  sent, or whether anything is, when coverage is low.

---

## AMENDMENT — 2026-09-14: transaction-level detail, including merchant names

**Decided by:** the owner, 2026-09-14, in response to an escalation raised before any of the code
below was written.

**What changed.** The original allowlist above reads *"not merchant names, not account identifiers,
not balances, not transaction-level detail."* Merchant names and transaction-level rows are now
**inside** the allowlist. Account identifiers and balances remain **outside** it, unchanged.

**Why it was reopened.** Two redesigns of the guardrail email were rejected by the owner as "not
informative, not actionable" and then "still useless". Both stayed inside the original allowlist,
and that is most of why they failed: an email restricted to category names and ratios can report
that something is wrong and can never say which record to go and fix. The owner asked for three
widgets — uncategorized transactions, yesterday's transactions, and the year-end projection — and
the first two are transaction lists that are worthless without the merchant name.

**What the owner was told before deciding.** That the rows go to Gmail, which holds the content in
transit and at rest; that this is the exact exclusion the 2026-09-03 decision wrote down; and that
the alternative — dates and amounts with merchants withheld — stays inside the current policy and is
much weaker as a to-do list. Both options were shown rendered, side by side, before the choice.

**What this amendment still does NOT authorise:**

- **Not account identifiers, and not balances.** `DigestTxn` in `lib/domain/digest.ts` has four
  fields — date, label, amount, category — and `digest.test.ts` pins that field set, so widening it
  is a visible change to the outbound surface rather than a quiet one.
- **Not a second destination.** The §5.1 escalation still recurs every time the destination changes.
  This amendment changes the payload only; the provider is the one chosen on 2026-09-03.
- **Not a remote resource in the message.** The email is HTML now, which the alert it replaces
  deliberately was not. The rule that motivated text-only — a remote image is a second outbound
  surface with a different destination, and it reports back that the message was opened — is kept by
  a stronger means: the renderer emits no URL of any kind, and `digest.test.ts` asserts that against
  the rendered output rather than trusting a comment.

---

## AMENDMENT — 2026-09-14: the owner's own watchlist notes

**Decided by:** the owner, 2026-09-14, choosing "flag, note, and digest widget" from three scoped
options presented with their disclosure costs.

**What changed.** The digest's "Keeping an eye" widget renders `transactions.watch_note` — free text
the owner types, such as *"returning to Zara"* or *"double charged"*. That is a new KIND of content
leaving the machine. The 2026-09-14 amendment above covers transaction-level detail as the bank
reports it: merchant, date, amount, category. A note is none of those. It is the owner writing a
sentence, and it goes to Gmail like everything else in this message.

**Why it was allowed rather than withheld.** The note is the entire value of the flag. A widget
listing "Zara, $120.17, 31 days" without it says something is outstanding and cannot say what, which
is the same failure the first two versions of this email were rejected for. Withholding it would
have reproduced the defect the whole redesign existed to fix.

**The bound that makes this decidable rather than open-ended.** A note is capped at 200 characters
by a database CHECK, by the contract schema, and by the write-path validator — three places, each
stating the same rule, so the field cannot quietly become a place to keep anything substantial. It
is a reason, not a journal. Somebody who wants to put a password or an account number in it can, and
nothing here can stop that; what the cap does is make the field obviously unsuitable for it.

**What this amendment still does NOT authorise:** unchanged from above. Not account identifiers, not
balances, not a second destination, not a remote resource in the message. The chart added on the
same day is attached to the message as a `cid:` part and fetches nothing.

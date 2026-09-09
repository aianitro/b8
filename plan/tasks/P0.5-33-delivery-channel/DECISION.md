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

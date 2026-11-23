# P8-42c2 — the loyalty inbox: read collected mail

**Origin:** `plan/LOYALTY-ROADMAP.md` §4 A (the Claude read, the auto-apply rule), §6 42c, §7 guardrails ("What goes
to Anthropic", member numbers). This is the second half of 42c; P8-42c1 collects the mail. The owner asked on
2026-11-21 to go straight on to it once 42c1 deploys. Five-agent pipeline.

**42c's exit criterion, which this task closes:** every program that emails a balance updates within a day of that
email, untouched.

## The request

1. **Read each stored message with Claude, using structured output.** Follow the receipt reader's pattern
   (`lib/receiptReader.ts`): *a proposal, never a fact*, a JSON schema, then a `clean*` pass that rejects or nulls
   anything malformed. The read asks for program fields only:
   - program;
   - member-number suffix as printed (often masked);
   - balance and its unit;
   - as-of date;
   - expiry warnings (what expires, when, how much);
   - instruments mentioned (certificates, free nights, companion fares: kind and expiry).

   It never asks for names or postal addresses. Reading runs on the daily job after the poll, and on demand after
   "Check inbox now". Each message is read once. A re-read happens only by an explicit action, e.g. after a parser
   fix, and never on a timer. The spec names the model, the timeout and the failure codes.
2. **What is stored is the extracted fields only, beside the raw message.** The raw message is still deleted on
   42c1's schedule. Extracted readings may outlive it; the spec decides and states for how long. No figure is
   computed in JS floats: balances are decimal text or NUMERIC, using P8-42a's unit scales.
3. **The auto-apply rule** (roadmap §4 A). A reading becomes the membership's new balance reading without asking when
   all of these hold:
   - the sender is on that program's allowlist (already true for anything stored);
   - the member number in the message matches exactly one known membership of that program (a visible suffix is
     enough, and an ambiguous suffix is not a match);
   - the as-of date is newer than the stored reading's;
   - the figure passes stated sanity checks: non-negative, within the unit's scale, and no implausible jump. The spec
     defines "implausible" and its threshold.

   Applying writes through the existing readings path, so history, the earn comparison (P8-42b2) and the overview
   all see it.
4. **Needs attention.** Anything that fails a rule above lands in a one-tap queue on `/travel`:
   - **apply** — with the membership chosen when ambiguous;
   - **not mine** — discard, and record that the suffix does not belong to the household;
   - **ignore** — discard.

   Each item shows the program, the masked suffix, the proposed figure and date, and why it was not applied. The
   queue empties itself as items are resolved. It is not an alert: no push, no digest, and no dashboard card. Those
   come in 42g.
5. **Coverage readout, second half.** Per program on `/travel`, next to 42c1's "last seen": whether the last
   statement carried a balance (yes / no / not read yet).
6. **Expiry warnings and instruments** are stored as readings for 42g to act on later. This task shows them on the
   membership line and evaluates no rules over them.

## Constraints

- **What goes to Anthropic (§7).** Only messages from allowlisted senders that 42c1 stored. The prompt asks for
  program fields only. No member name, address or full member number is stored from the read. The model's raw output
  is never logged. Logs carry counts and codes only.
- **Member numbers (§7).** Matching uses the stored full number against the printed suffix. The suffix is shown
  masked. A full member number never appears in an API v1 payload, a log, or the queue.
- **Untrusted input.** Mail is attacker-controlled: anyone can mail the inbox and spoof an allowlisted From (42c1's
  stated limit). The prompt must resist instructions embedded in the mail. A read result can only ever propose; the
  auto-apply rule is the only path to a balance, and it is deterministic code. A spoofed statement must not be able
  to move a balance unless it matches a real member suffix and passes the sanity checks. The spec states this
  residual risk plainly.
- **Cost and failure.** Mail with no Anthropic key, a rate limit or a timeout stays unread with a classified code
  and is retried on the next run, with a bounded number of attempts. One bad message never blocks the rest (42c1
  REVIEW-1's lesson).
- **Tests never call Anthropic.** The reader is injected. Tests use fabricated readings and the existing fabricated
  42c1 `.eml` fixtures (ZQ42C) or new ZQ42C2 ones. There are no real member numbers or figures, and money-like test
  values live in fixtures declared fabricated, never in the spec.
- **Dates:** Postgres `CURRENT_DATE`, never a JS clock.
- **Gifts:** the new tables hold no ledger rows. Any new route is classified in the gift surface registry and
  `scripts/gifts-surface-check.mjs`.
- **Contracts:** reading storage, queue state, the overview additions, and any new route schemas. G1 with the lease.
- **Public repo:** no figures in comments or commit messages, and no real program member data.
- **Out of scope:** stays and flights (42e), transfers (42f), alerts, push and the dashboard (42g), the agent tool
  (42h), screenshot share (42d), and statement-cycle learning beyond what forwarding health needs. Also out of scope
  is 42c1's NITS N1 (an address edit racing a poll), unless the spec chooses to fold it in.

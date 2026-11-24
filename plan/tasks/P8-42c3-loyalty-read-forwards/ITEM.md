# P8-42c3 — the loyalty read: forwarded mail and what reaches the model

**Origin:** REVIEW-1 of P8-42c2 (`fda9eb9`), NITS N11, N1 and N2 in
`plan/tasks/P8-42c2-loyalty-inbox-read/NITS.md`, with the orchestrator's I-1 and I-2 results in that task's
`GATES.md` (G3). The owner asked for this task on 2026-11-23. Five-agent pipeline. No contract change expected
(G1 SKIP); if the spec finds one is needed, say why.

**Why now:** N11 keeps 42c's exit criterion ("every program that emails a balance updates within a day of that email,
untouched") from holding for anyone who forwards a statement as an attachment. N1 and N2 send personal addresses to
Anthropic, against OQ3 of P8-42c2 ("no address or routing detail leaves the machine").

## The request

1. **N11 — an attached forward is read.** Today `textForReader` (`apps/web/lib/domain/loyaltyInbox.ts`) parses only
   the outer message. For a forward whose original is an attached `message/rfc822` part, the model sees the
   forwarder's covering note and never the statement (I-1: `embeddedBody:false`), so it can never yield a balance.
   After this task, when 42c1 recovers the original from an attachment (the same rule 42c1 uses: a registered member's
   forward with a `message/rfc822` part), the model is given that original's subject and text instead of the outer
   ones, under every rule that applies to direct mail: no header of either message, links replaced, the same length
   bounds. A direct message, an inline forward and a stranger's mail with an rfc822 attachment are read exactly as
   today.
2. **N1 — no inline-forward header block reaches the model.** For an inline forward (42c1's marker plus `From:` rule),
   the forwarded header block (the `From:`, `To:`, `Cc:`, `Date:`, `Subject:` and similar lines that follow the
   marker) is removed from the text sent. The statement body after it is kept.
3. **N1 and N2 — no e-mail address reaches the model, from any part of the subject or text.** This includes a quoted
   address in a body, an address in a reply line, and a `mailto:` link rendered from HTML (I-2:
   `mailtoAddr:true`). `tel:` links and scheme-less links such as `track.brand.example/u?t=…` are replaced the same
   way URLs are today. The spec fixes the exact placeholders and the exact patterns.

## Constraints

- **A balance, a date, a member-number suffix and a program name in the body must survive the scrub unchanged.**
  Decimal and comma-grouped amounts, `1.5x`-style multipliers, dotted dates and masked numbers are the obvious
  collisions for a scheme-less-link pattern. The spec names each shape as a negative control.
- P8-42c2's decision rules, prompt fields, model, retry, lock and storage are unchanged. Its acceptance commands that
  still apply keep passing; the spec names which and re-runs them, including the pinned fixtures and the HTTP surface
  check.
- Messages already read are not re-read automatically. Re-reading stays an explicit action, as P8-42c2 set.
- No real data: fabricated `ZQ42C3` fixtures, `example.*`/`.test` domains only, and no figures in comments or commit
  messages.
- Out of scope: P8-42c2's N3–N10 and anything from 42d onward.

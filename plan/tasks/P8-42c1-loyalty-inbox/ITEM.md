# P8-42c1 — the loyalty inbox: collect forwarded mail

**Origin:** `plan/LOYALTY-ROADMAP.md` §4 A (the dedicated loyalty inbox), §6 42c, §7 guardrails, §8 (each person
forwards from their own mailbox; the second user has access, a member without a login does not, and that member's items go to the owner). The owner asked
to start 42c on 2026-11-21 after P8-42b2 (`80a23d1`) deployed. Five-agent pipeline.

**Scope split (orchestrator, 2026-11-21):** 42c is sized L, so it ships in two tasks. **This task (42c1)** collects
mail: polling, the sender allowlist, attribution to a person, raw retention, forwarding health, and the "last
statement seen" half of the coverage readout. **42c2** reads it: the Claude structured read, the auto-apply rule, the
one-tap *Needs attention* queue, and "did it carry a balance". Collecting first matches roadmap §6's order note:
forwarding can be set up as soon as the mailbox exists, and mail collected early is read when the parser lands.

## The request

1. **Poll a dedicated mailbox over IMAP**, on the daily job and on demand (a "Check inbox now" control on `/travel`).
   The connection comes from server environment variables: host, port, TLS, user and password or app password. The
   spec names them and documents them in `.env.local.example`. With them unset, the poller is disabled, says so on the
   page, and is not an error in the daily job. Each message is fetched once and is idempotent by `Message-ID` (or a
   stated fallback). The mailbox itself is never modified, except as the spec decides (e.g. marking messages seen).
2. **Keep only allowlisted senders.** Each catalog program has sender domains, seeded for the existing catalog and
   editable on `/travel` alongside the aliases. A message from a non-allowlisted sender is not stored: it is counted
   (sender domain only) so the owner can see "mail from unknown senders: N" and add a domain. Matching must resist
   look-alikes: compare the registrable domain or an exact domain/subdomain, never a substring, and say which
   header counts. Forwarding rewrites `From`, so the spec states how the original sender is recovered from a
   forwarded message (an attached `message/rfc822`, inline forward headers, or the `X-Forwarded-For` / `Delivered-To`
   / `Received` chain) and what happens when it cannot be.
3. **Attribute each message to a person.** Record which household member's mailbox it came through (the original
   recipient survives forwarding) by matching against an address list per household member. Members get
   "forwarding addresses" (their own mailbox addresses), set on `/travel`. Unattributed mail is kept but flagged.
4. **Raw mail is kept for a short, fixed time, then deleted.** Store the raw RFC 822 bytes, or the parsed parts the
   spec chooses, for a stated number of days (default suggested: 30), so 42c2 can read the backlog and re-read after a
   parser fix. Deletion happens on the daily job and is proven by a test. Nothing derived from the mail body is stored
   in this task.
5. **Forwarding health, per person.** For each member with forwarding addresses, show the last message received
   through them and flag one silent for longer than a threshold. The roadmap says "the longest statement cycle among
   their programs". Until 42c2 knows cycles, the spec chooses a stated default (e.g. 45 days) and says so.
6. **Coverage readout, first half.** On `/travel`, per program: the last message seen from its senders (date only),
   and a count over the retention window.

## Constraints

- **Privacy first.** Mail holds member numbers, names and addresses. Raw mail is never logged, never sent to a
  third party in this task (no Claude call here), never placed in an API response except through a route the spec
  justifies (default: no route returns a raw body), and it is deleted on schedule. Logs carry counts and codes only
  (P8-42a2's `code=` pattern). The IMAP password never reaches a log, a response or the page.
- **Who sees what:** both users (the owner and the second user) have full access (§8). Members without a user are
  attributed like anyone else, and their items surface to the owner.
- **Gifts:** the new tables hold no ledger rows. New pages and routes are classified in the gift surface registry and
  `scripts/gifts-surface-check.mjs`.
- **Dependencies:** an IMAP client and a MIME parser will likely be new packages. The spec names them with exact
  versions, justifies each (maintenance, no native build, licence), and keeps them server-only. `npm audit` stays
  clean.
- **Tests never touch a real mailbox.** The poller is written against a small mail-source interface. Tests use a
  fake source built from fabricated `.eml` fixtures (with the canary `ZQ42C`, no real addresses, member numbers or
  names). The spec decides whether the real IMAP adapter is also exercised against a local fake IMAP server or left
  as a thin, explicitly unverified layer for the owner's first real run.
- **Dates:** received dates as stored by the server; "today" from Postgres; no JS clock on the server path.
- **Contracts:** new tables (messages, sender domains, member forwarding addresses, unknown-sender counts, or the
  shapes the guardian decides) and contract types for the new views. G1 with the lease.
- **Public repo:** no real mailbox host, address or credential anywhere tracked. Seeded sender domains for the real
  catalog are public company domains and acceptable. No figures in comments or commit messages.
- **Out of scope (42c2):** any Claude read, balance extraction, auto-apply, the *Needs attention* queue,
  instrument or expiry parsing, statement-cycle learning. Also out of scope: Gmail OAuth (rejected, §4 A), sending
  mail, and push.

## Owner action outside the code (not a gate)

The owner creates the dedicated mailbox and sets its credentials in the server's `.env.local`. Each person then adds a
forwarding filter for loyalty senders. The page shows setup instructions; the code must work before any of this
exists.

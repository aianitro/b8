# P7-41b — gifts

**Roadmap:** ROADMAP.md §5, Phase 7, step 41b. Started 2026-10-18 at the owner's request ("start P7-41b gifts"),
through the five-agent pipeline. Builds on P7-41a (user principal, per-user push) and P7-41a2 (the second user can
now onboard).

## The request (ROADMAP §5, 41b, verbatim intent)

A user marks an upcoming purchase as a gift for the other: an amount and/or a merchant, a matching window,
optionally the account, and a reveal date. Sync matches it to the Plaid transaction before anything else reads or
notifies about that row; one candidate matches, several wait for the giver to choose, and if none has matched by
the window's end the giver is told. A matched gift is categorised to the existing gift category and, until the
reveal date, is "Gift" plus amount, date and account to the recipient on every surface — pages, API v1, chat agent,
digest, push, search, export. Its real details stay visible to the giver. Totals and P/L are unaffected by the
masking. Sync, re-keying and rules never unmask or re-categorise a gift.

Phase exit: a gift marked in advance on a linked card lands masked for the owner on every surface, with no
notification naming it, and unmasks on its reveal date.

## What the orchestrator found before dispatch (read-only)

- The "existing gift category" is most likely `Toys/Gifts/Flowers`, seeded in
  `migrations/1788271200000_category-control-mode.sql:135` as `discretionary`. The spec must pin how it is
  identified (by name is fragile: names are editable on `/categories`).
- Candidate surfaces, to be enumerated exhaustively by the spec, not trusted from this list: pages under
  `apps/web/app/*`; `app/api/v1/*` (transactions, overview, budget, sync, agent, chat, push, plaid…);
  `lib/dailyDigest.ts`, `lib/digestImage.ts`, `lib/digestRead.ts`; `lib/webPush.ts`; `lib/sync.ts`,
  `lib/plaid.ts`, `lib/plaidMatch.ts`, `lib/plaidReconcile.ts`, `lib/plaidEnrichment.ts`; rules
  (`app/api/v1/rules`, `lib/rulesGrouping.ts`); `lib/categorySuggester.ts`, `lib/domain/categorySuggest.ts`;
  `lib/transactionDetail.ts`. No dedicated export module was found by name; the spec must establish whether an
  export surface exists (CSV, the import page, screenshots/README generation) and say so.
- Re-keying (`npm run rekey:plaid-ids`, P6-40e) and the re-identification across pages (P6-40f) both rewrite
  transaction ids; a gift's link to its transaction must survive both.
- P7-41a NITS N2 (bind invitation to challenge) is unrelated and out of scope.

## Standing constraints

- **The repo is public.** No real name of either person, no real merchant from the owner's ledger, no money figure
  in any tracked file, commit or EVIDENCE.md (AGENTS.md). Fixtures are fabricated.
- **The whole point is the masking.** A single unmasked surface defeats the feature, so the spec's surface list
  must be exhaustive and each surface needs a negative control (the real merchant/description must NOT appear for
  the recipient). That includes notifications: a push or digest naming the gift before the reveal is a defect.
- **Totals are unaffected.** Masking changes what is shown, never what is summed.
- Contract surface is expected to be touched (new table(s), contracts): G1 with the lease.

## Open questions for the owner (spec-writer to sharpen; orchestrator asks at G0)

To be listed by the spec-writer, not decided by it.

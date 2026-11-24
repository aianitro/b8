# P8-42d — Nights & miles: a balance from a screenshot

**Origin:** `plan/LOYALTY-ROADMAP.md` §4 C (screenshot share, the no-typing fallback) and §6 42d; ROADMAP.md §5
Phase 8 step 42d. The owner asked for it on 2026-11-24, after P8-42c4 (`b82171c`). Five-agent pipeline. 42e is not
started and runs separately.

**42d's exit criterion:** no program needs typing to stay current. For a program whose mail never carries a balance
(42c's coverage readout shows `Balance in last statement: no` or nothing seen), the person screenshots the program's
app or site, and b8 turns it into a balance with one tap to share and one tap to confirm.

## The request

1. **Capture, on `/travel`.** Each membership offers "Update from screenshot". It reuses the receipt capture path
   (`lib/receiptUpload.ts`: shrink on the phone, re-encode as JPEG, which strips EXIF) and its size bound. The spec
   decides whether a PWA share target is in scope or deferred; if deferred, say so as a non-goal.
2. **Read with Claude, structured output, a loyalty schema.** Follow `lib/receiptReader.ts` (a proposal, never a fact;
   a JSON schema; a `clean*` pass that rejects or nulls anything malformed; never throws) and reuse P8-42c2's reading
   fields and cleaning where they fit: program as named, member-number suffix as printed, balance and unit, as-of
   date, expiry warnings, instruments. Without `ANTHROPIC_API_KEY` nothing is sent and the form is empty, as receipts.
3. **One tap to confirm.** The read pre-fills a confirm form for the membership it was started from. Confirming
   appends an observation with source `screenshot` (already allowed by the contract and the schema CHECK). Nothing is
   applied without the confirm. The form shows what disagrees with the membership (program, suffix) using P8-42c2's
   rules, and the spec decides whether a disagreement blocks the confirm or only warns.
4. **Newest by as-of still wins.** A screenshot reading older than the current observation is recorded but does not
   become current, as 42a's reducer already does; the form says so before the confirm.
5. **Needs attention asks for it.** When a membership's balance is older than its program's usual cycle and the inbox
   is not bringing balances for that program, `/travel` prompts for a screenshot. The spec fixes the rule with what the
   data has today (42c's coverage and last-seen dates); no statement-cycle learning.

## Constraints

- **The screenshot is not kept.** It carries the full member number and the member's name. It is read and discarded
  in the same request unless the spec finds a reason to keep it, in which case it uses 42c's fixed retention and says
  why. It is never logged and never in an API payload.
- **What goes to Anthropic** is the re-encoded image only, under the same rule as receipts (LOYALTY-ROADMAP §7).
  Member numbers are never in logs, push, mail, the agent's context or an API v1 payload; shown masked.
- Contract changes are expected (a read request and response shape at least); G1 runs through contract-guardian.
- Gifts: `/travel` stays `no-transaction-data`; any new route is registered and covered by the HTTP surface script.
- P8-42c's inbox, read, auto-apply and queue are unchanged. Typed edits (path D) stay available.
- No real data: fabricated `ZQ42D` programs and images, `.test`/`example.*` only, no figures in comments, fixtures,
  tests or commit messages. Test images are generated, not photographed.
- Out of scope: stays, flights and redemptions (42e), transfers (42f), alerts and digest (42g), the agent tool (42h),
  and 42c2's N3.

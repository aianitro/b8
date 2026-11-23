# P8-42c2 — accepted nits (follow-up)

From [REVIEW-1.md](REVIEW-1.md) and the orchestrator's I-1/I-2 runs at G3 (2026-11-23).

**Privacy of what reaches the model**
- **N1: an inline forward sends the household's addresses.** `textForReader` (`lib/domain/loyaltyInbox.ts`) strips
  only URLs, so the quoted `From:`/`To:` block of an inline forward, including the member's own address, goes to
  Anthropic. Its docstring claims no address leaves the machine. Fix: drop inline forward header blocks before
  sending, and add a forwarded fixture to U4/I14.
- **N2: the URL scrub misses `mailto:`, `tel:` and scheme-less links.** Confirmed by I-2:
  `{"mailtoAddr":true,"token":false}`. OQ3 says every URL becomes `[link]`.
- **N11: an attached forward is never read.** I-1: `{"embeddedBody":false,…}`. A statement forwarded as a
  `message/rfc822` attachment (a path 42c1 accepts) gives the model only the outer note, so it never yields a
  balance. Fix: read the embedded part's subject and text, with the same no-header rule, and add a fixture.

**Robustness**
- **N3: the program check fails open on a malformed stated name** (`loyaltyRead.ts:121-125`). Such a name becomes
  `not_stated` and continues to the suffix rules. Fail-closed (`program_mismatch`) would be stricter.
- **N4: a `retry` row whose bytes are purged disappears from view.** It stays `retry` and is counted in neither
  `waiting` nor `failed`. Fix: count it as failed, or close it when the bytes go.
- **N5: the response and the stored last read can disagree.** `recordState('ok')` runs before the purge; a throwing
  purge then answers `error/store_failed` while the state says `ok`.
- **N6: the panel's counts and list are read in separate statements.** A run finishing between them can break the
  `length <= total` refine. Fix: one REPEATABLE READ transaction.
- **N7: empty catches.** `.catch(() => {})` on ROLLBACK (`loyaltyInboxRead.ts:262, 541`) breaks the no-empty-catch
  rule, and `req.text().catch(() => '')` in the read route turns a failed body read into a full, paid read run.
- **N10: bytes that vanish between selection and read become a terminal `failed/empty_message`** instead of being
  left alone.

**Gate and logging**
- **N8: #13's A4.2 guard regex misses space-separated uses** (`const ANTHROPIC_API_KEY = x`,
  `{ ANTHROPIC_API_KEY }`). The panel is clean today. Orchestrator-owned: tighten it in the next spec that touches
  the panel.
- **N9: the refusal log carries `category`**, beyond the spec's list of logged fields. It is an enum and not sensitive.

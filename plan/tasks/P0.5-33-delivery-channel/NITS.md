# NITS — P0.5-33-delivery-channel
<!-- Findings real enough to record, not severe enough to block a gate. Each names who owns it. -->

Raised by adversarial-reviewer at G3 (REVIEW-1). Verdict `ACCEPT_WITH_NITS` — there is no blocking
finding. Everything below is real, reproducible by reading, and none of it is sufficient to hold the
merge.

Numbering continues the queue-wide sequence and starts at **N59**.

---

## N59 — the coverage message's fingerprint keys on a set the coverage message never mentions
**File:** `lib/domain/breachAlert.ts:308-312` (`computeFingerprint`, applied unconditionally to both kinds)
**Owner:** whoever tunes cadence after the first month of real sends — a change to the pure module and
its fixtures only, no schema, no surface (SPEC.md Rollback says so explicitly).

`computeFingerprint(kind, outlook)` folds `outlook.sayingNo`'s `(category, reason)` pairs into the
digest for **both** kinds. That is exactly what SPEC.md Q4 decided — "at most one delivered message
per `(kind, as-of month, set of categories, set of reasons)`" — and the implementation is faithful to
it. The nit is that for `kind: 'coverage'` the key ranges over information the message does not carry,
so two *byte-identical* coverage emails can be delivered in one month.

**Failure scenario.** Coverage sits below `COVERAGE_THRESHOLD` all month (the owner's measured state:
EVIDENCE.md §5 records `authoritative: false`, `coveragePercent: 0` today).

- Day 3: `sayingNo = [Dining Out (projected-breach)]`. Fingerprint `A`. Delivered. Body:
  *"Only 12% of the spend recorded so far in 2026-09 has been categorized… 1 budget line is currently
  flagged…"*
- Day 4: `Dining Out` falls back under its pace and `Travel` crosses. `sayingNo = [Travel
  (projected-breach)]`. Fingerprint `B ≠ A`, never delivered ⇒ **sent**. Body is byte-for-byte the
  same string as day 3's — same count, same rounded coverage, same subject.

The owner receives the identical message twice, and up to once more for every distinct flagged set the
month produces while coverage stays low. Q4's stated purpose — *"a guardrail that repeats itself daily
is a guardrail that gets filtered"* — is the thing this produces, arrived at from the other direction.

**Why it is a nit and not a block.** It is spec-conformant; the spec froze the key before the coverage
kind's payload was written down two questions later. It is also invisible today (`sayingNo.length` is
`0` on the owner's data, so the set is stable and empty), and it costs noise, never a wrong figure and
never a leak. The narrowest fix is one line: fold `sayingNo` into the digest only for the breach kind,
keeping `[kind, year, month]` for coverage — which makes the coverage message exactly once per month,
which is what its content deserves. F16 (the two kinds never collide) survives that change unaltered.

---

## N60 — two acceptance rows are vacuously satisfiable: `toContain('2')` is matched by `2026-09`
**File:** `lib/domain/breachAlert.test.ts:139` (#8 / F3) and `:183` (#11 / F4)
**Owner:** the implementer, under the same authorisation route A12's two added tests took; or recorded
and left, since the behaviour is present and correct.

Both fixtures assert the count by `expect(surface).toContain('2')`. Both surfaces also contain the
rendered month `2026-09`, whose year supplies a literal `2`. The assertion therefore cannot fail, and
the property it names — *the count survives* — is ungated on both surfaces.

**Concrete surviving mutation.** Delete the entire second paragraph of `coverageMessage`'s body
(`lib/domain/breachAlert.ts:263`) — the sentence carrying `${count} ${noun} currently flagged` and the
withholding rationale. The body becomes the coverage sentence, blank lines, and the route back. F4's
remaining assertions are `toContain('7%')` ✓ (line 1), `toContain('2')` ✓ (from `2026-09`),
`toContain('open the app')` ✓, and every `not.toContain` still holds — **suite green**. The same
mutation applied to `breachMessage`'s subject count leaves #8 green for the same reason.

This is the class A12 credits the implementer for finding twice; these two escaped the sweep because
the sweep targeted guards, not payload fields. Closing it costs one line per suite: assert the count
against a string that cannot be the year — `toContain('1 budget line is')` / `toContain('2 budget
lines are')`, or `toMatch(/\b2 budget lines are currently flagged\b/)`.

---

## N61 — a renderer refusal writes no `alert_sends` row, and the docblock says it does
**File:** `lib/domain/breachAlert.ts:119` (the `finite()` docblock) against `lib/breachAlert.ts:82,106`
**Owner:** the implementer or the next step to touch the shell. Comment fix at minimum; the behaviour
change is Phase 5 step 39's business.

`finite()`'s docblock states the design intent as *"the honest failure is to refuse to render at all
and **let the shell record the attempt as failed**."* The shell does not do that. `planAlert` is
called at `lib/breachAlert.ts:82`, outside and above `attempt()`, so a `RangeError` from any of the
six `finite()` call sites unwinds straight to `runBreachAlert`'s outer `catch` at `:106`, is logged,
and **no row is written**.

**Failure scenario.** A `NUMERIC` column starts arriving unconverted (`db.query<T>()` is an unchecked
cast — the exact hazard the guard was written for), so `Number.isFinite('284')` is `false` every day.
`alert_sends` stays empty for three weeks. SPEC.md Q5's whole promise is that this state is now
legible: *"'nothing in `alert_sends` for three weeks' means the job did not run"*. Here the job ran
every day, refused every day, and the table says it never ran. The two failures Q5 exists to separate
are merged again, for this one cause.

The detail *is* in the log (`breach alert failed`, with the `RangeError`'s text), which is why this is
a nit rather than a finding: the diagnostic survives, one channel over. Either the comment should stop
claiming a shell behaviour that does not exist, or `planAlert` should be called inside a path that can
record a `config`-class failure — and the second is a change to the shell that no test can cover, so
the comment fix is the cheaper honest option.

---

## N62 — a delivered message whose `record()` INSERT fails re-sends tomorrow
**File:** `lib/breachAlert.ts:161`
**Owner:** nobody yet; recorded so the first duplicate is diagnosed in one step instead of three.

`await record(message, true, null)` runs after `sendMail` resolves. If that INSERT throws — the
database went away between the two awaits, or the connection pool is exhausted — the outer catch logs
`breach alert failed` and the send is unrecorded. Tomorrow's run recomputes the same fingerprint, finds
no delivered row, and sends the same message again.

Bounded (one duplicate per occurrence, self-correcting on the next successful INSERT) and preferable to
the alternative ordering, which would record a delivery that never happened and silence the guardrail
permanently — the failure Q4/Q5 rank as the worse one. Recorded only so that a duplicate arriving
alongside a `breach alert failed` log line is read as this and not as a fingerprint defect.

---

## N63 — a category name reaches `lib/logger.ts` on the refusal path
**File:** `lib/domain/breachAlert.ts:129` → `lib/breachAlert.ts:110`
**Owner:** the owner, as an awareness note; no code change proposed.

The `RangeError` names the category deliberately (*"a rejection that does not say WHICH line was
unrenderable sends an operator to read the whole outlook by hand"* — and that reasoning is right). Its
message then reaches `log.error('breach alert failed', { error: err.message })`, so a scheduler log
line can read `breachAlert: Dining Out has a non-finite actual…`.

This is inside the design — SPEC.md Q5 routes detail to the log precisely so the *table* need not carry
it, `DECISION.md` allows category names to leave the process entirely, and no figure accompanies the
name. It is noted because it is the first time a category name appears in a `lib/scheduler` log line,
and BUILD.md §5.4's "real financial data never leaves into logs" is the rule those lines get pasted
under. The `alert_sends` row remains clean either way, which is the property that was engineered.

---

## N64 — `money` and `pct` now exist in two files, and a third copy changes the answer
**File:** `lib/domain/breachAlert.ts:77,94` beside `app/dashboard/page.tsx:41,45`
**Owner:** the next step that needs a currency or percentage helper. SPEC.md Q7 defers this here by
name — *"extracting them to a shared formatter is a `NITS.md` follow-up on the formatting surface, not
this step's business"* — so this row exists to make that deferral findable.

Verified identical today: both are `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
minimumFractionDigits: 2 })` and both are `Math.round(fraction * 100)`. Cross-surface agreement is
pinned by fixture (F9, F10), not by structure. A third copy — Phase 3 step 25 or Phase 5 step 38, both
of which import this step's allowlist — is the point at which the shared formatter stops being a
preference.

---

## N65 — `NODE_TLS_REJECT_UNAUTHORIZED=0` defeats the guarantee `SMTP_TLS_REJECT_UNAUTHORIZED` refuses
**File:** `lib/mailConfig.ts:133-138`
**Owner:** nobody; out of this spec's scope, recorded for completeness of the TLS story.

The parser correctly refuses an explicit opt-out through its own key, and correctly declines to pass
any `tls` object to `createTransport` so nodemailer's default `rejectUnauthorized: true` stands. Node's
process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` overrides that default globally and nothing in this step
observes it. It is a whole-process footgun rather than a mail-configuration one, it is not named in
SPEC.md's TLS rules, and checking it here would be a rule about Node in a file about SMTP — but the
step's claim is "TLS is mandatory", and this is the one env var that makes that claim false without
touching any key the parser reads.

---

## N66 — every breach message is recorded as `kind = 'projected-breach'`, including one about a line already over
**File:** `lib/domain/breachAlert.ts:218`; migration `1788505200000_alert-sends.sql:71`
**Owner:** cosmetic; fold into any later widening of the `kind` CHECK.

`breachMessage` hard-codes `kind: 'projected-breach'` whatever reasons the set holds, and SPEC.md F1
pins that (fixture `O` contains a `breach` and an `off-cycle` is possible too). The migration's comment
glosses the value as *"one or more budget lines are on course to overrun before the month ends"*, which
is not what a `breach` or `off-cycle` record says. The value is a **message** kind and the two-value
CHECK is correct as a partition of *message* kinds; only the comment over-reads it. Worth one word when
Phase 3 step 25 or Phase 5 step 38 widens the list.

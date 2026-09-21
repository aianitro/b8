# DECISION — P3-25 push notifications: destination and payload

**Type:** `BUILD.md` §5.1 human escalation. `ROADMAP.md` §5's outbound carve-out requires one **every
time the destination changes**, and `plan/tasks/P0.5-33-delivery-channel/DECISION.md` says so in as
many words: *"Not a second destination. This decision covers one provider, chosen once."*

**Decided by:** the owner, 2026-09-21, on an escalation raised before any code was written.

## Why push is not covered by step 33's decision

Step 33 authorised **one** transport — a hosted mail provider — carrying category names, figures and
(after the 09-14 amendment) transaction-level detail. Push differs in three ways that decision never
considered:

| | email | push |
|---|---|---|
| intermediaries | one mail provider | **Expo's servers, then Apple's APNs** |
| where it lands | an inbox behind a login | a **lock screen**, readable without unlocking |
| who can read it | the account holder | anyone holding the phone |

The lock-screen property is the new one. An email allowlist reasons about who holds data at rest; a
notification body is visible to whoever picks up the phone on a table.

## The decision: option C — a content-free ping

Four options were presented with their costs on them:

- **A. Full content** — *"Dining Out is $37 over"*. Step 33's allowlist, extended to two more
  intermediaries and a lock screen.
- **B. Category only** — *"Dining Out needs attention"*. A category name leaves the machine.
- **C. Content-free ping** — *"b8 has something for you"*. **CHOSEN.**
- **D. Do not build it.** The app stays pull-only.

**What leaves the machine under C: nothing but the fact that something happened.** No category, no
figure, no merchant, no balance. The real content is fetched by the app from the owner's own server
over the tailnet, where it already lives.

## The reasoning the owner accepted

**The value of push is the interrupt, not the text.** A guardrail you have to remember to open is not
a guardrail — that is the whole argument for step 25. A ping that makes you open the app delivers
that, and the figures still travel only over the tailnet.

It also preserves the property that makes this system unusual and which step 33 spent deliberately
and exactly once: **no financial figure leaves this machine except through one recorded exception.**
C does not spend it again.

**The cost, stated before deciding:** the owner will not know *why* it pinged without opening the
app. For a phone in a pocket, that is a couple of seconds, and it was accepted as such.

## What this decision does NOT authorise

- **No payload growth without a new escalation.** Adding a category name to the notification body is
  a change of what leaves the machine, not a wording tweak. It re-triggers §5.1.
- **Not a second destination.** This covers Expo Push only. The same sentence step 33 wrote applies
  here for the same reason.
- **No push token in a log.** An Expo push token addresses a device; it is a credential-shaped
  string and is treated like one.
- **Not a replacement for the digest.** The email decided at step 33 is unchanged and still carries
  the content. Push is a second TRANSPORT for the SAME decision to notify — `alert_sends.kind` is
  already commented in `db/schema.sql` as "the *message* kind, not the transport", which is exactly
  this distinction, written down before it was needed.

## Consequences the implementation must carry

- **Suppression is inherited, not reinvented.** A ping is sent only when the daily job actually
  delivered something. "Not news twice" is already decided in `lib/domain/breachAlert.ts` and
  recorded in `alert_sends`; a second, independent notion of newsworthiness would be a second
  definition of the same thing.
- **A failed ping must not cost the digest.** Same shape as the mail rule in `lib/scheduler.ts`: the
  transport is the least important thing in the job.
- **Registration is the phone's, revocation is the server's.** A lost phone must be one `UPDATE`,
  like `auth_sessions`.

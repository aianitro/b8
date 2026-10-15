# P7-41a — a second user

**Roadmap:** ROADMAP.md §5, Phase 7, step 41a. Added 2026-10-14 at the owner's request, delivered
through the five-agent pipeline at the owner's request.

## The request

The owner is onboarding a second person in the household. Decided with the owner in chat on
2026-10-14:

- **Full peer.** The second user sees and edits everything the owner does. The only asymmetry the
  app will ever have between them is gifts (P7-41b), which this step does not build.
- **Their own passkey on their own device**, enrolled from an invitation the owner creates while signed
  in. Not a shared passkey, and not a password.
- The next step, P7-41b, hides a gift's details from its recipient on every surface. That is only
  possible if every request knows WHICH user is asking, and if a push notification reaches only its
  own user's devices. Those two properties are this step's real load, not the sign-in screen.

## What the orchestrator found before dispatch (read-only)

- `apps/web/lib/authSession.ts:72` calls the schema single-principal: the bootstrap gate is a global
  credential count, and a personal token is attached to the most recently enrolled passkey
  (`authSession.ts:243`). Nothing maps a credential to a person.
- `auth_sessions` has `credential_id`, `kind` (browser | device | personal), `scope`; there is no
  user column anywhere. `device_handoffs` exists (migration `1790046696178_device-handoff.sql`).
- ROADMAP §3 reserved an actor column on `mutation_audit_log` "for when multi-user lands".

## Standing constraints

- **The repo is public.** The second user's name must not appear in any tracked file — spec,
  contract, code, tests, fixtures, seed, commit messages. Say "second user" or "the owner".
- **No money figures** in commit messages, comments or tracked files (AGENTS.md).
- Existing sign-in, device tokens and personal tokens must keep working for the owner across the
  migration with no re-enrolment.

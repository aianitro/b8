# P7-41a2 — onboarding in the browser

**Roadmap:** ROADMAP.md §5, Phase 7, step 41a-2. Added 2026-10-15 at the owner's request ("yes, go ahead"),
through the five-agent pipeline.

## Why this step exists

P7-41a merged (`242ba1f`) with the invitation endpoint (`POST /api/v1/auth/invitations`) and redemption via the
`X-Invitation-Code` header on `register/options` and `register/verify`, all tested at the API. But no screen calls
either: there is no control for the owner to create an invitation, and `apps/web/app/login/page.tsx` never sends
the header. The second user cannot onboard. P7-41a's spec excluded an "invitation list/management UI", and nobody
at G0 noticed that the two screens onboarding needs were excluded with it. That miss was the orchestrator's.

## Decided with the owner

- The owner creates an invitation in the app and gets a link to hand over; the second user opens it on their own
  device and enrols a passkey; afterwards they are signed in as themselves.
- Owner-only, as in 41a. Still no list/management of invitations, no email delivery.

## Constraints

- **UI only, no contract change** expected: the endpoints and schemas exist (`packages/contracts/auth.ts`:
  `InvitationCreateRequestSchema`, `InvitationCreatedSchema`, `invitationCode`).
- The code is a secret for up to seven days: it must not be logged, persisted client-side beyond the
  ceremony, or sent to a third party (e.g. a referrer).
- Public repo: the second user's name appears in no tracked file. No money figures.
- 41a's follow-ups (NITS.md, e.g. N2 binding the code to the challenge) are not in scope unless the spec finds the
  UI cannot work without one.

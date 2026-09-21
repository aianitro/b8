# @b8/mobile — placeholder

Empty on purpose. `ROADMAP.md` §5 Phase 3 step 23 puts an Expo app here.

It exists so the workspace shape is **real rather than promised**: `packages/contracts` is only
meaningfully shared if something other than the web app depends on it, and the dependency declared
in this `package.json` is what makes the contracts a package instead of a folder.

What it will be, per step 23: Expo + TypeScript, TanStack Query, `expo-secure-store`, native
passkeys, importing `@b8/contracts`. The four screens are in step 24, rewritten 2026-09-21 under
the adherence framing — the lead screen answers *"can I spend this?"*, not *"what is my net worth"*.

Already built and waiting for it:
- `/api/v1/**` — the client seam (Phase 1)
- `/api/v1/overview` — one round trip for the whole Overview screen
- **device sessions** — 30-day sliding bearer tokens minted from the passkey ceremony
  (`apps/web/lib/authSession.ts`), built for this client before it existed
- HTTPS over Tailscale, with a real passkey sign-in from an iPhone proven 2026-09-17

# @b8/mobile — the guardrail in your pocket

`ROADMAP.md` §5 Phase 3. Expo SDK 57, React Native 0.86, TypeScript, TanStack Query,
`expo-secure-store`, importing `@b8/contracts`.

**Phase 3's hard gate was dropped on 2026-09-21** — deliberately, with the reasoning recorded in
`ROADMAP.md`. It was never a technical dependency: everything screen 1 needs already ships in one
payload, and `/api/v1/overview` exists to serve two clients while serving one.

## What exists

**Screen 1 of four: "Can I spend?"** — the question the app opens on. Renders `monthOutlook`'s
discretionary verdict, and renders `authoritative` and the freshness caveat *beside* it rather than
under a tap. That is not decoration: `monthOutlook.state` has seven values and `nothing-to-score`
is not `on-track`, so a guardrail that says "you have room" over a feed that stopped importing has
turned missing data into permission to spend.

Not built yet: screens 2–4 (did that land right / chat / quick entry), and **native passkey
enrolment**. Today the app expects a device token to already be in the keychain.

## Running it

```sh
export EXPO_PUBLIC_B8_BASE_URL='https://<machine>.tail368cae.ts.net'
npm run start -w @b8/mobile      # then scan the QR with Expo Go, or press i for a simulator
npm run typecheck -w @b8/mobile
```

**HTTPS, not an IP.** Passkeys require a secure context, so `http://100.x.y.z:3000` cannot complete
a WebAuthn ceremony — the same constraint `apps/web/lib/webauthnOrigins.ts` enforces server-side.

**The device token.** `P1-12a` issues these as 30-day sliding sessions from the passkey ceremony, so
an app in daily use never signs out and a lost phone is one `UPDATE`. Until enrolment is wired,
mint one over SSH and put it in the keychain by hand:

```sh
npm run tokens -- create "iphone" --days 30
```

## Three things that are load-bearing and easy to break

**`metro.config.js`** teaches Metro about the monorepo — `watchFolders` at the workspace root and
`nodeModulesPaths` local-first. Without it `@b8/contracts` is unresolvable **at runtime** even when
TypeScript is happy, and the failure arrives as a red screen on the device rather than an error in
CI. Local-first matters because Expo pins React 19.2.3 while `apps/web` is on 19.2.4; the phone must
get the versions Expo tested against.

**Its own tsconfig**, not the repo base: Expo SDK 57 pins TypeScript ~6 against the web's ^5, and
this package resolves `react-native` types the web app must never see.

**Excluded from the root eslint**, because `metro.config.js` must be CommonJS and
`eslint-config-next` asserts the wrong rules about the wrong runtime.

## Every response is parsed, never cast

`lib/api.ts` runs the shared zod schema over the payload. This is the whole reason
`packages/contracts` exists — and it earned it on the first screen: the verdict component read
`jobHealth.healthy`, the schema said the field is `status: 'never' | 'fresh' | 'late' | 'missed'`,
and the typecheck refused it before a device ever ran the code.

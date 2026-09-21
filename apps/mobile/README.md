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

**`metro.config.js`** teaches Metro about the monorepo. **Corrected 2026-09-21:** an earlier
version of this README said that without it `@b8/contracts` is unresolvable at runtime. That was
asserted without testing and is false — npm workspaces symlinks `node_modules/@b8/contracts` and
Metro follows it, so a gutted config still bundles. What it actually buys is `watchFolders`, so an
edit to `packages/contracts` reloads the app, and which also moves Metro's server root to the
workspace root (hence the bundle URL below). `nodeModulesPaths` local-first states an order npm's
layout already produces — verified: `require.resolve('react')` from here finds Expo's nested 19.2.3
while `apps/web` gets the hoisted 19.2.4.

**Its own tsconfig**, not the repo base: Expo SDK 57 pins TypeScript ~6 against the web's ^5, and
this package resolves `react-native` types the web app must never see.

**Excluded from the root eslint**, because `metro.config.js` must be CommonJS and
`eslint-config-next` asserts the wrong rules about the wrong runtime.

## Smoke-testing the bundle without a device

```sh
npm run smoke -w @b8/mobile            # ios
npm run smoke:android -w @b8/mobile
```

Starts Metro, asks it for a real bundle over HTTP, and asserts both a 200 **and** that the bundle
carries a symbol that could only come from `packages/contracts`. That second assertion is the
point: a bundle built without the shared package would still be a valid 200.

**It catches** a cross-package import Metro cannot resolve — proven by pointing `lib/api.ts` at
`@b8/contracts/no-such-module` and watching it exit non-zero. **It does not catch** a broken
`metro.config.js`, for the reason above. No device, no simulator, no Xcode.

## Every response is parsed, never cast

`lib/api.ts` runs the shared zod schema over the payload. This is the whole reason
`packages/contracts` exists — and it earned it on the first screen: the verdict component read
`jobHealth.healthy`, the schema said the field is `status: 'never' | 'fresh' | 'late' | 'missed'`,
and the typecheck refused it before a device ever ran the code.

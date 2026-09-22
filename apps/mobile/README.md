# @b8/mobile — the guardrail in your pocket

`ROADMAP.md` §5 Phase 3. Expo SDK 57, React Native 0.86, TypeScript, TanStack Query,
`expo-secure-store`, importing `@b8/contracts`.

**Phase 3's hard gate was dropped on 2026-09-21** — deliberately, with the reasoning recorded in
`ROADMAP.md`. It was never a technical dependency: everything screen 1 needs already ships in one
payload, and `/api/v1/overview` exists to serve two clients while serving one.

## What exists

**Screen 1: "Can I spend?"** — the question the app opens on. Renders `monthOutlook`'s
discretionary verdict, with `authoritative` and the freshness caveat *beside* it rather than under a
tap. That is not decoration: `monthOutlook.state` has seven values and `nothing-to-score` is not
`on-track`, so a guardrail that says "you have room" over a feed that stopped importing has turned
missing data into permission to spend.

Below the verdict, two sections — **Stop spending here** and **Room left** — worst first in each,
and the big number is **what is left**, because that is the figure a person in a shop needs.
`spentRatio` is deliberately never rendered: the contract's own note warns it means three
incomparable things across the six statuses, so one column would print "250% of December" above
"71% of April". Money subtracts the same way in every status. The first version merged both sections
into one flat list, and it took the owner reading it on a phone to see that the verdict then left
you to work out *which* category was the problem.

**Screen 2: "Did that land right?"** — `watchlist` and `recentArrivals`, with uncategorised charges
flagged amber. Tap a row for a category picker; tapping a category writes it and invalidates the
overview, so screen 1's verdict cannot disagree with it. **This is a direct write, not a proposal** —
the propose/confirm gate exists to stop the MODEL acting on its own, and the owner tapping a
category on their own phone is the authority that gate defers to. Routing a human decision through a
confirmation is ceremony, and ceremony teaches people to tap without reading.

Navigation is two hand-rolled tabs, not react-navigation: two screens with no stack, no params and
no deep links do not justify a navigator and its peer dependencies. When screen 3 or 4 needs a
stack, that is the moment.

**Pings (step 25)** — a card at the bottom of screen 1 turns them on. What arrives is
`"b8 — Something needs you. Open to see."` and **nothing else**: no category, no figure, no
merchant. That is the owner's recorded decision (`plan/tasks/P3-25-push-ping/DECISION.md`), because
push travels through Expo and Apple rather than one provider and lands on a lock screen readable
without unlocking the phone. The figures still arrive only over the tailnet.

Permission is asked from a button, never on launch: iOS asks once and remembers forever, and a
denial cannot be re-asked from inside the app. `npm run ping:test` on the server sends one real ping
using the same constant the daily job sends.

Two things that bit on the way in, so they do not bite twice: `getExpoPushTokenAsync` has needed an
**EAS project ID** since SDK 49 and Expo Go no longer infers one — `eas init` wrote it into
`app.json` and `lib/push.ts` reads it explicitly. And **Metro must be running on the laptop** for the
app to load at all in Expo Go; "could not connect to the server" on the phone usually means the dev
server is down, not the API.

Not built yet: screens 3–4 (chat / quick entry) and **native passkey enrolment** — the app expects a device token in the keychain, which `PasteToken.tsx` exists to put
there until enrolment lands.

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

# @b8/mobile — the guardrail in your pocket

`ROADMAP.md` §5 Phase 3. Expo SDK 57, React Native 0.86, TypeScript, TanStack Query,
`expo-secure-store`, importing `@b8/contracts`.

**Phase 3's hard gate was dropped on 2026-09-21** — deliberately, with the reasoning recorded in
`ROADMAP.md`. It was never a technical dependency: everything the dashboard needs already ships in one
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
overview, so the dashboard's figures cannot disagree with it. **This is a direct write, not a proposal** —
the propose/confirm gate exists to stop the MODEL acting on its own, and the owner tapping a
category on their own phone is the authority that gate defers to. Routing a human decision through a
confirmation is ceremony, and ceremony teaches people to tap without reading.

Navigation is two hand-rolled tabs, not react-navigation: two screens with no stack, no params and
no deep links do not justify a navigator and its peer dependencies. When screen 3 or 4 needs a
stack, that is the moment.

**Pings (step 25)** — a card at the foot of the Dashboard tab turns them on. What arrives is
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

**Screen: "Dashboard"** — the web dashboard at phone width, added 2026-09-21 and renamed from
"Month" on 2026-09-22 (the old name described the time range rather than the thing). It is the tab
the app opens on since "Spend?" was removed. A masthead carrying the mark and the date, two alert
strips, four KPIs, the category heatmap, the money-in/money-out chart with its figures, off-cycle
categories, the year by category, and — at the very foot — ping setup and the device card, which
are settings rather than reading and came off the removed screen.

**Every widget is fed by `/api/v1/overview`** — no new endpoint, which is what that payload was
built for. The one exception is the heatmap's drill-down, which reads `/api/v1/transactions`.

Two things the web shows and this does not, both deliberate and both the owner's call: **"Today" and
"This week"**, and the **ledger-drift strip**. The drift finding is still computed and still in the
payload; a drifting balance is a slow data-quality problem acted on at a laptop with the account
open, and a strip that sits for days where it cannot be resolved is the kind people learn to scroll
past — which costs the two alerts above it, not just itself.

Three departures from the web, each for a reason: alerts are **flat rather than behind a bell** (a
bell on a phone is a tap to discover whether anything is wrong, and the web hides them only because
its header is wide); KPIs are **two per row, not three** (at 400px three columns truncate a five-figure amount
and turn a figure into a guess); and it was **a separate tab rather than more of the "Spend?" screen**, because that screen
answered "can I spend?" in two seconds and a chart there would have cost the thing it existed for.
That screen was removed on 2026-09-22 and the Dashboard is now the tab the app opens on.

**The chart carries two reliefs the palette depends on.** `dataviz`'s `validate_palette.js` rates
money-in green against money-out orange at ΔE 6.2 for deuteranopia — inside the 6–8 floor band,
legal ONLY with secondary encoding — and both below 3:1 against the surface, which obligates visible
labels or a table view. So money in is drawn **above** the zero line and out **below** it (position
carries identity with no colour vision at all), and the figures list beneath the plot is the table
view. Neither is decoration; see `widgets/tokens.ts`.

**Screen: "Budget"** — the web's coloured grid, as a grid: a **frozen category column** with twelve
month columns scrolling under it, each cell showing actual over plan and **graded by the same
thresholds the web uses**.

**A design call was made here and it was wrong**, and the record is kept rather than quietly
replaced. The first version showed one category at a time with its twelve months down the page,
arguing that twelve columns at 400px give 30px each and that horizontal scrolling hides most of a
page behind a gesture. Both facts are true; the conclusion was not. **A grid's value is reading
across a row AND down a column**, and a single-category view destroys the second entirely — you
cannot see that three categories all went red in June. Colour is what makes a 58px cell work, and
dropping it was the mistake.

The one-category view survives below the grid as a second section: "how is Dining Out doing" is
still worth answering without arithmetic.

**The grading is shared, the paint is not.** `apps/web/lib/budgetColors.ts` had the thresholds welded
to Tailwind class names, which do not exist in React Native. The rule now lives in
`@b8/contracts/budgetCellState` and both clients call it; the web maps its answers to Tailwind and
the phone to hex (`widgets/cellColors.ts`). So the two cannot disagree about what "over budget"
means — only about what colour to paint it.

Two correctness rules carried over from the web's grid client: a **future month has no variance**
(printing one invents a finding), and **over-plan is bad for an expense while under-plan is bad for
income** — one colour rule for both is how an income row ends up painted red for earning well.

**Screen 3: "Ask"** — chat over the real data, with **native confirmation cards** for anything the
agent proposes. The cards sit OUTSIDE the message bubble deliberately: everything inside one is the
model talking, and a control that changes the ledger should not look like part of a sentence the
model wrote. The gate is step 16's — the agent proposes, only a full-scope session applies, and the
model has no tool for the decide endpoint. Rate limits surface the server's own wording, which
already distinguishes a bucket that clears in seconds from the daily ceiling.

**Screen 4: "Enter"** — properties and valuation-mode accounts with their latest value; tap to
record a new one. It filters to `valuation_mode = 'valuation'` because a ledger account's balance is
derived from its transactions, so a hand-typed number there would be silently overwritten by the
next sync — offering the entry would be offering a change that does not stick. Saving **appends** a
valuation row rather than editing a balance, so what was believed and when survives; that history is
what the net-worth trend reads, and it makes a typo correctable by entering the right number instead
of editing the past.

Screen 4 needed a new endpoint: neither `accounts` nor `properties` had a GET, because the web pages
are server components reading the database directly — invisible until a second client wants the same
data, which is what P1-11a meant by "the drift an endpoint nothing reads is exposed to".
`/api/v1/quick-entry` returns both lists in one round trip, with a contract narrowed to the fields
this screen renders rather than the whole rows.

**Linking this phone with a passkey.** The "This phone" card at the foot of the Dashboard offers
**Link with passkey**: Safari opens inside the tailnet, the passkey ceremony runs, and the app comes
back with a **30-day sliding device session**. Nothing typed, nothing pasted, and a lost phone is one
`UPDATE` on the server. Pasting an SSH-minted token is kept as a collapsed fallback, not deleted.

**Why it goes through a browser rather than a native ceremony**, since that looks like a detour:
iOS passkeys are domain-bound, and Apple validates an app's associated domain by fetching
`/.well-known/apple-app-site-association` **through its own CDN** — which cannot reach a tailnet-only
host. Safari, already inside the tailnet, has no such problem. And the server deliberately refuses to
hand a device token to a browser (`mayIssueDeviceToken` checks for absent `Sec-Fetch-*` headers), so
the browser earns a **single-use code, dead in 60 seconds**, and the app exchanges it from outside a
browser where it is permitted. That is the OAuth authorization-code shape for the OAuth reason: a
bearer token in a redirect URL ends up in history; a code worthless once spent does not. The redirect
target is scheme-allowlisted (`b8://`, `exp://`) because an open redirect carrying a secret is the
OAuth vulnerability.

Not built yet: **step 26 (a standalone build)**, which is what would free the app from needing Metro
running on the laptop — and which needs either an Apple Developer account or Xcode. Native passkey
enrolment is **not** planned: the associated-domain requirement above makes it unreachable while the
server is tailnet-only, and the browser handoff gets the same credential without it. — the app expects a device token in the keychain, which `PasteToken.tsx` exists to put
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

# P7-41a2-browser-onboarding — implementer evidence

Captured 2026-10-18 in the main tree (no worktree), by the implementer, from the repo root. Commands
#4–#8 were run under `bash` (not zsh) from script files holding the spec's text verbatim. Nothing
here carries an invitation code, a code hash, a real name or a money figure: observations are
lengths, counts and booleans, and the browser check redacts any code it knows before printing.

## Surface changed

New:
- `apps/web/lib/invitationLink.ts` — link builder, header builder (absent, never empty), fragment
  scrub, owner-visibility decision, structural check of the create response. No `zod` import, so the
  sidebar can use it.
- `apps/web/lib/invitationFragment.ts` — the fragment reader (none / invalid / invitation), validated
  by the contract's `invitationCode`. Imported only by the login page. Split from
  `invitationLink.ts` for exactly that reason: the contract import would otherwise pull the
  validation library into the shell bundle through the sidebar.
- `apps/web/lib/passkeyCeremony.ts` — the ceremony sequence extracted from `app/login/page.tsx`,
  with `fetch` and both authenticator functions as parameters. The page imports and calls it; the
  old inline copy is gone.
- `apps/web/components/InviteControl.tsx` — the owner's control and one-time panel.
- `apps/web/lib/invitationLink.test.ts` (U1–U7), `apps/web/lib/passkeyCeremony.test.ts` (C1–C7),
  `apps/web/app/api/v1/auth/invitations/onboarding.test.ts` (I1–I6, using `secondUserTestKit.ts`
  unchanged), `apps/web/scripts/onboarding-browser-check.mjs` (B1–B9).

Modified:
- `apps/web/app/login/page.tsx` — invitation mode and unreadable-link refusal; the ordinary branch
  keeps the same two buttons, the same text and the same classes.
- `apps/web/components/Sidebar.tsx` — renders `InviteControl` (owner only, keyed by pathname) above
  the "Signed in as" line in both the desktop sidebar and the phone drawer. `useSignedInUser` and
  `SignedInAs` are untouched.
- `apps/web/next.config.ts` — `headers()` adds `Referrer-Policy: no-referrer` on `/login`.

Not touched: anything under `apps/web/app/api/v1/` other than the new test file,
`secondUserTestKit.ts`, `lib/authSession.ts`, `lib/invitations.ts`, `lib/registrationGate.ts`,
`lib/users.ts`, `packages/`, `migrations/`, `db/`. `AGENTS.md` did not come back dirty from the
dev server runs. `plan/QUEUE.md` was already modified before this task started and was not edited
by the implementer.

Palette: the control renders on the sidebar's cyan-700 brand ground, so it follows `Sidebar.tsx`
(white and cyan-100 inks, white washes) rather than the app's slate; the login page additions are
slate, as the rest of that file is. Noted per the brief: the two differ because the two files do.

## Acceptance commands

### #1 `(cd apps/web && npx tsc --noEmit; echo "exit=$?")`
```
exit=0
```

### #2 `npm run lint; echo "exit=$?"`
Baseline (G0): 0 errors, 5 warnings. Now: 0 errors, 5 warnings — the same five. The
`no-location-assign-relative-destination` warning on `app/login/page.tsx` is the pre-existing
`window.location.assign(AFTER_SIGN_IN)` line (unchanged, at a new line number).
```

> b8@0.1.0 lint
> eslint

Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.

/Users/andreianpilogov/Documents/b8/app/apps/web/app/login/page.tsx
  112:7  warning  Do not use `window.location.assign()` to navigate to internal Next.js pages. Use `redirect()` in the render phase, or `useRouter().push()` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination  @next/next/no-location-assign-relative-destination

/Users/andreianpilogov/Documents/b8/app/apps/web/lib/domain/digest.ts
  202:7  warning  'GREEN_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  204:7  warning  'RED_SOFT' is assigned a value but never used. Allowed unused vars must match /^_/u    @typescript-eslint/no-unused-vars

/Users/andreianpilogov/Documents/b8/app/apps/web/public/sw.js
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'no-restricted-globals')

/Users/andreianpilogov/Documents/b8/app/apps/web/scripts/seed-demo.mjs
  457:17  warning  'pid' is assigned a value but never used. Allowed unused elements of array destructuring must match /^_/u  @typescript-eslint/no-unused-vars

✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```

### #3 `npm test 2>&1 | tail -8`
BASE 83 files / 1190 tests. Now 85 files (+2) / 1204 tests (+14), 0 failed.
```
 Test Files  85 passed (85)
      Tests  1204 passed (1204)
   Start at  20:51:41
   Duration  5.60s (tests 57%, import 22%, transform 18%, worker 3%)

    Isolate  85 workers spawned · ~139ms startup each (spawn + environment, per file)
             at least ~1.55s faster with isolate: false — reuses workers across files instead of one per file
```

### #4 unit scenarios
```
OK 14 scenarios U1-U7 C1-C7 each present once and passed
exit=0
```

### #5 integration scenarios (whole integration config)
```
OK 195 tests, I1-I6 each present once and passed
exit=0
```

### #6 the #5 integration command, without the checker, twice in a row
Failing titles listed by a small JSON reader over the same vitest output; both runs identical, both
titles in KNOWN (the two H4 tests). RC-03 passed both times.
```
--- run 1
run total=195 passed=193 failed=2
FAILED: the pre-auth ceremony endpoints remain reachable with no session cookie at all
FAILED: the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
exit=0
--- run 2
run total=195 passed=193 failed=2
FAILED: the pre-auth ceremony endpoints remain reachable with no session cookie at all
FAILED: the response validates end to end against apiResponseSchema(OverviewDataSchema) for a fabricated portfolio
exit=0
```

### #7 static discipline greps
```
exit=0
```
(no output; `exit=0`)

### #8 server-untouched guard
```
exit=1
```
(no output; `exit=1` is grep's status on empty input, which the spec says is expected)

### #9 `node apps/web/scripts/onboarding-browser-check.mjs; echo "exit=$?"`
```
B1 PASS owner minted at 1440px and 390px (drawer); link path=/login search='' hash length=30/30; expiresAt shown matches server; submit disabled in flight, one request per double click; after Done the code is in neither the DOM nor localStorage/sessionStorage/document.cookie
B2 PASS location.hash at load complete '', href free of the code true; after hydration hash '' and href free of the code; landed on /dashboard; me displayName=Test User Two isOwner=false; sidebar shows the name; users 1->2, invitee is_owner=f with 1 credential; 3 history entries free of the code; Back free of the code
B3 PASS 84 requests from profile B: none carries the code in its URL; 53 Referer headers, none with the code; x-invitation-code only on register/options and register/verify; 0 requests to an origin other than http://localhost:3000; storage and cookies free of the code; dev-server output grep -c = 0
B4 PASS consumed link refused with a visible message (107 characters); virtual authenticator holds 0 credentials; users 2->2
B5 PASS malformed link refused with a visible message (55 characters) and 0 requests to register/options
B6 PASS owner opening a fresh link while signed in: refused (107 characters); owner credentials 1->1; users 2->2; invitation still unconsumed
B7 PASS ordinary /login: both buttons and both explanatory lines present, no invitation UI; "Register this device" got 403 REGISTRATION_CLOSED shown verbatim; request carried no x-invitation-code
B8 PASS B@1440/dashboard=absent B@1440/categories=absent B@390/dashboard=absent B@390/categories=absent A@1440/dashboard=present A@1440/categories=present A@390/dashboard=present A@390/categories=present
B9 PASS curl -s -D - http://localhost:3000/login: Referrer-Policy header no-referrer=true, meta=false
OK B1-B9
exit=0
```
After the run: `lsof -nP -iTCP:3000 -sTCP:LISTEN | wc -l` → `0`, and `b8_onboarding_check` no
longer exists (`psql -l | grep -c onboarding` → `0`). The script stops its own dev server and
Chromes and drops its database in a `finally`.

## Mutation log (implementer-side)

Each mutation applied alone, the named suite run, then the file restored byte for byte and the
suite re-run. Unit mutations ran `npx vitest run lib/invitationLink.test.ts lib/passkeyCeremony.test.ts`;
the logging mutation ran the integration file against `b8_p41a2_throwaway`.

```
header only on register/options | lib/passkeyCeremony.ts | failed: T41a2-C1, T41a2-C6, T41a2-C7 | after revert: all 14 passed
header only on register/verify | lib/passkeyCeremony.ts | failed: T41a2-C1, T41a2-C6, T41a2-C7 | after revert: all 14 passed
empty-string header when there is no code | lib/invitationLink.ts | failed: T41a2-U5, T41a2-C2 | after revert: all 14 passed
code in the query string | lib/invitationLink.ts | failed: T41a2-U1 | after revert: all 14 passed
header on login requests | lib/passkeyCeremony.ts | failed: T41a2-C3 | after revert: all 14 passed
reader accepts a 21-character code (ignores the contract) | lib/invitationFragment.ts | failed: T41a2-U4 | after revert: all 14 passed
'#invite=' treated as ordinary mode | lib/invitationFragment.ts | failed: T41a2-U4 | after revert: all 14 passed
control shown for isOwner truthy | lib/invitationLink.ts | failed: T41a2-U6 | after revert: all 14 passed
control shown when me is null | lib/invitationLink.ts | failed: T41a2-U6 | after revert: all 14 passed
scrub helper leaves the fragment | lib/invitationLink.ts | failed: T41a2-U7 | after revert: all 14 passed
ceremony module writes the code to storage | lib/passkeyCeremony.ts | failed: T41a2-C7 | after revert: all 14 passed
REGISTRATION_CLOSED envelope swallowed at options | lib/passkeyCeremony.ts | failed: T41a2-C4, T41a2-C7 | after revert: all 14 passed
code logged in a test-kit-visible path | lib/invitationLink.ts | failed: T41a2-I5 | after revert: all 6 passed
```

Where more scenarios failed than the spec names, the extra ones share the broken assertion and are
listed honestly rather than trimmed:
- Header on options only / verify only: C1 as specified, plus C6 (its retry asserts the header on
  both requests) and C7 (it re-runs C1's assertions under hostile globals).
- `#invite=` as ordinary mode: U4 fails; U3 does not, because U3's table is the absent-key cases and
  `#invite=` is not among them. The spec writes "U3/U4".
- `REGISTRATION_CLOSED` swallowed: C4 as specified, plus C7 (re-runs C4's assertions).

Browser probes, run once each by the implementer as a sanity check (the orchestrator applies these
two itself at G2/G3; these are not a substitute):
- Page never calls the scrub (the `replaceState` line removed from `app/login/page.tsx`):
  `B1 PASS …`, then `B2 FAIL fragment still present after load (hash length 30)`, `exit=1`.
- Page writes the code to `localStorage` on reading it:
  `B1 PASS …`, `B2 PASS …`, then `B3 FAIL the code is in profile B storage or cookies`, `exit=1`.
Both reverted from a byte copy; the subsequent full run printed `OK B1-B9`.

## Screenshots

`plan/tasks/P7-41a2-browser-onboarding/screenshots/`, written by
`node apps/web/scripts/onboarding-browser-check.mjs --screenshots=plan/tasks/P7-41a2-browser-onboarding/screenshots`
(that run also printed `OK B1-B9`), over the fabricated scratch database `b8_onboarding_check`:
- `owner-panel-desktop.png`, `owner-panel-390.png` — the owner's panel at 1440px and in the 390px
  drawer. The link field is blurred by the script before capture (glyphs transparent, only a blurred
  shadow drawn), so no code is recoverable from either image. Taken on `/categories` rather than the
  dashboard, because the empty store's dashboard renders zero-dollar tiles. The categories form's
  static placeholder in its "Annual budget" field is visible; it is the app's own placeholder text
  from source, not data.
- `invitee-invitation-mode.png` — profile B on the link, after the scrub, before the click.
- `invitee-refused.png` — profile C on the consumed link: the server's refusal.
- `malformed-link-refused.png` — profile D on `/login#invite=short`: the page's own refusal.
The names shown are `Owner` and `Test User Two`, both fabricated.

## What is and is not provable here

- The fragment property — the code never reaching a server, a proxy log or a Referer — is a browser
  guarantee. B2 and B3 assert it against headless Google Chrome only (the CDP network log of every
  request profile B made, its full sent headers including `Referer`, its storage and cookies, and a
  `grep -c` of the dev server's own output). No other browser was tested.
- The production reverse proxy's access-log format and any header-logging configuration cannot be
  checked from this repo. If a proxy logs request headers, `x-invitation-code` on
  `register/options` and `register/verify` would be in that log; nothing here can rule that out.
- No automated step covers a FAILED create (401 after a session expiry, 400, 403, network error).
  The control shows the server's error message, or a fixed fallback, and no link in that case
  (`createdInvitation` returns null unless the whole success body is present); this is by
  reading the code, not by a command.
- The in-flight disabled state and the single request on a double click are observed in B1 by
  holding the create request with the DevTools `Fetch` domain; the component also guards with a ref.
- In B2, by the time Chrome reports the document load complete the scrub has already run, so the
  "before any click" reading is `''` both at load and after hydration. That the scrub is what
  produces it (rather than the fragment never having been there) is shown by the browser probe above,
  where removing the scrub turns B2 red.
- A stale service-worker cache serving an old `/login` is not covered: every profile is fresh.
- The browser check relies on port 3000 being free and on Chrome at the default path (or `$CHROME`).

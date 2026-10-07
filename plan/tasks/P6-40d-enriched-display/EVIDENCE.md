# P6-40d-enriched-display — Evidence (implementer)

Run on 2026-10-07 from the worktree root. `BASE=879ad00` (P6-40b). The worktree branch was created
one commit behind, at a236a34; it was fast-forwarded to 879ad00 (`git merge --ff-only`) before any
work, since the four columns this task reads arrive in 879ad00. `npm ci` was run in the worktree
(no `package.json` / `package-lock.json` change, see #6). Baseline before any change:
`Test Files 70 passed (70)`, `Tests 1037 passed (1037)`.

Scratch database: `b8_p640d_preview` only, fabricated rows only (`preview-seed.sql` in this
directory). `b8_finance` was never touched. No network, no Plaid.

## Files changed

| File | Change |
|---|---|
| `apps/web/lib/enrichedDisplay.ts` | **New**, pure. `safeLogoUrl` (R1): trims; refuses non-strings, empty, over 2048 chars, any control char/space/DEL inside the trimmed text (so `java<TAB>script:` is refused as stored rather than repaired by the URL parser), anything not starting `https://` in the raw text, anything `new URL` throws on (caught), a non-`https:` protocol, an empty host, any username/password; returns the normalized `href` (re-checked against the bound). `enrichmentDetail` (R2): authorized date only when it is ISO `YYYY-MM-DD`, a real calendar day (checked by hand, not `new Date`), and `!==` the posted `date` string; location `City, ST` / city / region after trimming, blank is absent. `detailLine`: joins the non-null parts with one ` · `, labels the date `Authorized <date>` in the caller's date style, returns `null` when there is nothing. `placeholderInitial` (R3): first `\p{L}`/`\p{N}`, uppercased, first code point of the result. |
| `apps/web/components/MerchantMark.tsx` | **New**, `'use client'`. The one shared mark (R3/R4). `src` is `const src = safeLogoUrl(logoUrl)`; no `<img>` when that is `null`. Plain `<img>`, `alt=""`, `width`/`height` 28, `loading="lazy"`, `referrerPolicy="no-referrer"`, `draggable={false}`, no `crossOrigin`, `onError` swaps to the placeholder. A failed URL is remembered in state AND in a module-level set, so it is not retried on re-render or on remount (Show fewer → Show more). A mount-time check (`complete && naturalWidth === 0`) catches an image that failed before hydration, when React's `onError` was not attached yet. Placeholder: `size-7` slate-100 tile with the initial, same box as the logo. **Superseded in Cycle 1 (below):** the tile is now always rendered, the img is invisible until `onLoad`, and the `naturalWidth === 0` check is gone. |
| `apps/web/components/AccountStatementList.tsx` | `StatementRow` gains the four fields as `string \| null`. Row grid gains a leading fixed `1.75rem` track (phone `[1.75rem_minmax(0,1fr)_auto]`, sm+ `[1.75rem_minmax(0,1fr)_12rem_9rem_2rem]`); every existing cell's `col-start` shifted by one, explicit placement kept on every cell; the mark spans both phone lines (`row-span-2`, `sm:row-span-1`). Phone `gap-x` reduced from 4 to 3 to give the title back most of the 28px (sm+ keeps 4). Detail line rendered under the title only when non-null, `text-xs text-slate-400 truncate`, "Mon D" style via the file's own `shortDate`. Amount, balance, sign, `fmt`, Show more and swipe are untouched. |
| `apps/web/components/TransactionTable.tsx` | `TxRow` gains the four fields as `string \| null`. The mark and detail line go INSIDE the existing Merchant `<td>` (a flex wrapper), so no new grid cell is added to the phone layout and no cell placement changes. Detail line in ISO style (the Date column's), visible on phone too, `wrap-anywhere` so a long city cannot widen the desktop column. Amount/sign/sort/filters/controls untouched; Duplicate still POSTs its explicit field list. |
| `apps/web/app/accounts/[id]/page.tsx` | Local `TxRow` gains the four fields; SELECT gains `logo_url, authorized_date::text, location_city, location_region`. No WHERE/JOIN/ORDER change. |
| `apps/web/app/transactions/page.tsx` | Local `TxRow` gains the four fields; SELECT gains `t.logo_url, t.authorized_date::text AS authorized_date, t.location_city, t.location_region`. No WHERE/JOIN/ORDER change. |
| `apps/web/lib/enrichedDisplay.test.ts` | **New**, 60 tests: every row of the spec's case table (one test per row, `it.each` for the grouped null rows), the "never `null`/`undefined`/`Invalid`" sweep across all rows, plus extras (bound at exactly 2048 / 2049, username-only, `https:` without slashes, embedded newline, uppercase normalization, leap day, timestamp-as-date, `detailLine` joins, punctuation-led titles, `ß`). |
| `apps/web/lib/enrichedDisplayWiring.test.ts` | **New**, 11 tests over the TSX AST (TypeScript compiler API). Items 1–6 of the spec, the mark discovered (the one `components/**/*.tsx` importing `safeLogoUrl`) and checked for `'use client'`, and four self-tests that run each checker on fabricated bad sources (`src={t.logo_url}`, shadowed `src`, prop-fed `src`, `<Image>`, missing/other referrer, missing `onError`, enrichment `href`, `plaid_raw` in SQL, optional/too-wide/`string`-only types, detail computed but not rendered) so no checker can pass by matching nothing. |
| `plan/tasks/P6-40d-enriched-display/preview-seed.sql` | **New.** Fabricated seed for the orchestrator's browser evidence (see below). |

Not touched: `next.config.ts`, `packages/contracts/**`, `db/**`, `migrations/**`, `package.json`,
`package-lock.json`, `SwipeDeleteRow.tsx`, sync/webhook/Plaid code, the 40c files
(`apps/web/scripts/backfill-enrichment*`, `vitest.integration.config.mts`). `AGENTS.md` was not
dirtied by `next dev`.

## Palette note
`uiux-promax` lists `gray-*` for muted text and borders; both row files are `slate-*` throughout.
Followed the files (slate-100 tile, slate-500 initial, slate-400 detail, ring-slate-100 on the logo).

## Acceptance commands (verbatim)

Where a command is piped through `tail` below, the printed `exit=` is the pipe's; the unpiped exit
codes were taken separately and are listed after the block.

```
$ npx tsc --noEmit
exit=0

$ npm run lint 2>&1 | tail -4
✖ 4 problems (0 errors, 4 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
exit=0

$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts 2>&1 | tail -8
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/.claude/worktrees/agent-a88333accd5bf0711/apps/web
 Test Files  1 passed (1)
      Tests  60 passed (60)
   Start at  08:23:20
   Duration  232ms (transform 40ms, setup 0ms, import 53ms, tests 9ms, environment 0ms)
exit=0

$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts 2>&1 | tail -8
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/.claude/worktrees/agent-a88333accd5bf0711/apps/web
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  08:23:21
   Duration  971ms (transform 114ms, setup 0ms, import 618ms, tests 135ms, environment 0ms)
exit=0

$ npm test 2>&1 | tail -8
(Use `node --trace-warnings ...` to show where the warning was created)
(node:98536) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
 Test Files  72 passed (72)
      Tests  1108 passed (1108)
   Start at  08:23:23
   Duration  6.30s (transform 2.37s, setup 0ms, import 5.73s, tests 6.97s, environment 8ms)
exit=0

$ git diff --exit-code -- apps/web/next.config.ts packages/contracts db migrations package.json package-lock.json
exit=0

$ git diff --exit-code 879ad00 -- apps/web/next.config.ts packages/contracts db migrations package.json package-lock.json
exit=0

$ grep -rniE "website" apps/web/components/AccountStatementList.tsx apps/web/components/TransactionTable.tsx apps/web/app/accounts/\[id\]/page.tsx apps/web/app/transactions/page.tsx
exit=1

$ grep -c "authorized_date::text" "apps/web/app/accounts/[id]/page.tsx" apps/web/app/transactions/page.tsx
apps/web/app/accounts/[id]/page.tsx:1
apps/web/app/transactions/page.tsx:1
exit=0
```

Unpiped exit codes: `npm run lint exit=0`, `#3 exit=0`, `#4 exit=0`, `npm test exit=0`.

| # | Result |
|---|---|
| 1 | exit 0 |
| 2 | exit 0, 0 errors. The 4 warnings are the baseline's 4 (same count before the change; none in a touched file) |
| 3 | 60 passed, 0 failed (floor 30) |
| 4 | 11 passed, 0 failed (floor 6) |
| 5 | 1108 passed = 1037 baseline + 60 + 11; 72 files = 70 + 2 |
| 6 | exit 0, no output — both against HEAD and against 879ad00 |
| 7 | exit 1, no output |
| 8 | each file prints `1` |

Also run: `npm run build -w @b8/web` completed (`✓ Generating static pages using 7 workers (35/35)`).

## Mutation probes (each applied alone, command run, file restored)

```
=== P1 permit http: in safeLogoUrl
$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts
exit=1
 FAIL  lib/enrichedDisplay.test.ts > safeLogoUrl — only an absolute https URL with a host reaches src > refuses http: (mixed content, and not what Plaid sends)
AssertionError: expected 'http://example.com/l.png' to be null

=== P2 drop referrerPolicy from the img
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 10 passed (11)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > 2. every img sends no referrer, falls back on error, and is a fixed, lazy, decorative, undraggable box with no crossOrigin
    "file": "components/MerchantMark.tsx",
-   "leaky": [],
+   "leaky": [

=== P3 src from the raw field   (src={src} -> src={logoUrl ?? undefined})
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 10 passed (11)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > 1. every img/Image in the mark and both row components takes its src from safeLogoUrl, and none imports next/image
    "file": "components/MerchantMark.tsx",
-   "unsanitised": [],
+   "unsanitised": [

=== P4 drop the authorized == posted check
$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts
exit=1
      Tests  1 failed | 59 passed (60)
 FAIL  lib/enrichedDisplay.test.ts > enrichmentDetail — what the secondary line says > an authorized date equal to the posted date, no location
AssertionError: expected { authorized: '2026-03-04', …(1) } to match object { authorized: null, location: null }

=== P5 remove ::text from the account page SELECT
$ grep -c "authorized_date::text" "apps/web/app/accounts/[id]/page.tsx" apps/web/app/transactions/page.tsx
exit=0
apps/web/app/accounts/[id]/page.tsx:0
apps/web/app/transactions/page.tsx:1
```

All five turn their command red. **Note on P5 / #8:** `grep -c` over two files exits 0 when
either file matches, so #8 goes red in its printed count (`0` for the mutated file), not in its
exit code. The spec's Expected column ("each file prints `1`") is what catches it; an orchestrator
gating #8 on exit status alone would miss this mutation.

## Server-render check against the fabricated seed

Not the browser evidence (that is the orchestrator's) — a `curl` of both pages from `next dev`
against `b8_p640d_preview`, with a fabricated scratch-only session (since revoked).

- `<img>` elements: exactly 3 per page — the loading logo, the dead-host logo, and the hidden row's
  logo. Each renders as `alt="" width="28" height="28" loading="lazy" decoding="async"
  referrerPolicy="no-referrer" draggable="false"`, no `crossorigin`.
- No `<img>` for the `javascript:`, `http:`, whitespace-only or null logo rows; each shows the slate
  tile with its initial (H, P, D, N …).
- Detail lines present, verbatim: account page `Authorized Oct 5 · Portland, OR`, `Springfield`,
  `OR`, `Authorized Sep 27 · Salem, OR`, and the long-city row; Transactions page the same in ISO
  (`Authorized 2026-10-05 · Portland, OR`, …). The equal-dates row has no detail element. No
  `null`, `undefined` or `Invalid Date` text in either page.
- The `javascript:alert(1)` string appears once per page, only inside the RSC flight JSON (the row
  prop handed to the client component), never in an attribute. `plaid_raw`: 0 occurrences.
- **Byte-identical money and order.** The four touched files were temporarily replaced by their
  879ad00 versions, both pages fetched, then restored. Comparing the text of every `font-mono`
  element (amounts, balances, closing balances, the Transactions date column) and the row titles in
  document order: `account page: 28 font-mono values, identical=true; 11 row titles in order,
  identical=true` / `transactions page: 21 font-mono values, identical=true; 10 row titles in
  order, identical=true`.

## For the orchestrator's browser evidence

```
psql -d b8_p640d_preview -v ON_ERROR_STOP=1 -f plan/tasks/P6-40d-enriched-display/preview-seed.sql
(cd apps/web && DATABASE_URL=postgres:///b8_p640d_preview SCHEDULER_IN_PROCESS=false npx next dev -p 3640)
```
Then `/accounts/p640d-demo-checking` and `/transactions`. The seed is re-runnable, dates are
relative to `CURRENT_DATE`, and it covers every row the spec lists: logo that loads (a public
https favicon), dead host (`.invalid` TLD), no logo, `javascript:alert(1)`, distinct authorized
date with city+region, equal dates with no location, city only, long merchant name (plus a long
city), a hidden row with a logo and detail, a region-only row with padded/blank text, and an
`http:` logo. The pages need a session; the preview DB has no enrolled passkey of yours. I minted
one by inserting a fabricated `webauthn_credentials` row (`credential_id 'p640d-preview-cred'`,
still present) and an `auth_sessions` row whose `token_hash` is the sha256 hex of a random
base64url token, then sent `Cookie: b8_session=<token>`; that session is now revoked — insert a
fresh `auth_sessions` row the same way.

Third-party logo hosts learn the viewer's IP address when a logo loads. That is the accepted
consequence of showing logos (spec Evidence item 8); the request carries no referrer and no
credentials, and the app's server never fetches a logo (no `next/image`, no `images` config).

## Not done / open
- Browser screenshots, `getBoundingClientRect` alignment, 390px overflow, swipe and Show more with
  a logo, the dead-URL fallback in a real browser, the Referer header check, and the hidden-row
  opacity: the orchestrator's, per the spec. Not run by me — I had no browser.
- (Superseded in Cycle 1: the heuristic below was removed.) The pre-hydration error fallback (mount-time `complete && naturalWidth === 0` check) is reasoned
  from the HTML spec's definition of `complete`, not observed; the dead-host row exercises it.

# Cycle 1 (after G3 NIT H9, G4 finding F1)

Run on 2026-10-07 in the same worktree, on top of 2575066. Same scratch DB, same fabricated seed.

## Changes in this cycle

| File | Change |
|---|---|
| `apps/web/components/MerchantMark.tsx` | **F1.** The slate tile with the initial is ALWAYS rendered and is the box (`relative size-7`). When `safeLogoUrl` gives a URL, the `<img>` is rendered inside the tile, `absolute inset-0 size-7`, and starts at `opacity-0`; it becomes `opacity-100` only once `onLoad` fires. `onError` unmounts it (it was never visible). A failure is therefore never painted, whether it happens before hydration, after hydration, or when a lazy image scrolls into view. **H9.** I removed the mount-time `complete && naturalWidth === 0` heuristic. The tab-wide set (renamed `failedLogos`) is now added to only inside `onError`, so a deferred `loading="lazy"` image can no longer be marked dead before it is requested. A failed URL is still not retried, on re-render (state) or on remount (the set). **Loaded before hydration:** on mount, `img.complete && img.naturalWidth > 0` marks it loaded and visible. `naturalWidth === 0` is never read as failure. The R4 attributes are unchanged: `src` from `safeLogoUrl` only, `alt=""`, 28×28, lazy, `no-referrer`, not draggable, no crossOrigin, `onError` present, plus `onLoad`. I rewrote the comments for the new R4 behaviour. |
| `apps/web/lib/enrichedDisplayWiring.test.ts` | 11 → 15 tests. **Item 1 extended:** an img fails on any of the following, and each has a self-test on a fabricated bad source. The self-tests also include a passing shape: `srcSet` from `safeLogoUrl` plus a harmless `style`.<br>• a `srcSet`/`srcset` present and not from `safeLogoUrl`<br>• any JSX spread attribute<br>• a `style` whose expression mentions an identifier or string matching `logo`, `url` or `src` (case-insensitive)<br>**New R4/F1 test:**<br>• the placeholder initial is rendered inside a JSX element that is not under `?:`, `&&`, `\|\|` or `??` within its `return`<br>• every `img` is a descendant of that element (on top of the tile, not instead of it)<br>• every `img` has `onLoad`<br>• the img's `className` has an `opacity-0` or `invisible` token in some string or template fragment<br>**New R4/H9 test:** every `x.add(...)` call in the mark is inside the `onError` attribute, and every `naturalWidth` read is exactly `naturalWidth > 0`.<br>Two more self-test blocks cover these new checkers. Among them are the cycle-0 shape (img OR tile, via an early return and via a ternary), a visible-while-loading img, a missing `onLoad`, `.add` in an effect, `naturalWidth === 0` and `!naturalWidth`. The referrerPolicy and onError checks are unchanged. |
| `plan/tasks/P6-40d-enriched-display/EVIDENCE.md` | I marked the cycle-0 R4 wording as superseded in place and appended this section. |

## What the new structural checks can and cannot see
- **F1 check (P6):** it proves the hiding class is present and that the img has an `onLoad`. It does not prove that `onLoad` is what removes the class. A component that kept `opacity-0` forever, with an `onLoad` that did nothing, would pass this test and show no logos. That would be a visible regression, not a privacy or broken-icon one, and the browser evidence would catch it. Proving the data flow from `onLoad` to `className` needs a DOM, and this repo deliberately has no DOM test environment.
- **H9 check (P7):** it is caught structurally, by two independent assertions. P7's mutation failed on the first assertion, `.add` outside `onError`. The second assertion, `naturalWidthGuesses`, would also have failed; the test stops at the first failure. A heuristic written as `setFailedSrc` alone, without `.add`, would still be caught by the `naturalWidth` assertion. A heuristic that did not read `naturalWidth` at all (for example, a timeout) would not be caught by either assertion.

## Acceptance re-run (cycle 1)
```
$ npx tsc --noEmit
exit=0

$ npm run lint 2>&1 | tail -4
✖ 4 problems (0 errors, 4 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
exit=0

$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts 2>&1 | tail -8
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/.claude/worktrees/agent-a88333accd5bf0711/apps/web
 Test Files  1 passed (1)
      Tests  60 passed (60)
   Start at  10:04:09
   Duration  175ms (transform 29ms, setup 0ms, import 38ms, tests 7ms, environment 0ms)
exit=0

$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts 2>&1 | tail -8
 RUN  v4.1.10 /Users/andreianpilogov/Documents/b8/app/.claude/worktrees/agent-a88333accd5bf0711/apps/web
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  10:04:10
   Duration  487ms (transform 74ms, setup 0ms, import 316ms, tests 57ms, environment 0ms)
exit=0

$ npm test 2>&1 | tail -8
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27596) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
 Test Files  72 passed (72)
      Tests  1112 passed (1112)
   Start at  10:04:11
   Duration  6.11s (transform 2.05s, setup 0ms, import 5.51s, tests 7.01s, environment 6ms)
exit=0

$ git diff --exit-code -- apps/web/next.config.ts packages/contracts db migrations package.json package-lock.json
exit=0

$ git diff --exit-code 879ad00 -- apps/web/next.config.ts packages/contracts db migrations package.json package-lock.json
exit=0

$ grep -rniE "website" apps/web/components/AccountStatementList.tsx apps/web/components/TransactionTable.tsx apps/web/app/accounts/\[id\]/page.tsx apps/web/app/transactions/page.tsx
exit=1

$ grep -c "authorized_date::text" "apps/web/app/accounts/[id]/page.tsx" apps/web/app/transactions/page.tsx
apps/web/app/accounts/[id]/page.tsx:1
apps/web/app/transactions/page.tsx:1
exit=0
```
Unpiped exit codes: `npm run lint exit=0`, `#3 exit=0`, `#4 exit=0`, `npm test exit=0`. #5: 1112 = 1037 + 60 + 15.
The 4 lint warnings are the baseline's 4. `npm run build -w @b8/web`: `✓ Generating static pages using 7 workers (35/35)`.

## Mutation probes (cycle 1): the five originals plus two new
Each probe was applied alone, its command run, and the file restored. Output trimmed to the result lines:
```
=== P1 permit http: in safeLogoUrl
$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts
exit=1
 FAIL  lib/enrichedDisplay.test.ts > safeLogoUrl — only an absolute https URL with a host reaches src > refuses http: (mixed content, and not what Plaid sends)
AssertionError: expected 'http://example.com/l.png' to be null

=== P2 drop referrerPolicy from the img
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 14 passed (15)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > 2. every img sends no referrer, falls back on error, and is a fixed, lazy, decorative, undraggable box with no crossOrigin
+   "leaky": [

=== P3 src from the raw field   (src={src} -> src={logoUrl ?? undefined})
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 14 passed (15)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > 1. every img/Image in the mark and both row components takes its src (and any srcSet) from safeLogoUrl, with no spread and no logo-fed style, and none imports next/image
+   "unsanitised": [

=== P4 drop the authorized == posted check
$ npm test -w @b8/web -- lib/enrichedDisplay.test.ts
exit=1
      Tests  1 failed | 59 passed (60)
 FAIL  lib/enrichedDisplay.test.ts > enrichmentDetail — what the secondary line says > an authorized date equal to the posted date, no location
AssertionError: expected { authorized: '2026-03-04', …(1) } to match object { authorized: null, location: null }

=== P5 remove ::text from the account page SELECT
$ grep -c "authorized_date::text" "apps/web/app/accounts/[id]/page.tsx" apps/web/app/transactions/page.tsx
exit=0
apps/web/app/accounts/[id]/page.tsx:0
apps/web/app/transactions/page.tsx:1

=== P6 img visible while loading   (${loaded ? 'opacity-100' : 'opacity-0'} -> opacity-100)
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 14 passed (15)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > R4/F1. the tile is always the box, and the logo stays invisible until it has loaded
+   "img className never hides it: <img

=== P7 restore the naturalWidth === 0 mount heuristic   (adds `if (src !== null && img && img.complete && img.naturalWidth === 0) { failedLogos.add(src); setFailedSrc(src); }` to the effect)
$ npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts
exit=1
      Tests  1 failed | 14 passed (15)
 FAIL  lib/enrichedDisplayWiring.test.ts > the enriched rows are wired through the sanitiser (AST) > R4/H9. a logo is recorded as failed only by a real error event, never by a zero naturalWidth
AssertionError: expected [ 'failedLogos.add(src)' ] to deeply equal []
```
All seven turn red. As in cycle 0, P5 goes red only in #8's printed count: `0` for the mutated file.

## Server-render check (cycle 1)
`next dev` against `b8_p640d_preview`, curl with a fresh fabricated scratch session, revoked afterwards.
- **Image markup:** each page has 3 `<img>`. Every one is server-rendered `opacity-0` (0 at `opacity-100`), as a child of the tile `<span aria-hidden="true" class="relative … size-7 … bg-slate-100 …">` that also carries the initial. So before hydration the reader sees only the tile, including for the dead-host row.
- **Rows with no image:** rows without a usable logo render the same tile and no img.
- **Unchanged money and order:** I compared against the 879ad00 render again, using the same comparison as cycle 0. Result: `account page: 28 font-mono values, identical=true; 11 row titles in order, identical=true` / `transactions page: 21 font-mono values, identical=true; 10 row titles in order, identical=true`.

## Not done (cycle 1)
- **Browser checks:** I have not observed F1's fix in a browser (no browser here), so the 390px dead-host recheck is the orchestrator's.
- **Loaded before hydration:** I have not observed the "loaded before hydration → visible" path either. It relies on `complete && naturalWidth > 0` after mount. If that check ever fails, the logo stays hidden and the tile shows. That fails safe: no broken icon, but no logo.

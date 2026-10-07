# P6-40d-enriched-display — Show merchant logo, authorized date and location on rows
**Roadmap item:** ROADMAP.md §5 "Phase 6 — Data fidelity" step 40d — "show it": merchant logo on statement and transaction rows (falling back to the current row when absent); authorized date and location in a transaction's detail. UI only.
**Status:** FROZEN@G0 (2026-10-07)
**Author:** spec-writer

## Goal
On the account page statement (`apps/web/components/AccountStatementList.tsx`) and on the Transactions page (`apps/web/components/TransactionTable.tsx`), every row starts with a fixed-size merchant mark. It is the merchant's logo when a safe https logo URL is stored. Otherwise it is a neutral placeholder tile of identical size, the same on both surfaces. The mark has the same footprint whichever it shows, so rows with and without logos stay aligned, and no horizontal scroll appears at 390px width. Each row also shows, as plain visible text with no interaction needed (a phone has no hover), a secondary detail line carrying the transaction's authorized date and location ("City, ST"). The line is shown only when it has something to say. The authorized date is omitted when it equals the posted date. A missing piece produces no text, no placeholder word and no dangling separator. Logos come from third-party URLs and are treated as untrusted. Only an `https:` URL ever reaches an `img` `src`. A dead URL falls back to the placeholder with no broken-image icon. The request never sends the app's URL as a referrer. The app's server never fetches a logo.

## Tier assessment (BUILD.md A8) — confirmed in part, one part refuted
Read of the code:
- **No contract surface — confirmed.** `StatementRow` is exported from the component file, and the Transactions page's `TxRow` is local to `TransactionTable.tsx`. Neither lives in `packages/contracts`. The account page's `TxRow` is a local type too.
- **No migration — confirmed.** It reads the nullable columns P6-40b adds.
- **No money arithmetic — confirmed.** Amounts, signs, running balances and the `fmt` helpers are untouched. This spec forbids changing them.
- **No outbound surface — NOT cleanly confirmed.** The app's server makes no new call. But the user's browser starts fetching images from third-party hosts, which exposes the viewer's IP and the fact of viewing. `next.config.ts` has no `images` config and there is no CSP anywhere in the repo, so nothing else restricts it.

Recommendation: A8 tier-down is acceptable for G1 (skipped anyway). **G3 should stay blocking, scoped to the logo privacy and robustness rules in this spec** (scheme allowlist, referrer policy, no server-side fetch, dead-URL fallback). That is where a plausible defect has real consequences. The orchestrator records the tier and this reasoning in `GATES.md`.

## Non-goals
Each of these is a defect if it appears in the diff.
- No schema, migration, `db/schema.sql` or `packages/contracts` change. No sync, webhook or Plaid-client change. No backfill (that is P6-40c). No change to deletion tombstones (40a).
- No website shown or linked anywhere. No `href` built from any enrichment field.
- No display of payment channel, merchant entity id, detailed (Plaid) category, counterparties, or the retained raw Plaid object. The raw column must not be selected into either page's query. It would ship a large payload to the client for nothing.
- No map, geocoding, location filtering, location search or sorting, or any other use of location. No change to the existing search or filters on the Transactions page.
- No change to categorisation, rules, transfer logic, hiding, watching, deleting or duplicating a transaction, or to the existing row controls and their behavior. The enrichment fields must not be sent by the duplicate/edit flows.
- No change to amount, sign, balance or running-balance rendering or computation. No change to the `date` shown on a row or to row ordering.
- No `next/image`, no `images` or `remotePatterns` entry in `next.config.ts`, no CSP or header change. `next.config.ts` has no `images` config today, and enabling the optimizer would make the server fetch arbitrary third-party URLs.
- No new dependency. No jsdom or component-test environment (`vitest.config.mts` is node-only and includes only `lib/**/*.test.ts`; it stays that way).
- No expandable or collapsible detail UI. The detail is a static visible line.
- Do not change the "Show more" paging in `AccountStatementList` or the swipe-to-delete gesture.

## Contracts touched
None. The implementer reads the nullable columns added by P6-40b (meanings: logo URL, authorized date, location city, location region). Provisional names used below are `logo_url`, `authorized_date`, `location_city`, `location_region`. **Reconciled at G0: these are exactly P6-40b's frozen column names** (`migrations/1791360000000_plaid-enrichment.sql`); the raw column the non-goals forbid selecting is `plaid_raw`.

**Prerequisite:** P6-40b has landed. Its columns must exist before the SELECTs can be changed. The acceptance commands do not need a database.

## Conventions this task must honor
- **Sign:** not applicable and not to be touched. Plaid's sign convention (positive is money out) stays exactly as the two components render it today, including the account page's `+`/`−` and the Transactions page's `+` on negative amounts. No amount, balance or sign expression is edited.
- **Rounding:** not applicable. No arithmetic is added.
- **Landscape + exclusions:** not applicable. No filter, aggregate or query predicate changes. The two SELECTs gain columns only. They do not gain or lose WHERE conditions, JOINs or rows. `hidden` rows keep the existing 40% opacity treatment on the Transactions page. The logo and detail line inherit it.
- **Null semantics:** a null, empty or whitespace-only logo URL, authorized date, city or region means "unknown". Unknown renders as the placeholder tile (logo) or as no text at all (detail). It is never the strings `null`, `undefined`, `0`, an empty `()`, a lone `·` or `,`, or a literal `Invalid Date`. The detail line does not use the app's "—" placeholder either, since an absent detail is the common case (logo about 40% of rows, city about 27%, authorized date about 97% on the owner's data).
- **Dates cross the server/client boundary as text.** Both pages cast dates `::text` today. The new authorized date must be selected the same way (`authorized_date::text`) so it is an ISO `YYYY-MM-DD` string, comparable by equality with the posted `date` string. A `pg` `Date` object would break prop serialization or shift a day with the time zone.
- **UI rules:** follow `.claude/skills/uiux-promax/SKILL.md`, using existing slate tokens and the existing text-xs/slate-400 secondary-text style already used in both rows.

## Behavior that must be observably true (the rules the commands gate)

### R1. Logo URL allowlist (pure function, `apps/web/lib/enrichedDisplay.ts`, export `safeLogoUrl`)
`safeLogoUrl(value: string | null | undefined): string | null`. The returned string, never the raw input, is the only value that may reach an `img` `src`.
- Returns the normalized URL only for an absolute `https:` URL with a non-empty host, no embedded credentials, and total length of at most 2048. Leading and trailing whitespace is trimmed first.
- Everything else returns `null`. That includes `http:`: Plaid logo URLs are https, and an http image on an https-served app is mixed content anyway.

### R2. Detail line (pure function, same module, export `enrichmentDetail`)
`enrichmentDetail({ date, authorized_date, location_city, location_region })` returns `{ authorized: string | null, location: string | null }`.
- `authorized` is the authorized date as an ISO `YYYY-MM-DD` string when it is a real calendar date, differs from the posted `date`, and is present. Otherwise it is `null`. The components format it with their own existing date style: the account page's "Mon D" style, and the Transactions page's ISO style next to its Date column.
- `location` is `"City, ST"`, or just the city, or just the region, after trimming. If both are absent or blank it is `null`.
- The detail line renders when at least one is non-null. When both are present they are joined by one separator. When neither is present the element is not rendered at all, so the row is exactly as tall as it is today (plus the mark's footprint).

### R3. Placeholder mark (same module, export `placeholderInitial`)
`placeholderInitial(title: string | null | undefined): string | null` returns the first letter-or-digit of the title, uppercased, as a single code point. It returns `null` if there is none, and then the tile is empty. The tile has the same box as a logo. Both surfaces use the same shared client component for the mark, so the choice (initial on a neutral slate tile) is made once.

### R4. Image robustness and privacy
Rendered by a plain `<img>` (not `next/image`), inside one shared client component used by both surfaces:
- `src` comes from `safeLogoUrl` only.
- `referrerPolicy="no-referrer"`.
- An error handler swaps to the placeholder tile when the image fails, so there is no broken-image icon. If the URL fails once it is not retried on re-render.
- Explicit fixed width and height equal to the tile size, `loading="lazy"`, decorative `alt=""`, and not draggable, so it does not fight the swipe-to-delete gesture on the phone.
- No `crossOrigin` attribute, no cookies and no credentials.
- When `safeLogoUrl` returns `null`, no `<img>` is rendered at all.

### R5. No website
Neither component nor either page references the website field.

## Toolchain prerequisites
| # | Assumption | Required? | How obtained | Verification command | Measured |
|---|---|---|---|---|---|
| T1 | Node dependencies installed, vitest runs from repo root | **yes** | `npm ci` | `npm test` | filled at G0 |
| T2 | `typescript` resolvable from `apps/web` for the AST wiring test | **yes** | existing devDependency | `node -e "require.resolve('typescript',{paths:['apps/web']})"` | filled at G0 |
| T3 | A Postgres with P6-40b's migration applied | **NO** for acceptance commands (evidence only) | scratch DB per the repo's existing practice, fabricated rows only | n/a | n/a |
| T4 | A browser the orchestrator can drive at 390px and desktop width | **NO** for acceptance commands (Evidence only) | n/a | n/a | n/a |
| T5 | Network / live Plaid | **NO** | n/a | n/a | n/a |

## Acceptance commands
All run from the repo root. All are deterministic. None touches a database, the clock or the network. Existing scripts verified in the root `package.json`: `test` (runs `vitest run` in `@b8/web`), `lint` (`eslint`). `apps/web/vitest.config.mts` includes `lib/**/*.test.ts`.

Prerequisite files the implementer creates, none of which exist today:
- `apps/web/lib/enrichedDisplay.ts`
- `apps/web/lib/enrichedDisplay.test.ts`
- `apps/web/lib/enrichedDisplayWiring.test.ts`
- the shared logo component, for example `apps/web/components/MerchantMark.tsx` (name is the implementer's choice, but the wiring test must discover it)

| # | Command | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npm run lint` | exit 0, 0 errors |
| 3 | `npm test -w @b8/web -- lib/enrichedDisplay.test.ts` | exit 0. Reports at least 30 passed (the case table below is the floor, one test per row), 0 failed |
| 4 | `npm test -w @b8/web -- lib/enrichedDisplayWiring.test.ts` | exit 0. Reports at least 6 passed, 0 failed |
| 5 | `npm test` | exit 0, 0 failed. The passed count is the pre-change count plus the new files' tests (orchestrator records the baseline before dispatch) |
| 6 | `git diff --exit-code -- apps/web/next.config.ts packages/contracts db migrations package.json package-lock.json` | exit 0 (no output). Gates the "no images config, no contract, no schema, no dependency" non-goals |
| 7 | `grep -rniE "website" apps/web/components/AccountStatementList.tsx apps/web/components/TransactionTable.tsx apps/web/app/accounts/\[id\]/page.tsx apps/web/app/transactions/page.tsx` | exit 1, no output. Stand-in for R5, accepted because "not shown" has no richer structural form. R4's AST test also forbids any `href` fed from enrichment |
| 8 | `grep -c "authorized_date::text" "apps/web/app/accounts/[id]/page.tsx" apps/web/app/transactions/page.tsx` | each file prints `1` (at least one occurrence) — A7 pin that the SELECTs deliver ISO text, not a `Date` object. A `SELECT ... authorized_date` without the cast prints `0` |

Provisional field names in command 8 are reconciled with 40b's frozen spec at G0.

### Case table for `enrichedDisplay.test.ts` (the floor; the implementer may add more)
All inputs are fabricated.

`safeLogoUrl`:

| Input | Expected |
|---|---|
| `https://example.com/logo.png` | `https://example.com/logo.png` |
| `https://cdn.example.com/a/b.png?x=1` | same string |
| `  https://example.com/l.png  ` | `https://example.com/l.png` |
| `null`, `undefined`, `''`, `'   '` | `null` |
| `javascript:alert(1)` | `null` |
| `  JavaScript:alert(1)` | `null` |
| `java<TAB>script:alert(1)` | `null` |
| `data:image/png;base64,AAAA` | `null` |
| `data:image/svg+xml,<svg onload=alert(1)>` | `null` |
| `blob:https://example.com/0000` | `null` |
| `http://example.com/l.png` | `null` |
| `ftp://example.com/l.png` | `null` |
| `file:///etc/passwd` | `null` |
| `//example.com/l.png` | `null` |
| `/relative/l.png` | `null` |
| `example.com/l.png` | `null` |
| `https://user:pw@example.com/l.png` | `null` |
| `https://` | `null` |
| `not a url` | `null` |
| `https://example.com/` plus 2100 `a` characters | `null` |
| a non-string value (a number, cast) | `null`, no throw |

`enrichmentDetail` (posted `date` is `2026-03-04` unless stated):

| Input | Expected |
|---|---|
| authorized `2026-03-03`, city `Portland`, region `OR` | `{ authorized: '2026-03-03', location: 'Portland, OR' }` |
| authorized `2026-03-04` (equal to posted), no location | `{ authorized: null, location: null }` |
| authorized `2026-03-06` (later than posted) | `authorized: '2026-03-06'` |
| all null | `{ authorized: null, location: null }` |
| city `Portland`, region null | location `Portland` |
| city null, region `OR` | location `OR` |
| city `'  '`, region `''` | location `null` |
| city `' Portland '`, region `' OR '` | location `Portland, OR` |
| authorized `Wed Mar 04 2026` (a stringified Date, not ISO) | `authorized: null` |
| authorized `2026-02-30` (impossible date) | `authorized: null` |
| authorized `''` | `authorized: null` |
| neither output ever contains the strings `null`, `undefined` or `Invalid` for any row above | asserted across all rows |

`placeholderInitial`:

| Input | Expected |
|---|---|
| `Blue Bottle` | `B` |
| `amazon` | `A` |
| `  7-Eleven` | `7` |
| `élan` | `É` |
| `—`, `''`, `'  '`, `null`, `undefined` | `null` |

### What `enrichedDisplayWiring.test.ts` must establish (parse the TSX with the `typescript` compiler API, A10: structure, not text)
1. The shared logo component renders at least one JSX `img`. Every JSX element named `img` or `Image` found in `AccountStatementList.tsx`, `TransactionTable.tsx` and the shared logo component has a `src` expression that is the result of a call to `safeLogoUrl` (inline, or an identifier initialised from such a call in the same file). A `src` fed from a row field directly fails this test. No other `img`/`Image` element exists in those three files, and none imports `next/image`.
2. Every such `img` has `referrerPolicy` with the literal value `no-referrer` and an `onError` attribute.
3. `AccountStatementList.tsx` and `TransactionTable.tsx` each import the shared logo component and render it inside the row JSX that is inside the `.map` over rows. They also each call `enrichmentDetail` and render its result.
4. Neither row component contains a JSX attribute `href` whose expression references a logo, website, authorized-date or location field.
5. Neither `AccountStatementList.tsx` nor `TransactionTable.tsx` references the raw-Plaid-object field.
6. The row types in both components gain the new fields as `| null`-typed (not optional-defaulting-to-0, not `string` only), which `tsc` enforces together with command 1.

## Negative controls
| # | Rule | Input that must be rejected/excluded | Asserted by |
|---|---|---|---|
| 1 | Only `https:` reaches `src` | `javascript:`, mixed-case/padded `JavaScript:`, tab-split `java\tscript:`, `data:` (png and svg), `blob:`, `file:`, `ftp:`, protocol-relative `//`, relative path, bare host, `http:` | #3 (`safeLogoUrl` table) |
| 2 | No embedded credentials | `https://user:pw@example.com/l.png` | #3 |
| 3 | Bounded length | an `https:` URL over 2048 characters | #3 |
| 4 | `src` is the sanitiser's output, never the raw field | a row component writing `src={t.logo_url}` | #4 (AST data-flow check, item 1) |
| 5 | Referrer not leaked; dead URL falls back | an `img` without `no-referrer` or without `onError` | #4 (item 2) |
| 6 | Authorized date not shown twice | authorized equal to posted | #3 (`enrichmentDetail` table) |
| 7 | Garbage is not printed | stringified `Date`, impossible date, empty string, whitespace-only city/region | #3 |
| 8 | Absent parts produce no text | all-null row; city-only; region-only | #3 |
| 9 | Website is not shown | any `website` reference in the two components or two pages | #7 |
| 10 | No server-side image fetching / optimizer | `images` or `remotePatterns` added to `next.config.ts`, or `next/image` imported | #6 and #4 (item 1) |
| 11 | Raw Plaid object never reaches the client | the raw column in either component or row type | #4 (item 5) |
| 12 | Authorized date arrives as ISO text | `authorized_date` selected without `::text` | #8 |
| 13 | No contract, schema or dependency change | any diff to those paths | #6 |

Mutation probes the orchestrator runs at G2 (not commands, but they validate the gate). Each must turn the named command red:
- Permit `http:` in `safeLogoUrl` (turns #3 red).
- Drop `referrerPolicy` from the `img` (turns #4 red).
- Change `src` to the raw field (turns #4 red).
- Drop the equality check on the authorized date (turns #3 red).
- Remove `::text` from one SELECT (turns #8 red).

## Evidence required
The orchestrator verifies visually in a browser against a scratch database seeded only with fabricated rows. No figure from the owner's ledger goes into any tracked file or the evidence notes. The seed includes at least:
- a row with a logo URL that loads (a local or fabricated https test image);
- a row with a logo URL that points at a dead host;
- a row with no logo URL;
- a row whose logo is the string `javascript:alert(1)` (must show the placeholder, and no script must run);
- a row with authorized date different from posted, with city and region;
- a row with authorized date equal to posted and no location;
- a row with only a city;
- a row with a long merchant name.

Screenshots of both the account page statement and the Transactions page, at desktop width and at 390px width:
1. **Alignment.** Rows with a logo, with the placeholder, and with the dead-URL fallback show the mark in the same position and the same box. The orchestrator confirms this by comparing `getBoundingClientRect()` of the mark across the three kinds of row: identical width and height and the same left offset, with the text column starting at the same x.
2. **No overflow.** `document.documentElement.scrollWidth <= window.innerWidth` at 390px on both pages. On the account page, the swipe-to-delete gesture and the "Show more" control still work with a logo on the row.
3. **Detail line.** It is present on the rows with a distinct authorized date and/or location. It is absent (no element, no blank line, no stray separator) on the rows without. A row with equal dates shows no authorized text.
4. **Dead URL.** No broken-image icon appears, and the placeholder replaces it.
5. **Hostile URL.** No network request is made for the `javascript:` row, and no `<img>` element exists for it (check the DOM).
6. **Privacy.** Network panel or DOM shows the logo request carries `Referrer-Policy: no-referrer` semantics (no `Referer` header on the request), and the Next server log shows no server-side fetch of a logo host.
7. **Hidden rows.** A `hidden` transaction on the Transactions page keeps its reduced opacity, including the mark and the detail line.
8. A note that third-party image hosts learn the viewer's IP when a logo loads. This is an accepted consequence of the owner-approved goal, recorded in the evidence.

## Failure modes to test
- A stored `javascript:`, `data:` or `http:` URL reaches an `src` or `href` (the central risk).
- The `src` is assembled from the raw field somewhere the sanitiser's result is not used, for example a second render path or a mobile-only branch.
- `new URL()` throws on a bad string and crashes the whole table render instead of returning `null`. One bad row must not blank the page.
- A dead logo URL leaves the browser's broken-image icon, or the image error handler loops (set-state with the same bad URL re-renders it).
- The mark's box differs between logo, placeholder and fallback, so the title column shifts and rows misalign. At 390px the mark pushes the title or the amount off-screen, or causes horizontal scroll. In the Transactions page's CSS-grid-on-phone layout (`grid-cols-[auto_1fr_auto]`, explicit `col-start` and `row-start` on each cell), an added element without explicit placement flows into the wrong cell and reorders every row's cells. The same risk applies to the account page's `grid-cols-[minmax(0,1fr)_auto]` and its `sm:` four-column variant.
- The detail line renders an empty element, a stray `·` or `,`, or the word `null`, `undefined` or `Invalid Date`.
- Authorized date equals posted date but both are shown, or the equality is evaluated on a `Date` object and never matches, or on strings with different formats. Alternatively, a timezone shift moves the authorized date by one day (selected without `::text`, or passed through `new Date('YYYY-MM-DD')` and `toLocaleDateString`, which is UTC midnight and displays the previous day in western zones). Any date formatting must split the ISO string, as `shortDate` does today.
- An authorized date later than posted (pending-to-posted oddities) is dropped as "invalid" when it should be shown.
- City and region joined with a trailing comma when only one exists. Whitespace-only values treated as present.
- A row with a very long merchant name, or a very long city, wraps over the amount column or loses its `truncate`.
- Hidden rows lose their opacity treatment on the new elements, or hover and selected-state classes on the Transactions page break.
- The new SELECT columns change the row count (a JOIN introduced by mistake), or the account page's `ORDER BY date ASC, id ASC` order or its running-balance computation changes. Balance figures on the account page must be byte-identical before and after for the same seed.
- The Duplicate flow or the edit save POSTs the whole row object and so sends the new fields back to the API, which is a behavior change.
- `draggable` images interfere with the swipe gesture on a phone, or the mark intercepts the swipe's pointer events.
- The shared mark is a server component imported into a client component, or vice versa, so the error handler never runs (a `use client` boundary missed).
- The Plaid logo URL field holds something other than a URL (non-URL text) and it renders as a placeholder rather than throwing.

## Rollback
`git revert` of the task's commit. There is no migration, no data change and no backfill to undo. Reverting leaves P6-40b's columns in place and unused.

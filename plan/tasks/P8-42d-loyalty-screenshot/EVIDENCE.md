# P8-42d — evidence (implementer, G2 cycle 1)

Tree: `main` at `b82171c`, uncommitted. Commands were run under `bash` from the repo root in the order
1, 2, 3, 17, then the rest. Each command was taken verbatim from SPEC.md (amendments A0, A1b and A2
applied) and saved to a scratch file, then run as `bash <file>`. Output below is trimmed to its
decisive lines. Nothing else was edited. Before the gate runs the dataless count was 0
(`find apps/web packages -flags +dataless -type f -not -path '*/.next/*' | wc -l`).

## Summary

| # | Final line | Status |
|---|---|---|
| 1 | `exit=0` | green |
| 2 | `OK lint 0 errors, warnings not above 5` | green |
| 3 | `OK unit 116 files 1456 tests`, then `OK 26 scenarios …` for both zones | green |
| 4 | `OK 3 scenarios T42c3-U1..U3 …` for both zones | green |
| 5 | `OK 6 scenarios T42c2-U1..U6 …` for both zones | green |
| 6 | `OK dependencies`, `OK additions only` | green |
| 7 | `OK schema`, `OK contracts` | green |
| 8 | `FAIL T42c2-I9: … T42c2-I9:failed(1) total=402` | **RED**. The cause is an existing pinned test; see "Not green" below |
| 9 | `FAIL [ 'T42c2-I9: …' ]` | **RED**. Same cause |
| 10 | `OK classes` | green |
| 11 | `OK H1-H16`, `OK surface` | green |
| 12 | `OK no fixture changed` | green |
| 13 | `OK registry` | green |
| 14 | `OK source guards` | green |
| 15 | `OK scope` | green |
| 16 | `OK existing tests untouched, census exact` | green |
| 17 | `OK due tests fail on today's sources`, `OK stubs fail every scenario`, `OK tree restored` | green |
| 18 | `exit=0` | green |
| 19 | `OK spec has no money-looking text` | green |
| 20 | `OK mutation evidence rows 25` (M16b is a 26th row the pattern does not count) | green (run after this file was written) |

## Not green: T42c2-I9 pins the panel's key set (amendment request A3)

`apps/web/app/api/v1/loyalty/loyaltyRead.test.ts` line 818 (in `T42c2-I9`, an existing test) reads:

```
expect(Object.keys(panel).sort()).toEqual(['coverage', 'failed', 'fromMail', 'lastRead', 'needsAttention', 'needsAttentionTotal', 'readable', 'waiting']);
```

The contract now requires `screenshotDue` on the panel (G1). So every producer that obeys the contract
fails this line:

```
AssertionError: expected [ 'coverage', 'failed', …(7) ] to deeply equal [ 'coverage', 'failed', …(6) ]
+   "screenshotDue",
 ❯ app/api/v1/loyalty/loyaltyRead.test.ts:818:39
```

This is a seventh pin of the same kind as the six that A2 covered, and A2 missed it. The implementer
may not edit the file: command 16 pins its diff by sha256, and command 15's scope rules apply. The edit
needed is to add `'screenshotDue'` to that one sorted list, between `'readable'` and `'waiting'`. That
edit changes command 16's A2 checksum.

Apart from that line, command 8 is clean. I ran its remaining statements by hand on the same JSON
report (`O` was set to the report command 8 wrote):

```
OK T42c3-I1-I3, T42c4-I1-I6 and T42d-I1.1-I1.13, T42d-I2-I11 each present once and passed in their files
OK no fixture rows left
OK no ZQ42D rows or test triggers left
```

Of the 402 integration tests, T42c2-I9 is the only one failing (`total=402`). Command 9 lists the
same single test in both runs. It is stable, but it is not in KNOWN.

## Next 16 and UI conventions read before writing

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Read: Parameters
  (`context.params` is a Promise, awaited), Route Context Helper, and Request Body (Web `Request`
  methods, so `req.arrayBuffer()` for the image). The docs live under repo-root `node_modules/next`;
  `apps/web/node_modules/next` does not exist.
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`. Read:
  `'use client'` marks a boundary and props must serialise. The new components are client components
  rendered under the existing client `TravelBoard`, and they receive only overview data.
- `.claude/skills/uiux-promax/SKILL.md`. Applied: amber callout for the "Needs a screenshot" section,
  `text-amber-600` for warnings, the primary button classes, `disabled={saving}` with
  `disabled:opacity-50` and "Saving…", and inline errors as `text-red-500 text-sm`. The palette
  follows the loyalty files, which use `gray-*` rather than the accounts UI's `slate-*`, so nothing
  mixes in one row. `LoyaltyScreenshotCapture.tsx` is about 150 lines, which is the skill's limit. It
  holds the control and the form together because command 15 admits no third component file.

## Command outputs (trimmed, verbatim)

### 1
```
exit=0
```

### 2
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
```

### 3
```
 Test Files  116 passed (116)
      Tests  1456 passed (1456)
OK unit 116 files 1456 tests
OK 26 scenarios T42d-U1.1..U13 each present once and passed; TZ=UTC
OK 26 scenarios T42d-U1.1..U13 each present once and passed; TZ=Pacific/Auckland
```

### 4
```
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42c3-U1..U3 each present once and passed; TZ=Pacific/Auckland
```

### 5
```
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=UTC
OK 6 scenarios T42c2-U1..U6 each present once and passed; TZ=Pacific/Auckland
```

### 6
```
OK dependencies
OK additions only
```
Only one line was removed in `loyaltyInboxRead.ts`, and it is the line A2 allows:
`-  const counts = await q.query<{ waiting: number; failed: number; pending: number }>(`. No line was
removed in `loyaltyReader.ts`.

### 7
```
OK schema
OK contracts
```

### 8
```
FAIL T42c2-I9: responses, the page and every log line carry counts, codes and a masked suffix, never a key, a body, a number or the model output T42c2-I9:failed(1) total=402
```
The remaining statements, run by hand as described above:
```
OK T42c3-I1-I3, T42c4-I1-I6 and T42d-I1.1-I1.13, T42d-I2-I11 each present once and passed in their files
OK no fixture rows left
OK no ZQ42D rows or test triggers left
```

### 9
```
["T42c2-I9: responses, the page and every log line carry counts, codes and a masked suffix, never a key, a body, a number or the model output"]
["T42c2-I9: responses, the page and every log line carry counts, codes and a masked suffix, never a key, a body, a number or the model output"]
FAIL [
  'T42c2-I9: responses, the page and every log line carry counts, codes and a masked suffix, never a key, a body, a number or the model output'
]
```

### 10
```
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=UTC
OK 7 scenarios T42c1-U1..U7 each present once and passed; TZ=Pacific/Auckland
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
OK as-of bound
OK failure class
OK import end to end
OK sidebar
OK source guards
OK fixtures fabricated
OK coarse source checks
fixture shape ok
fixture shape ok
OK fixtures pinned and covered
OK classes
```

### 11
Port 3198 was free beforehand (`lsof … | wc -l` gave `0`). The H12 and H13 lines are cut where they
begin quoting fixture figures.
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7483 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: a gift-held fee is no fee for either; … [trimmed]
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: … [trimmed]
H14 PASS both users, /travel and /api/v1/loyalty before and after the poll: the panel shows 9 phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; 10 responses hold none of the body canary, the password, the user or the loopback host
H15 PASS both users, /travel and /api/v1/loyalty: 21 phrases present and 2 absent with reading not set up; the read route is 200 disabled for the owner, 401 with no cookie and 403 for a read-scope token; apply on the unique item is 200, reaches the membership's balance in the API and on /travel, and a second apply is 409; the ambiguous item refuses another program's membership with 400; not mine and ignore empty the queue; … responses hold no full member number, key or loopback host
H16 PASS both users: /travel carries the control once per membership and once per due entry, with the heading while 3 memberships are due; the read route is 401 with no credential, 403 for a read-scope token and 200 disabled with every field null for both people; the confirm route is 401, 403, then 201 with source screenshot, and 3 confirms for today empty the due list and remove the heading; both people get the same list before and after; H15's 2 absent phrases stay absent; … responses hold no full member number
OK H1-H16
OK surface
```
How H16 meets (g): it re-checks H15's two `expectAbsent` phrases. It also re-checks each of H15's
`expectText` phrases that resolving H15's queue does not remove: the not-set-up box, the key name,
"Not read yet", the three coverage lines, the expiry and from-mail lines, and the failed count. The
queue-item phrases are not re-checked, because H15 resolves those items itself. H15 passed in the same
run with the new UI on the page.

### 12
```
fixture shape ok
OK new fixtures pinned and covered
fixture shape ok
OK fixtures pinned and covered
OK no fixture changed
```

### 13
```
OK registry
```

### 14
```
OK source guards
```
The first run failed on two test-file header comments, `(U1.1–U2.11)` and `(I1.1–I1.13)`, because the
figure guard reads `2.11` and `1.13` as figures. I reworded both comments in words and re-ran:
`OK source guards`.

### 15
```
OK scope
```

### 16
```
OK existing tests untouched, census exact
```

### 17
I backed up every changed and untracked file to a tar archive first and ran the command as
`bash <file>`. Afterwards I extracted the archive to a fresh directory and compared it with the tree
using `cmp`: `cmp differences: 0`.
```
ok 13 scenarios fail as required
OK due tests fail on today's sources
ok 10 scenarios fail as required
ok 10 scenarios fail as required
ok 4 scenarios fail as required
ok 3 scenarios fail as required
OK stubs fail every scenario
OK tree restored
```
Each `ok` line means the command's `check` found every named title exactly once, `failed`, with a
failure message that matched none of the setup-error patterns:
- Part A: T42d-I1.1 to I1.13.
- Part B1 routes: T42d-I2 to I11.
- Part B1 rules and reader: T42d-U1.1, U1.4, U2.1, U2.2, U2.5, U2.8, U3, U4, U5, U6.
- Part B2: T42d-U7 to U10.
- Part B3: T42d-U11 to U13.

The checksum line is `OK tree restored`.

### 18
```
✓ Compiled successfully in 3.9s
├ ƒ /api/v1/loyalty/memberships/[id]/screenshot
├ ƒ /api/v1/loyalty/memberships/[id]/screenshot/confirm
exit=0
```

### 19
```
OK spec has no money-looking text
```

## The due-rule table, observed

T is 45. Ages are days before Postgres `CURRENT_DATE`.
- The today column is the command 8 run on this tree.
- The Part A column is command 17 Part A, run on `loyaltyInboxRead.ts` as it was at HEAD.

| Scenario | Reading age | Sender domain / coverage / last seen | Decision | Today | Part A |
|---|---|---|---|---|---|
| T42d-I1.1 | 46 | none | due | PASS | failed (assertion) |
| T42d-I1.2 | 45 (control 46) | none | not due (control due) | PASS | failed (assertion) |
| T42d-I1.3 | no reading | none | due | PASS | failed (assertion) |
| T42d-I1.4 | 200 (control 200, no domain) | yes / `yes` / 3 | not due (control due) | PASS | failed (assertion) |
| T42d-I1.5 | 100 | yes / `yes` / 46 | due | PASS | failed (assertion) |
| T42d-I1.6 | 100 (control 100, seen 46) | yes / `yes` / 45 | not due (control due) | PASS | failed (assertion) |
| T42d-I1.7 | 46 | yes / `no` / 3 | due | PASS | failed (assertion) |
| T42d-I1.8 | 10 (control 46) | yes / `no` / 3 | not due (control due) | PASS | failed (assertion) |
| T42d-I1.9 | 46 | yes / `not_read` / 3 | due | PASS | failed (assertion) |
| T42d-I1.10 | 100 | yes / `yes` / null | due | PASS | failed (assertion) |
| T42d-I1.11 | 46 and 3, one program | none | only the 46 due | PASS | failed (assertion) |
| T42d-I1.12 | 46 | three domains (46, 47, null) | listed once | PASS | failed (assertion) |
| T42d-I1.13 | the world above, plus a reading dated tomorrow and an older one recorded last | mixed | ascending, the same for both users, agrees with coverage, tomorrow not due | PASS | failed (assertion) |

## The disagreement table, observed (T42d-I6)

Every case answered HTTP 200. Every public table's row count was unchanged afterwards.

| Read differs in | programCheck | suffixCheck | unitCheck |
|---|---|---|---|
| program only | mismatch | match | match |
| suffix only | match | mismatch | match |
| unit only | match | match | mismatch |
| all three | mismatch | mismatch | mismatch |
| nothing stated | not_stated | not_stated | not_stated |
| membership with no stored number | match | not_stated | match |

## Mutation evidence (command 20)

I applied each mutation as one textual change, ran the named file, and confirmed that the named
scenario failed. I then restored the file and re-ran the file green. Runner output is verbatim. After
the last revert, the tree matched the backup archive (`cmp differences: 0`).

| Id | File and change | Failing scenario | Result | After |
|---|---|---|---|---|
| M1 | `lib/domain/loyaltyScreenshot.ts`: domain: an equal as-of treated as recorded-only | T42d-U1.3 | FAIL | reverted, green |
| M2 | `lib/domain/loyaltyScreenshot.ts`: domain: every confirmed reading made current | T42d-U1.4 | FAIL | reverted, green |
| M3 | `lib/loyaltyInboxRead.ts`: panel SQL: the age boundary turned into >= | T42d-I1.2 | FAIL | reverted, green |
| M4 | `lib/loyaltyInboxRead.ts`: panel SQL: coverage ignored (never yes) | T42d-I1.4 | FAIL | reverted, green |
| M5 | `lib/loyaltyInboxRead.ts`: panel SQL: last-seen ignored | T42d-I1.5 | FAIL | reverted, green |
| M6 | `lib/loyaltyInboxRead.ts`: panel SQL: the no-observation case dropped | T42d-I1.3 | FAIL | reverted, green |
| M7 | `lib/loyaltyInboxRead.ts`: panel SQL: a JOIN on sender domains repeats an id | T42d-I1.12 | FAIL | reverted, green |
| M8 | `lib/loyaltyInboxRead.ts`: panel SQL: the list emitted descending | T42d-I1.13 | FAIL | reverted, green |
| M9 | `lib/loyaltyStore.ts`: store: the confirmed row written as typed | T42d-I10 | FAIL | reverted, green |
| M10 | `app/api/v1/loyalty/memberships/[id]/screenshot/confirm/route.ts`: confirm route: a body carrying source accepted (typed schema) | T42d-I9 | FAIL | reverted, green |
| M11 | `app/api/v1/loyalty/memberships/[id]/screenshot/route.ts`: read route: writes an observation | T42d-I8 | FAIL | reverted, green |
| M12 | `lib/loyaltyReader.ts`: reader: the image base64 logged on a failure | T42d-U5 | FAIL | reverted, green |
| M13 | `lib/loyaltyReader.ts`: reader: a third block added to the model request | T42d-U4 | FAIL | reverted, green |
| M14 | `lib/loyaltyReader.ts`: reader: maxRetries 0 removed from the request | T42d-U4 | FAIL | reverted, green |
| M15 | `app/api/v1/loyalty/memberships/[id]/screenshot/route.ts`: read route: the stored number emitted with the suffix | T42d-I5 | FAIL | reverted, green |
| M16 | `lib/domain/loyaltyScreenshot.ts`: domain: a program mismatch reported as a match | T42d-U2.2 | FAIL | reverted, green |
| M16b | `lib/domain/loyaltyScreenshot.ts`: domain: a program mismatch reported as a match (route level) | T42d-I6 | FAIL | reverted, green |
| M17 | `components/LoyaltyScreenshotCapture.tsx`: form: a mismatch blocks the save | T42d-U12 | FAIL | reverted, green |
| M18 | `app/api/v1/loyalty/memberships/[id]/screenshot/route.ts`: read route: the clean pass skipped | T42d-I5 | FAIL | reverted, green |
| M19 | `app/api/v1/loyalty/memberships/[id]/screenshot/route.ts`: read route: the body read before the caller | T42d-I2 | FAIL | reverted, green |
| M20 | `app/api/v1/loyalty/memberships/[id]/screenshot/route.ts`: read route: an oversize image accepted | T42d-I3 | FAIL | reverted, green |
| M21 | `components/LoyaltyScreenshotCapture.tsx`: form: the Save anyway gating removed | T42d-U12 | FAIL | reverted, green |
| M22 | `components/LoyaltyScreenshotCapture.tsx`: form: a missing balance pre-filled with 0 | T42d-U12 | FAIL | reverted, green |
| M23 | `lib/loyaltyInboxRead.ts`: panel SQL: a reading dated today no longer clears the prompt | T42d-I11 | FAIL | reverted, green |
| M24 | `lib/loyaltyInboxRead.ts`: panel SQL: last-row-wins instead of the reducer order | T42d-I1.13 | FAIL | reverted, green |
| M25 | `lib/loyaltyStore.ts`: store: the as-of future limit skipped for a screenshot | T42d-I9 | FAIL | reverted, green |

How some rows differ from the spec's M-list:
- M17: the server is stateless and holds no read to refuse against, so "refuse a mismatching confirm"
  can only exist in the form. It was therefore applied there and is caught by T42d-U12, not T42d-I6.
- M13 adds a request block rather than the program name. The reader is never given the name, so it
  cannot add it.
- M24 is caught by T42d-I1.13 (the older reading recorded last) rather than T42d-I11. In T42d-I11 the
  older confirm is itself past T, so it stays due under either order.

## Accepted residuals

1. The confirm route is stateless, so a client can write a `screenshot` row without a read. The label
   records provenance for the honest path and carries no extra trust, since typed entry can already
   write any value.
2. A membership of a program the inbox serves is not prompted, even if the mail never matches its own
   number. Forwarding health covers that case.
3. A screenshot that shows no date gets the device's calendar day in the form, and the person can
   change it.

## Other observations

- iCloud copies: `apps/web/.next/` contains `"<name> 2.json"` build-artifact copies, for example
  `build-manifest 2.json`, `required-server-files 2.json` and `next-server.js.nft 2.json`. They are
  reported here and not deleted. No such copy exists outside `.next` or `node_modules` in `apps/web`
  or `packages`.
- The throwaway DB holds no leftovers: `0,0,0,0,0` (ZQ42D programs, members, domains, triggers,
  functions) after every run.
- `npm run build` did not regenerate `AGENTS.md`; the working tree shows no change to it.

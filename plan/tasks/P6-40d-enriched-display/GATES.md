# GATES — P6-40d-enriched-display
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS | 2026-10-07 | Column names reconciled with P6-40b's frozen contract (identical). T1 unit baseline 1024; T2 `typescript` resolvable from apps/web. Baselines that make the commands discriminating: `next.config.ts` has 0 `images` entries (#6 would catch one); #7 `website` grep exit 1 today; #8 prints 0 today (no `authorized_date::text`) and turns 1 only with the cast; #3/#4 test files absent. `vitest.config.mts` includes `lib/**/*.test.ts` (AST wiring test lives there). Spec's own A8 assessment accepted: G1 skipped (no contract surface); **G3 stays blocking**, scoped to the logo privacy/robustness rules, because the browser now fetches third-party URLs. Implementation waits for P6-40b to merge (needs its columns). |
| G1 contract | SKIP | 2026-10-07 | No contract surface touched (#6 gates it). |
| G2 build | PASS | 2026-10-07 | Orchestrator re-ran in the implementer's worktree on commit 2575066 (parent 879ad00): #1 tsc exit 0; #2 lint exit 0; #3 `Tests 60 passed (60)`; #4 `Tests 11 passed (11)`; #5 `Test Files 72 passed`, `Tests 1108 passed (1108)`; #6 exit 0 vs 879ad00; #7 exit 1; #8 `[id]/page.tsx:1`, `transactions/page.tsx:1` (as the implementer notes, #8 is gated on the printed per-file counts, not the exit code). Browser evidence pending (G3/G4). |
| G3 adversarial | ACCEPT_WITH_NITS (conditional) + G4 browser defect → cycle 1 | 2026-10-07 | REVIEW-1: 24 hypotheses, 0 BLOCK; H9 INCONCLUSIVE and promotable to BLOCK (the mount-time `complete && naturalWidth===0` heuristic with `loading=lazy` could mark every off-screen logo dead if an engine reports a deferred lazy image as complete — WebKit not available here to settle it); wiring test inspects only `src` (srcSet/spread/style gap); #8 gated on printed counts. Reviewer's #6 base-anchored check run: `git diff --exit-code 879ad00 2575066 -- …` → exit 0. Rulings: mark inside the Merchant cell on Transactions accepted; slate palette correct. Orchestrator browser finding F1 (broken-image icon flashes). Cycle 1 removes the heuristic by construction (img invisible over the tile until `onLoad`), which settles F1 and H9 together without needing WebKit. |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle count:** 1 / 3

**Tier (A8):** G1 skipped; G3 blocking (outbound browser fetches of third-party logo URLs).
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|

## Orchestrator browser evidence (2026-10-07, preview DB `b8_p640d_preview` seeded from preview-seed.sql, commit 2575066 on :3640)
- Desktop account page: logo row, dead-URL row, no-logo, hostile `javascript:` and blank rows; every mark at the same box — measured `left 450, 28×28`, title text at `x=494` for all ten rows (img and tile alike). Detail lines present only where they say something; zero `null`/`undefined`/`Invalid` in page text.
- 390px (same-origin iframes): account page and Transactions `scrollWidth 388 = innerWidth 388`; 3 `<img>` each, all `referrerPolicy=no-referrer`; none for the `javascript:`/`http:`/blank rows.
- **DEFECT (G4 finding F1):** on the 390px account page the dead-host row showed the browser's **broken-image icon** for a moment before the fallback tile replaced it (screenshot ss_6475l2tl8; three seconds later the DOM held only the two loaded favicons). The spec's evidence item 4 forbids the icon. Cause (hypothesis, consistent with the observation): the `<img>` is visible while it loads, so the browser paints its own failure state before React's `onError` (or the mount-time check after hydration) swaps it out. Required: the image must never be visible until it has loaded (e.g. rendered transparent over the placeholder tile until `onLoad`), so a failure is never painted.

## Cycle 1 — orchestrator G2 + browser re-check (2026-10-07, commit 6166ed7)
G2 re-run in the worktree: #1 exit 0; #2 exit 0; #3 `60 passed`; #4 `15 passed`; #5 `1112 passed`; #6 exit 0 (879ad00..HEAD); #7 exit 1; #8 `1` / `1`.
Browser (Chrome, 390px same-origin iframes, compiled pages reloaded, frames at ~1 s, ~2 s, ~5 s): the dead-host row shows only its `D` tile in every frame on both pages — **F1 fixed**; the loading logo shows its tile first and the logo replaces it once loaded (`opacity` animating 0→1); after settling the dead image is present at `opacity 0`, `naturalWidth 0` — invisible; `scrollWidth 388 = innerWidth 388` on both pages. H9 removed by construction (no `naturalWidth === 0` path; WebKit still not available — the remaining risk is only "a logo that never loads shows its tile", which fails safe).

**G3 (cycle 1):** PASS — REVIEW-2 ACCEPT_WITH_NITS, 10 hypotheses, 0 BLOCK; H9 gone by construction; only the carried-over #8 exit-status note. One benign case noted, not raised: a viewBox-only SVG loaded before hydration in Gecko stays hidden behind its tile (Plaid logos are PNG).

**G4:** PASS 2026-10-07 on main after merging the branch over P6-40c's commit 0fe837f — `npm test` 72 files / 1112 passed; tsc exit 0; lint exit 0 (nested worktree excluded); `npm run build` compiled. Browser evidence: see the two orchestrator sections above.

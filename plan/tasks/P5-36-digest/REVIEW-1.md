# REVIEW-1 — P5-36-digest
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer · 2026-10-20

Persisted from the reviewer's final report, condensed: each hypothesis keeps its method and result. Every hypothesis was
tested by reading; the one item needing execution was run by the orchestrator (below).

## Falsification log
| # | Hypothesis | Result |
|---|---|---|
| 1 | A failing feed with a recent success (`fresh`) reads as working — the caveat branch says the feed is still failing; `caveatOf` needs kind, `failing` and `fresh`; D5 sweeps all states | REFUTED |
| 2 | `sync-stale`/`job-overdue` with `fresh` freshness get the generic sentence or a health word — `FAILURE_KINDS` branch first; no template has fresh/healthy/ok/recovered | REFUTED |
| 3 | `never`/`undated` printed with an age or as fresh — distinct sentences; fresh/stale with a null age throws and is unreachable under the contract | REFUTED |
| 4 | Undated inputs dropped from a stale/never sentence — appended for every state; D4 | REFUTED |
| 5 | Zero findings with a source missing reads `none-reported` — status rule matches the spec | REFUTED |
| 6 | Findings exist and sources are missing, gap hidden — headline says the list may be incomplete; coverage names each; D6 | REFUTED |
| 7 | All nine sources missing gives a misleading headline — "No source was evaluated" in both statements | REFUTED |
| 8 | An all-clear phrase is reachable in some template — every template listed against the spec's phrases; D7 sweeps | REFUTED |
| 9 | Money-looking text in a statement — only integers interpolated; D11 non-vacuous | REFUTED |
| 10 | A kind missing from READER_ORDER or a duplicate — import-time check covers both by inclusion plus equal length | REFUTED |
| 11 | Severity rank inverted or tie-break unstable — three explicit keys, position last; D2 | REFUTED |
| 12 | Loose period validation — contract `AsOfPeriodSchema`; mismatched finding dates throw; D3 | REFUTED |
| 13 | Loader producer arguments differ from the dashboard's — compared with `overviewRead.ts` and `dashboard/page.tsx`: identical at one instant | REFUTED |
| 14 | Duplicated sync query drifts from `SyncHealthCard` — same columns, filter, grouping; token never selected; L2 pins it | REFUTED |
| 15 | A failed source becomes an empty list or takes the page down — `attempt` returns undefined and logs; assembler marks it not evaluated | REFUTED |
| 16 | A failed facts read leaves findings `fresh` — no context → every finding undated; L5 | REFUTED |
| 17 | Ten parallel reads deadlock the pool — read paths use `db.query` only; overflow queues | REFUTED |
| 18 | Row text reaches the page — the view renders severity, kind label, subject name (category, account, institution), period, statement, producer money fields; not job message, overdraft bank or forecast charges; L4/L1 canaries. `numeric-only` is honest | REFUTED |
| 19 | The page skips the viewer or fails open — `pageViewer('/digest')`; the proxy's catch-all requires a session | REFUTED |
| 20 | The page is not thin — one clock read, no db import, no JSX comment before the root, money verbatim | REFUTED |
| 21 | W2 misses optional chaining — chain nodes are property/element access | REFUTED |
| 22 | W2 misses destructuring, `let`, method helpers, `Object.values`, same-name shadowing | CONFIRMED (N2) |
| 23 | W1 misses typed-literal clocks (`DATE 'today'`, `TIMESTAMP 'now'`, `TIMESTAMPTZ 'now'`) | CONFIRMED (N3) |
| 24 | L5 leaves a renamed table behind after a failure — restore in `finally` with `IF EXISTS`; self-heals; files not parallel | REFUTED (run below) |
| 25 | The new integration file leans on leftover rows — each world truncates and seeds what it reads | REFUTED |
| 26 | Unit tests depend on the wall clock or zone — fixed instants, fake timers, seeded permutation | REFUTED |
| 27 | L4 viewer invariance is vacuous — by design (Q4); the canary check is the real gate | REFUTED (by design) |
| 28 | Money-looking figures in new files or comments | REFUTED |
| 29 | Scope: undeclared file, or the email digest imported | REFUTED |

## Findings (all NIT)
- **N1 — `lib/domain/findingsDigest.ts` `headline`:** "N findings reported by 9 of 9 sources" credits every evaluated
  source with reporting, when perhaps one did. Not an all-clear, but it overstates; e.g. "N findings from the 9 of 9
  sources evaluated".
- **N2 — `lib/findingsWiring.test.ts` T36-W2:** not flagged — destructured consts, `let` tables, method-call helpers,
  `Object.values`/`.find` on a table, same-name const shadowing. Tree clean today.
- **N3 — `lib/findingsWiring.test.ts` `SQL_CLOCKS`:** misses typed-literal clock inputs.
- **N4 — `lib/findingsDigestRead.ts` comment:** claims a driver error names a relation or column, never a row; a cast
  failure includes the offending value. Server log only; reword.
- **N5 — `lib/findingsDigestRead.ts`:** `assembleFindings` sits outside `attempt`, so a conversion that throws takes the
  page down rather than marking that source not evaluated. Q5 covers read failures only.

## Scope violations
None.

## Inconclusive — run by the orchestrator
Block C twice back to back on `b8_p36_throwaway`, then the table check after each:
both `OK 252 integration tests, none failing except RC-03; T35-R1..R9 and T36-L1..L7 each present once and passed`;
`overdraft_forecasts|` both times (the hidden name absent).

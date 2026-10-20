# P5-35-finding-freshness — implementer evidence

Captured 2026-10-20 in the main tree (no worktree), uncommitted, under `bash`, without `rtk`. The
contract file `packages/contracts/findings.ts` was not edited in this session; its sha256 is
`6cd72690b4da6ad3511b8fa08316ae97a342a4e1d40e072734028dfe937b3440`, the frozen value.

## What this session changed (on top of the interrupted implementer's work)

- `apps/web/lib/domain/findingsFreshness.test.ts`: the `dated` fixture helper now returns
  `Extract<FreshnessInput, { state: 'fresh' | 'stale' }>` rather than the whole union, so T35-F2 can
  read `lastObserved` back without a cast. This fixed the one `tsc` error
  (`findingsFreshness.test.ts(336,112)`). No assertion changed; the contract was not touched.
- `apps/web/scripts/findings-freshness-read.test.ts`: new, scenarios T35-R1..R9 against
  `postgresql://localhost/b8_p35_throwaway`.
- `apps/web/vitest.integration.config.mts`: the new file added to `include` by exact path.

One convention decision to flag for review: the new integration file TRUNCATEs the tables the read
touches (`gift_transactions, gifts, accounts, budget_categories, sync_log CASCADE`) before each of its
two worlds and in `afterAll`, rather than tolerating other suites' leftovers as the two other
`scripts/` suites do. The read is global (every account, every item, the newest scheduler row of the
whole log), so a leftover row would change the facts under test. `app/api/v1/overview/route.test.ts`
already truncates the same way. The full integration run below stayed green with it in place.

## Acceptance commands

#1 `(cd apps/web && npx tsc --noEmit; echo "exit=$?")`
```
exit=0
```

#2 `npx tsc --noEmit; echo "exit=$?"`
```
exit=0
```

#3 `npm run lint; echo "exit=$?"` (tail)
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
Five warnings, the same as the baseline maximum; none is in a file this task touches.

#4 `npm test 2>&1 | tail -8`
```
 Test Files  92 passed (92)
      Tests  1296 passed (1296)
```
BASE was 91 files and 1276 tests: files are exactly BASE + 1, tests are BASE + 20.

#5 (scenario script, three zones; the `OK`/`FAIL` lines)
```
OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ=UTC
OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ=Pacific/Auckland
OK 54 unit scenarios (34 T34 + 20 T35) each present once and passed TZ=America/Los_Angeles
```

#6 (integration script)
```
OK 245 integration tests, none failing except RC-03; R1..R9 each present once and passed
```
IBASE was 236; 245 is IBASE + 9.

#7 (added-lines guard)
```
(no output; grep exit 1)
```

#8 (scope guard)
```
(no output from either half)
```

#9
```
 Test Files  2 passed (2)
      Tests  21 passed (21)
exit=0
UNMODIFIED
```

#10
```
rc=1
```
No file listed.

#11 `npm run build; echo "exit=$?"`
```
exit=0
```

## Mutation probes run by the implementer on the read module

Each applied to `apps/web/lib/findingsFreshnessRead.ts` alone, the new integration file run, then the
file restored from a copy; the file's sha256 was compared after the last restore and matched.

| Mutation | Result |
|---|---|
| M16 job judged from any `sync_log` row (the `trigger = 'scheduler'` filter removed) | T35-R4 failed; 1 failed, 8 passed |
| M8 contributor set includes hidden rows (`t.hidden = FALSE` replaced by `TRUE`) | T35-R7 failed; 1 failed, 8 passed |
| M7 contributor set built with a JOIN instead of EXISTS | T35-R7 failed; 1 failed, 8 passed |

The other mutations in SPEC.md (M1–M6, M9–M15, M17) were not run in this session; they are the
orchestrator's at G2/G3.

## Kind x input x state table and the jobHealth differential

Printed by the unit tests (T35-F1 and T35-F10) when `T35_PRINT=1` is set:
`(cd apps/web && T35_PRINT=1 npx vitest run lib/domain/findingsFreshness.test.ts --disableConsoleIntercept)`.
Names, enum values, day counts and pair counts only.

```
P5-35 kind x input x state
budget-breach | contributor item sync + feed, both 1 hour old -> fresh / sync / 0 days / undated 0
budget-breach | contributor item sync 20 days old -> stale / sync / 20 days / undated 0
budget-breach | contributor item never synced -> never / sync / undated 0
budget-breach | no contributing account -> undated / none / undated 1
budget-underspend | contributor item sync + feed, both 1 hour old -> fresh / sync / 0 days / undated 0
budget-underspend | contributor item sync 20 days old -> stale / sync / 20 days / undated 0
budget-underspend | contributor item never synced -> never / sync / undated 0
budget-underspend | no contributing account -> undated / none / undated 1
balance-drift | item sync + feed 1 hour old -> fresh / sync / 0 days / undated 0
balance-drift | item sync 5 days old -> stale / sync / 5 days / undated 0
balance-drift | item never synced -> never / sync / undated 0
balance-drift | account has no item record -> undated / sync / undated 1
feed-degraded | last success 1 hour old -> fresh / feed / 0 days / undated 0
feed-degraded | last success 40 hours old -> stale / feed / 1 days / undated 0
feed-degraded | failing, no success ever -> never / feed / undated 0
feed-degraded | last success later than now -> undated / feed / undated 1
sync-stale | item sync 1 hour old -> fresh / sync / 0 days / undated 0
sync-stale | item sync 3 days old -> stale / sync / 3 days / undated 0
sync-stale | item never synced -> never / sync / undated 0
sync-stale | no item record for the key -> undated / sync / undated 1
job-overdue | scheduled run 1 minute old -> fresh / job-run / 0 days / undated 0
job-overdue | scheduled run 5 days old -> stale / job-run / 5 days / undated 0
job-overdue | no scheduled run ever -> never / job-run / undated 0
job-overdue | scheduled run later than now -> undated / job-run / undated 1
cash-uncounted | counted 1 day ago -> fresh / cash-count / 1 days / undated 0
cash-uncounted | counted 40 days ago -> stale / cash-count / 40 days / undated 0
cash-uncounted | never counted -> never / cash-count / undated 0
cash-uncounted | wallet absent from the read -> undated / cash-count / undated 1
valuation-stale | valued 10 days before the as-of date -> fresh / valuation / 10 days / undated 0
valuation-stale | valued 120 days before the as-of date -> stale / valuation / 120 days / undated 0
valuation-stale | never valued -> never / valuation / undated 0
valuation-stale | malformed date (February 30) -> undated / valuation / undated 1
overdraft-open | open episode seen 1 hour ago -> fresh / overdraft-sighting / 0 days / undated 0
overdraft-open | open episode seen 4 days ago -> stale / overdraft-sighting / 4 days / undated 0
overdraft-open | episode closed since the producer read it -> undated / overdraft-sighting / undated 1
overdraft-forecast | open forecast projected 1 hour ago -> fresh / overdraft-projection / 0 days / undated 0
overdraft-forecast | open forecast projected 4 days ago -> stale / overdraft-projection / 4 days / undated 0
overdraft-forecast | forecast closed since the producer read it -> undated / overdraft-projection / undated 1
P5-35 jobHealth differential: 4046 past-or-equal pairs compared, 0 differed; 2688 future pairs all read as a run at now
skew case (run one hour after now, across midnight): before status late daysSince -1; after status fresh daysSince 0
```

## Note for the step-36 author

- Every `Finding` now carries `freshness`: `state` (`fresh | stale | never | undated`), `basis` (the
  worst input's kind), `lastObserved` (a `YYYY-MM-DD` date for a valuation, an ISO instant
  otherwise), `ageDays` and `undatedInputs`. Freshness never changes severity, order or existence.
- Thresholds are the producers' own constants, imported by name; the job is judged by `jobHealth`'s
  own verdict.
- `undated` means the database keeps no usable record: a manual-ledger account (no import date
  exists — open question Q1), a Plaid feed with neither a success nor a failure recorded, a budget
  category with no contributing account, an unsupplied context, an observation later than `now`, or
  a malformed date. It is never shown as fresh.
- Dispositions: N3 fixed in `jobHealth` (a future-dated run reads as a run at `now`; Q2). N2 (backup
  rehearsal mismatch, pending proposals) deferred and registered `excluded` in the inventory. The
  feed `unknown` state surfaces as an `undated` input, not as a new kind. No property subject (Q3).
  The `Unknown` bank substitution is unchanged, and freshness is never keyed by an institution name.

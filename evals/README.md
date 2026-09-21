# b8evals — golden-question eval harness

`ROADMAP.md` §5 step 14 (Month 4, "Python, for real").

The agent at `POST /api/v1/chat` picks a tool, calls it, and writes prose around the result.
Nothing tested any of that: the 759 unit tests cover `apps/web/lib/domain/`, which is pure functions with
fixed answers, and an agent has no fixed answer. Change a line of the system prompt and it might
start calling the wrong tool, or start guessing instead of declining — findable only by noticing
a wrong figure, weeks later, if at all.

This asks it a fixed set of questions whose answers are known in advance.

## The two things that make it work

**Tool correctness and answer correctness are graded separately.** An agent that calls
`get_top_merchants` when it should have called `get_monthly_spending` can still produce a sentence
with the right number in it; an agent that calls the right tool can describe the result badly.
Those are different bugs in different files. The report names which half failed.

**Majority of three, never unanimity.** One flaky model call is noise. A suite that goes red at
random gets ignored within a week; a suite that passes on any single good sample hides a
regression that fires half the time.

## Setup

```sh
cd evals
uv venv --python 3.12 .venv
uv pip install -e '.[dev]'
```

Mint a **read-only** token on the server (over SSH — there is no HTTP endpoint that mints one):

```sh
npm run tokens -- create "eval runner" --read
```

`/api/v1/chat` is in the app's `READ_SAFE_POSTS` set, so a read token may POST to it and can do
nothing else. A full-scope token buys nothing here.

```sh
export B8_EVAL_TOKEN='...'
export B8_BASE_URL='https://<machine>.tail368cae.ts.net'
```

## Running

```sh
.venv/bin/python -m b8evals list                  # the golden set, no requests
.venv/bin/python -m b8evals estimate              # what a run costs, before spending it
.venv/bin/python -m b8evals preflight             # is the database still the right one? (1 request)
.venv/bin/python -m b8evals run                   # 13 questions x 3 = 39 requests
.venv/bin/python -m b8evals run --filter refuse --repeats 1
.venv/bin/python -m b8evals run --json report.json
```

Exit code is 0 when every question passes by majority, 1 when any fails, 2 on a setup error.

**`run` performs the preflight first and refuses to spend anything if it fails.** That check exists
because of a specific failure: a wiped-but-populated database produces confident wrong *answers*
rather than errors, so every question fails and the report reads as a model regression. The harness
can distinguish "I could not ask" from "the answer was wrong"; it cannot distinguish "the answer was
wrong" from "you asked about the wrong data" — the preflight is what closes that gap, for the cost
of one non-model request. `--skip-preflight` exists and should not be used.

## Cost, and the ceiling it runs into

Each request may make up to five model calls, and the app refuses past **200 chat requests per
local-time day** (`apps/web/lib/rateLimit.ts`, `DAILY_CEILING`). A full run at 3 repeats is 39 requests,
just under 20% of the day's allowance. `run_suite` refuses to start a run that would exceed the
ceiling rather than dying halfway and spending it for nothing.

## The integration suite has its own database, and must keep it

Run the repo's integration suite against `b8_evals` and **it destroys this harness's fixtures.**
Two separate tests do it:

- `apps/web/app/api/v1/auth/bearer.test.ts:80` — `TRUNCATE auth_sessions, webauthn_credentials CASCADE`,
  which revokes the eval token mid-run. Every question then returns `401`.
- `apps/web/app/api/v1/overview/route.test.ts:54` — `TRUNCATE transactions, account_valuations,
  account_balances, budget_categories, accounts`, which deletes **every expected figure this
  harness asserts**. 515 transactions become 7 and June groceries becomes `0`.

Both happened on 2026-09-21, in that order, and the second cost two full runs before the cause was
found — the second run read as an 11-question code regression when it was an empty database.

So the integration suite gets **`b8_integration`**, never `b8_evals`:

```sh
psql -d postgres -c 'CREATE DATABASE b8_integration;'
DATABASE_URL="postgresql://$(whoami)@localhost:5432/b8_integration" npx node-pg-migrate up
cd apps/web && DATABASE_URL="postgresql://$(whoami)@localhost:5432/b8_integration" \
  npx vitest run --config vitest.integration.config.mts
```

Those tests seed everything they need, so an empty migrated database is the right substrate for
them and a fully seeded one is the wrong one. Rebuild `b8_evals` with the commands in
[`golden/README.md`](golden/README.md) if it is ever pointed at by mistake.

## Grader tests are free

```sh
.venv/bin/python -m pytest
```

32 tests, no network and no model. Every grading rule is pinned against a hand-written trace,
including a negative control for each — a rule with only positive cases passes for the wrong
reason. This is what makes the harness itself safe to change.

That is not hypothetical: the first run of these tests caught a regex in the grader that split
`1040.4` into `104` and `0.4`, which would have reported correct answers as wrong.

## The data

Questions are graded against a frozen seed database, not the real one, and every expected figure
is a constant derived by SQL once and checked in — never recomputed at run time by the code under
test. See [`golden/README.md`](golden/README.md) for the derivation queries, the figures, and the
measurement showing a completed month's figures are stable across seed dates.

## What this does not do yet

- **LLM-as-judge** for open-ended answers (`ROADMAP.md` §4). `budget-summary-overspend` currently
  asserts routing only, because its correct answer moves with the month. A rubric-scored judge is
  the way to grade it, and is Month 7 work.
- **CI wiring.** Running this on every change to `route.ts` needs a reachable server, a token in
  CI, and a real Anthropic spend per run. The grader tests run in CI today; the suite itself is
  run by hand.
- **The three tools §4's question set assumes.** `get_net_worth`, `get_property_pnl` and
  `get_asset_allocation` do not exist — `route.ts` has the original four. The multi-table
  questions Month 7 calls for cannot be written until they do. `refuse-asset-allocation` pins the
  current, correct behaviour in the meantime: decline rather than estimate.

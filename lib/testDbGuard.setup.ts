// The integration suite's setup, and it does exactly one thing.
//
// `vitest.integration.config.mts` names this file in `setupFiles`, which Vitest evaluates inside
// the worker BEFORE it loads the test module. That ordering is the whole point: the test module
// imports the route, the route imports `lib/overviewRead.ts`, and that file's transitive imports
// reach `lib/db.ts`, which constructs a `pg.Pool` at module scope. By the time any test body runs,
// a pool aimed at `$DATABASE_URL` already exists. The refusal therefore has to happen here, in a
// module that is evaluated first and imports nothing that opens a connection.
//
// It is the FIRST STATEMENT, not merely somewhere in the file, and it is not wrapped in a
// try/catch. SPEC.md's failure-mode list names both of the ways this wiring goes wrong — a call
// placed after the first seeding query, and a call whose throw is swallowed — and an
// import-presence check cannot tell either of them from a correct one. That is why the acceptance
// command for this is a live run against `postgresql://nobody@127.0.0.1:1/b8_finance` rather than
// a grep: port 1 guarantees no connection could have succeeded, so a non-zero exit that also
// prints the database name can only have come from a guard that actually fired.
//
// It reads `process.env.DATABASE_URL` rather than discrete `PGHOST`/`PGDATABASE` variables because
// that is the variable `lib/db.ts` itself builds the pool from. A guard checking a string nothing
// else consumes is a guard that never sees the name it exists to refuse.

import { assertScratchDatabase } from './testDbGuard';

assertScratchDatabase(process.env.DATABASE_URL ?? '');

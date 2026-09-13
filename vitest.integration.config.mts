import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The database-backed suite, and the only one in this repo that writes rows.
//
// SEPARATE FROM `vitest.config.mts` RATHER THAN FOLDED INTO IT. That file's header states the rule
// this repo lives by — unit tests only, every subject a pure function with no DB or network
// dependency — and it is what CI's `test` job runs. Keeping it DB-free is what keeps CI
// deterministic and runnable on a machine with no Postgres. The two configs are therefore
// DISJOINT: this one collects the route tests under `app/api/v1/`, the pure one keeps the
// directories it already collected, and neither reaches into the other's set. A widened glob here
// would silently re-run the pure fixtures under a DB-requiring config, and a pure test that never
// touched a database would start looking as though it had been verified against one.
//
// NOT WIRED INTO CI. Deferred deliberately: the orchestrator runs this command directly at the
// gates, the same way it already stands up a throwaway Postgres for the migration up/down/up check
// without that check living in CI's `test` job.
//
// THE SCRATCH-DATABASE GUARD IS WIRED THROUGH `setupFiles`, AND THAT PLACEMENT IS THE CONTROL.
// Vitest evaluates a setup file inside the worker BEFORE it loads the test module. The test module
// imports the route, the route imports the composition shell, and that import chain reaches
// `lib/db.ts`, which constructs a `pg.Pool` at module scope — so by the time any test body runs, a
// pool aimed at `$DATABASE_URL` already exists. Refusing from the setup file is what puts the
// refusal before the pool rather than after it. Measured: pointed at the real database name, the
// run reports `(0 test)` and `import 0ms`, meaning the route module was never even loaded.

export default defineConfig({
  resolve: {
    // `@/…` is how every file under `app/` imports, and Vitest registers no tsconfig-paths
    // resolver of its own. Declared here rather than rewriting the route's imports to relative
    // paths, so the route file reads the same as the 27 handlers beside it.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['app/api/v1/**/*.test.ts'],
    setupFiles: ['./lib/testDbGuard.setup.ts'],
    environment: 'node',
    // One scratch database, truncated and seeded by whoever is running. Files must not overlap in
    // time or they overwrite each other's fixtures — there is one file today, and this is what
    // keeps that from being a trap for the second one.
    fileParallelism: false,
  },
});

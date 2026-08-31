import { defineConfig } from 'vitest/config';

// Unit tests only, deliberately: everything under test here is a pure function with no DB
// or network dependency (see ROADMAP.md §2's testing priority order — tier 1 is exactly this).
// API-route contract tests against a test DB are tier 2 and need the migration story first.
//
// `.claude/hooks/**` is the one exception to "pure functions only": the scope-guard hook
// spawns itself as a child process against a temp repo. It runs here rather than behind a
// separate command because BUILD.md §13.2 makes it load-bearing — without the hook,
// single-writer contracts are aspirational — and a load-bearing guard that CI does not
// exercise is one nobody notices breaking.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'shared/**/*.test.ts', '.claude/hooks/**/*.test.mts'],
    environment: 'node',
  },
});

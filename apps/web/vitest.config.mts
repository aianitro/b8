import { fileURLToPath } from 'node:url';
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
  resolve: {
    // Vitest registers no tsconfig-paths resolver of its own, and after the workspace split
    // the contracts are a package rather than a folder under this one.
    alias: {
      // The SUBPATH mapping must come first. Vitest matches in order, so a bare '@b8/contracts'
      // entry would swallow '@b8/contracts/overview' and resolve it to `index.ts/overview`.
      '@b8/contracts/': fileURLToPath(new URL('../../packages/contracts/', import.meta.url)),
      '@b8/contracts': fileURLToPath(new URL('../../packages/contracts/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // `shared/**` became `packages/contracts/**` and `.claude/hooks` sits at the repo root, so
    // both are reached from here by relative path rather than by having moved into this package.
    include: [
      'lib/**/*.test.ts',
      '../../packages/contracts/**/*.test.ts',
      '../../.claude/hooks/**/*.test.mts',
    ],
    environment: 'node',
  },
});

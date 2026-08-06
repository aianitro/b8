import { defineConfig } from 'vitest/config';

// Unit tests only, deliberately: everything under test here is a pure function with no DB
// or network dependency (see ROADMAP.md §2's testing priority order — tier 1 is exactly this).
// API-route contract tests against a test DB are tier 2 and need the migration story first.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
  },
});

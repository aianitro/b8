import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore is this codebase's existing convention for "intentionally
    // unused" (e.g. a framework-required handler param, or a call-site-only documentation
    // arg) — honor it instead of flagging it.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // P1-10a: these are relative to the directory eslint RUNS IN, which is the repo root. The
    // `apps/web/` prefixes matter — without them eslint walks the build output. Measured: running
    // it from inside `apps/web` with the unprefixed patterns produced 27,941 problems, all of them
    // in `.next` and `node_modules`.
    ".next/**",
    "apps/web/.next/**",
    "apps/*/node_modules/**",
    "packages/*/node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "apps/web/next-env.d.ts",
    "evals/**",
  ]),
]);

export default eslintConfig;

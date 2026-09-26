# What Dependabot commit `20ea4ba` broke

*Investigation · September 2026 · b8*

Backlog item `[P1] Diagnose what Dependabot commit 20ea4ba broke`. Every claim below was run, not
reasoned about; the CI logs were still on GitHub and were read directly. Where the backlog item's
own premise turned out to be wrong, that is said.

---

## The one-line answer

**TypeScript `7.0.2` moved the compiler API out of the package's default entry point.** In TS 7 the
`typescript` package's `exports["."]` resolves to `./lib/version.cjs`, a two-line module that
exports `version` and `versionMajorMinor` and nothing else. Two test files in this repo do
`import ts from 'typescript'` and call `ts.createSourceFile` / `ts.ScriptTarget` — so they stopped
compiling and stopped running. The same TS 7 upgrade also trips a hard version guard inside
`typescript-eslint`, which `eslint-config-next` pulls in, so lint died too.

One package, three red jobs. Not eslint 10, not vitest 5 — those were innocent.

## Two corrections to the premise

**The failure never touched `main`.** `20ea4ba` is not an ancestor of `main`. It is the tip of
`origin/dependabot/npm_and_yarn/dev-dependencies-09ab06c914`, the branch behind PR #33. `main`'s
`package.json` still pins `eslint ^9`, `typescript ^5`, `@types/node ^20`, `dotenv ^17.4.2`,
`vitest ^4.1.10` — the pre-bump versions. The bump was never merged.

**The failure did not resolve.** PR #33 is still open and still red. CI ran twice on it and failed
both times with the same three jobs (`typecheck`, `lint`, `test`; `migrate` and `gitleaks` passed):

| run | when | result |
| --- | --- | --- |
| `35955906719` | 2026-09-24T04:30Z (PR opened) | typecheck, lint, test failed |
| `36002203052` | 2026-09-24T12:55Z (force-push to `20ea4ba`) | typecheck, lint, test failed |

So there is no mechanism by which the failure stopped, because it never stopped. What stopped was
anyone *looking* at it. That is the whole of the mystery: an open Dependabot PR is red, and nothing
in this project's workflow surfaces that, because the branch is not `main` and no deploy depends on
it.

Worth noting for the next bump: Dependabot closes the previous grouped PR when it opens a new one
(#20 → #31 → #32 → #33, each superseding the last, none merged). A red grouped dev-dependency PR
will keep being silently replaced by a new red grouped dev-dependency PR. The dice do not get
re-rolled; the same roll gets reprinted.

## What the bump actually contained

`20ea4ba` touched `package.json`, `apps/web/package.json`, `apps/mobile/package.json` and
`package-lock.json`. The lockfile was regenerated correctly and agrees with the manifests — no
lockfile inconsistency, no partial resolution. Seven direct dev dependencies:

| package | from | to |
| --- | --- | --- |
| `typescript` | 5.9.3 | 7.0.2 |
| `eslint` | 9.39.4 | 10.11.0 |
| `vitest` | 4.1.10 | 5.0.1 |
| `@types/node` | 20.19.43 | 26.6.2 |
| `dotenv` | 17.4.2 | 18.0.1 |
| `eslint-config-next` | 16.2.12 | 16.3.5 |
| `tsx` | 4.23.13 | 4.23.15 |

`apps/mobile` went `typescript ~6.0.3` → `~7.0.2`; it was already a major ahead of the root, which
is why TS 6 was never exercised by CI's root `tsc`.

## Reproduction

Checked `20ea4ba` out, `npm ci`, ran the three commands. It reproduces exactly — and deterministically,
which is the useful part: `npm ci` installs from the lockfile, and the installed tree matches the
lockfile as committed, package for package (`typescript 7.0.2`, `eslint 10.11.0`, `vitest 5.0.1`,
`dotenv 18.0.1`, `tsx 4.23.15`, `@types/node 26.6.2`). Nothing drifted between 09-24 and now, so
there is no transitive-resolution story to tell.

**`npx tsc --noEmit`** (both at the root, as CI runs it, and with `-p apps/web`) exits 1 with the
same errors in both cases — `TS2339` and `TS2694` against
`typeof import(".../node_modules/typescript/lib/version")`, in:

- `apps/web/lib/webauthnOrigins.test.ts` — `createSourceFile`, `ScriptTarget`, `Node`, `isIdentifier`, `forEachChild`
- `packages/contracts/index.test.ts` — the same, plus `isTypeAliasDeclaration`, `isInterfaceDeclaration`, `getCombinedModifierFlags`, `ModifierFlags`, `isPropertySignature`, and two `TS7006` implicit-`any` parameters that are downstream of the above

The error message names the cause precisely: the import resolved to `typescript/lib/version`.

**`cd apps/web && npx vitest run`** exits 1: 2 test files failed, 59 passed; 1 test failed, 930
passed. Both failures are `TypeError: Cannot read properties of undefined (reading 'Latest')` — the
runtime face of the same thing, `ts.ScriptTarget` being `undefined` so `.Latest` throws. Same two
files. `packages/contracts/index.test.ts` fails at import time (it builds its source file at module
scope), so it contributes 0 tests rather than a failed one.

**`npm run lint`** exits 2 before linting anything:

```
typescript-eslint does not support TS 7.0.
```

thrown from `node_modules/eslint-config-next/node_modules/typescript-eslint/dist/index.js`, loaded
by `eslint-config-next/dist/index.js`. A deliberate guard, not a crash.

The local run matches the CI log line for line, including the test counts.

## A red herring worth naming

`npm ci` emits a wall of `ERESOLVE overriding peer dependency` warnings about `eslint@10.11.0`
against `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react`, all of which
cap at `eslint ^9`. These are **warnings**; npm installed anyway and lint never got far enough to
care. Anyone skimming the log would land on eslint 10 as the culprit. It isn't — the eslint 10 peer
conflicts are real but latent, and would need handling separately *after* the TypeScript problem is
solved.

## What this implies

Only two files in the repo use the TypeScript compiler API, both tests, both asserting structural
properties of source files. TS 7 still ships that functionality, under
`typescript/unstable/ast` and friends (`./dist/ast/`), but the surface is renamed and explicitly
marked unstable. `typescript-eslint` does not support TS 7.0 at all yet — its own message points at
running against the TS 6 API and at the upstream tracking issue for TS >= 7.1.

So TypeScript 7 is blocked on something outside this repo, and the two test files are the smaller
half of the problem. No fix is attempted here; this note is diagnosis only.

The cheap durable win is unrelated to TypeScript: **nothing tells anyone when a Dependabot PR is
red.** That, not the compiler API, is why this sat unexplained for a day and would have sat longer.

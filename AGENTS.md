<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## No figures in commit messages or committed comments

A number that looks like money must not go into a commit message, a code comment, or any tracked
file. **This repository is public** (§0 of ROADMAP.md), and a reader cannot tell a figure from the
fabricated demo seed apart from one out of the owner's ledger — so every such figure reads as real
whether or not it is.

Write the finding, not the arithmetic:

- ✗ `the two disagreed by $<five figures>`
- ✓ `the two disagreed by roughly 40%` — or `by a wide margin; re-run against b8_evals to see it`

The first line above was itself written with the real figure in it, which would have reintroduced
the thing this rule removes. A policy against quoting figures cannot quote one as its example.

This was added on 2026-09-22 after figures from `b8_evals` reached a pushed commit message and had to
be scrubbed from public history — which a force-push cannot fully undo, since GitHub keeps the
objects reachable by SHA.

Two things stay allowed, because they are not money: version numbers and counts of things (tests,
files, lint problems). And `evals/golden/` keeps its expected figures — they are the fixtures, the
directory documents that they are fabricated, and the harness cannot work without them.

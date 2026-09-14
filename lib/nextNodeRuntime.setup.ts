// What `next start` does to the Node process before it loads any of the app's code, reproduced for
// the integration suite.
//
// WHY IT IS NEEDED. `proxy.test.ts` imports `next/experimental/testing/server` — the package Next
// ships for unit-testing a proxy's matcher — and that entry point reaches Next's server internals
// through CJS rather than through the `next/server` surface a route handler imports. One of those
// internals builds its async-storage instance at module scope and reads `globalThis.AsyncLocalStorage`
// to do it; when the global is absent it installs a fake whose every method throws
// `Invariant: AsyncLocalStorage accessed in runtime where it is not available`. Importing a route
// handler after that has happened fails at import time.
//
// WHY IT IS NOT A TEST-ONLY HACK. This is verbatim what Next's own Node bootstrap does —
// `node_modules/next/dist/server/node-environment-baseline.js` opens with the same guard and the
// same assignment, under the comment "expose AsyncLocalStorage on global for react usage if it
// isn't already provided by the environment". A test process that has not run it is a Node process
// Next would never have handed a request to; installing it makes the suite's runtime the one the
// server actually has, rather than papering over a difference.
//
// The three lines are written out here rather than imported from that path, because it is an
// internal module with no stability guarantee and this file would break on a rename in a way that
// looked like an authentication failure.

import { AsyncLocalStorage } from 'node:async_hooks';

const runtimeGlobals = globalThis as typeof globalThis & { AsyncLocalStorage?: unknown };
if (typeof runtimeGlobals.AsyncLocalStorage !== 'function') {
  runtimeGlobals.AsyncLocalStorage = AsyncLocalStorage;
}

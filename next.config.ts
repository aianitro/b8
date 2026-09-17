import type { NextConfig } from "next";

/**
 * The eleven top-level API segments that moved under `/api/v1/` in P1-10b.
 *
 * ENUMERATED, NOT A WILDCARD. `/api/:path*` would also match `/api/v1/...` and rewrite it onto
 * itself, and the negative-lookahead spelling that avoids that is a regex nobody reading this file
 * six months from now would be certain about. A list cannot loop: `v1` is not in it, so a request
 * that has already been rewritten cannot match a second time.
 *
 * It is also the honest inventory. Adding a new endpoint means adding it at `/api/v1/` and NOT
 * touching this list — the list is a record of what used to live somewhere else, and it only ever
 * shrinks, as the web UI stops calling the old paths.
 */
const MIGRATED_SEGMENTS = [
  'accounts', 'budget', 'categories', 'chat', 'import', 'plaid',
  'properties', 'rules', 'sync', 'transactions', 'transfers',
] as const;

const nextConfig: NextConfig = {
  // Pruned server output (just the traced node_modules subset + server.js) instead of the
  // full node_modules tree, so the Docker runtime image (Dockerfile) stays small.
  output: 'standalone',

  /**
   * The old paths keep working while the UI is switched over, which is what ROADMAP.md step 10
   * means by "old routes proxying".
   *
   * A REWRITE AND NOT A REDIRECT. A redirect changes the URL the client sees and, on a 307, makes
   * every caller do two round trips; worse, a browser `fetch` that follows a redirect on a POST is
   * a place where method and body handling has historically gone wrong. A rewrite is internal —
   * same request, same method, same body, resolved to a different file.
   *
   * `proxy.ts` runs BEFORE this, on the original path, so the auth boundary is unaffected either
   * way: both the old path and the new one require a session, and the five pre-auth surfaces all
   * live under `/api/v1/auth/` already and never moved.
   */
  async rewrites() {
    return [
      {
        source: `/api/:segment(${MIGRATED_SEGMENTS.join('|')})/:rest*`,
        destination: '/api/v1/:segment/:rest*',
      },
    ];
  },
};

export default nextConfig;

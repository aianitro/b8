import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * The connection pool, created on first use rather than on import.
 *
 * ─── Why this is lazy, which is not a performance decision ────────────────────────────────────
 *
 * This module used to read `DATABASE_URL` at module scope and throw if it was absent. That is a
 * good rule enforced in a bad place: `next build` IMPORTS every route module to collect page data,
 * so a module that throws on import cannot be built without a database in the environment. On the
 * laptop that was invisible, because Next loads `.env.local` during a build. Inside Docker it is
 * fatal — `.dockerignore` excludes `.env*`, correctly, so the builder stage has no connection
 * string and the build died on the first route importing this file.
 *
 * The check is not weakened, only moved. There is no configuration in which a query now succeeds
 * that used to fail; the difference is exactly the window between importing this module and asking
 * it for something, which is the window a build occupies and a running server does not.
 *
 * ─── One pool, and never one per call ─────────────────────────────────────────────────────────
 *
 * `pg` pools hold sockets. Creating one per request exhausts Postgres's connection limit under any
 * load at all, so the instance is cached in module scope and every accessor goes through `pool()`.
 */
let cached: Pool | null = null;

function pool(): Pool {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // The same message the old module-scope throw used, so an operator searching for it still
    // finds the same string in the same situation — just at first query rather than at import.
    throw new Error('DATABASE_URL environment variable is not set');
  }

  cached = new Pool({ connectionString });
  return cached;
}

/**
 * The surface the app actually uses — `query`, `connect`, `end` — and nothing else.
 *
 * A narrow object rather than re-exporting the `Pool`, because the point of this file is that the
 * pool does not exist yet. Handing out the real instance would mean constructing it to hand it out.
 * The three methods below are every `db.*` call in the codebase; a fourth is a deliberate addition,
 * not an accident.
 */
const db = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>> {
    return pool().query<R>(text, values);
  },

  connect(): Promise<PoolClient> {
    return pool().connect();
  },

  /**
   * Closes the pool if one was ever opened.
   *
   * Tolerates never having connected, because scripts call this in a `finally` and a teardown that
   * throws when the body already failed replaces the real error with a confusing one.
   */
  async end(): Promise<void> {
    if (!cached) return;
    const open = cached;
    cached = null;
    await open.end();
  },
};

export default db;

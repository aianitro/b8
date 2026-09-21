// A refusal, not a convention: the name of the database a seeding test suite is about to write to.
//
// WHY THIS FILE EXISTS AT ALL. The integration suite for `GET /api/v1/overview` inserts fixtures —
// a hidden transaction, a capital category, a refund, two accounts sharing a Plaid item, a seeded
// balance disagreement. Every one of those is a write. On a machine set up per README.md the
// `DATABASE_URL` in `.env.local` resolves to `postgresql://…@localhost:5432/b8_finance`, and
// `docker-compose.yml`'s `db` service binds the SAME port with the SAME `POSTGRES_DB`, so a
// connection string cannot be told apart from the owner's real financial records by host, port or
// name. `scripts/seed-demo.mjs` already settled this question once for demo data — it refuses to
// run without `--yes-wipe-my-database`, "because the `DATABASE_URL` in `.env.local` is normally the
// real database" — and this is that refusal, for a test runner instead of a script.
//
// A spec that only TELLS an implementer to use a throwaway has not made a throwaway mandatory. The
// difference between an instruction and a control is that a control fires on a typo.
//
// IT READS THE FIELD `pg` READS, which is the substance of the thing and not a detail. A guard that
// inspects a connection string is only as good as its agreement with the client that will connect
// through the same string — so it reads the path for the two schemes where `pg` reads the path, and
// refuses every scheme where `pg` reads something else. G3 found the gap: see READABLE_PROTOCOLS.
//
// PURE, AND DELIBERATELY STRING-ONLY. It inspects a connection string and nothing else: no `pg`,
// no `Pool`, no `Client`, no DNS, no socket. That is what lets the integration setup call it as its
// first statement, before any pool is constructed, so the refusal never depends on a connection
// attempt having succeeded or failed first. A guard that only fires once a client exists is a guard
// that has already let the suite reach a server.

/**
 * The database name this repo treats as the owner's real financial data.
 *
 * A DENYLIST OF ONE, and its limits are worth stating rather than discovering. This is the exact
 * name `.env.local` resolves to and the exact name `docker-compose.yml` gives its `db` service on
 * this machine, so it closes the measured hazard. It is nonetheless a proxy for "is this the real
 * database": a production clone called something else passes it. An allowlist was considered and
 * refused for having the opposite failure mode — it blocks a legitimately named scratch database,
 * and a guard that stops work is a guard somebody disables.
 */
export const REAL_DATABASE_NAME = 'b8_finance';

/**
 * The two URL schemes this guard will read a database name out of.
 *
 * THIS SET IS THE CONJUNCT THAT CLOSES A REAL HOLE, found at G3, and it is worth the paragraph
 * because the hole was not "the guard failed open" — it was "the guard answered confidently and
 * wrongly." `pg` accepts a `socket:` connection string and takes the database from the **`db` query
 * parameter**, not from the path. Measured through `pg`'s own parser, parsing only, no connection:
 *
 *     pg-connection-string.parse('socket:/var/run/postgresql?db=b8_finance')
 *       → { host: '/var/run/postgresql', database: 'b8_finance' }
 *     new URL(same).pathname
 *       → '/var/run/postgresql'
 *
 * So a path-reading guard handed that string reports the database as `var/run/postgresql`, finds it
 * is not the real one, and approves — after which the suite's `beforeAll` truncates the real ledger.
 * Restricting the scheme is the one-line closure, and it is the set this file's own comments already
 * claimed to handle.
 *
 * `new URL` lower-cases the scheme, so `PostgreSQL://…` is covered without a second comparison.
 *
 * Everything else is REFUSED rather than special-cased, including `socket:`. Refusal is the safe
 * direction and it avoids a second parser here that would have to stay in agreement with `pg`'s —
 * the integration suite is run with the URL form README.md documents, so the cost is nil. Reaching
 * for `pg-connection-string` itself and reading `.database` was considered and declined: it is a
 * transitive dependency of `pg` rather than a declared one, and `package.json` is outside this
 * task's surface, so importing it would make this control depend on a package nothing in this repo
 * has agreed to.
 */
const READABLE_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * The database name in a Postgres connection string, or `null` when there is not one to read.
 *
 * `new URL` handles every form this repo actually writes — `postgresql://localhost/name`,
 * `postgres://user:pw@host:5432/name?sslmode=require` — and the path is the database. Decoded,
 * because a name is percent-encoded in a URL and `b8%5Ffinance` is `b8_finance` to the server.
 *
 * IT RECOGNISES ONE SHAPE AND REFUSES EVERYTHING ELSE, which is the form this function settled into
 * after being caught twice trying to re-derive `pg`'s parser alongside it. The shape is
 * `postgres[ql]://<authority>/<database>` with no `host` query parameter — the only shape README.md,
 * `.env.local`, `docker-compose.yml` and this task's acceptance commands ever write. For that shape
 * there is exactly one reading and both parsers produce it, so an approved DATABASE NAME cannot
 * diverge from the name `pg` will connect to. Everything else returns `null`.
 *
 * THE CLAIM IS ABOUT THE NAME AND NOT THE ENDPOINT, stated exactly as strongly as it is proved.
 * This function reads no host and no port, so it cannot and does not say which SERVER the suite
 * will reach — two clusters on one machine can both hold a `b8_p111_throwaway`, and a name-checking
 * guard approves either. That is the denylist's known shape (see REAL_DATABASE_NAME): it refuses one
 * name, it does not certify a destination.
 *
 * Returns `null` rather than guessing when the string is not a URL at all (`libpq` also accepts
 * `host=… dbname=…` keyword form, which nothing here produces). The caller turns that into a
 * refusal, not into a pass: "I could not tell which database this is" and "this is a safe database"
 * are different answers, and only one of them is allowed to let a write through.
 */
/**
 * One reading of a connection string: a database name, or the reason there is not one.
 *
 * The `why` exists so a refusal can DIAGNOSE rather than merely refuse. The single message this
 * function's caller used to emit named one conjunct out of the several below, so an operator who
 * tripped a different one was told they had broken a rule they had not — and `pg`'s own documented
 * socket URI, `postgresql:///db?host=/var/run/postgresql`, is genuinely a `postgresql://` form
 * being told that only `postgresql://` forms are read. A guard that stops work while misdescribing
 * why is worse than one that stops work silently, because the operator's next move is to argue
 * with it.
 *
 * One definition, two views: `databaseNameFromUrl` is the predicate, this is the predicate plus its
 * reason, and the reasons are not re-derived anywhere else.
 */
type UrlReading = { name: string; why: null } | { name: null; why: string };

function readDatabaseName(url: string): UrlReading {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // `pg` also accepts libpq keyword form (`host=… dbname=…`) and a bare socket path, and resolves
    // a relative reference against `postgres://base`. This guard reads none of the three.
    return { name: null, why: 'it is not a URL' };
  }

  // CONJUNCT 1 — the scheme, checked FIRST, before anything is read out of the URL at all. See
  // READABLE_PROTOCOLS: for a `socket:` string the database is in a query parameter and the path is
  // the socket directory, so reading the path produces a confident wrong answer rather than no
  // answer. Any other scheme is refused on the same principle — this function may return a name or
  // it may return `null`, and it may not return a guess.
  //
  // THIS IS THE ONE CONJUNCT THAT STANDS BETWEEN AN APPROVAL AND A WRITE TODAY. Recorded plainly
  // because the other two are not, and an earlier revision of this file implied otherwise.
  if (!READABLE_PROTOCOLS.has(parsed.protocol)) {
    return {
      name: null,
      why: `its scheme is "${parsed.protocol}", and only postgres:// and postgresql:// are read`,
    };
  }

  // CONJUNCT 2 — the `//authority/database` form only. An opaque path (a `postgresql:` URL NOT
  // followed by a slash, which the URL Standard permits) is refused rather than read.
  //
  // WHAT THIS IS AND IS NOT. `pg-connection-string/index.js:66` takes the database with
  // `result.pathname.slice(1)`, dropping the first character UNCONDITIONALLY; an earlier revision
  // of this file read it with a slash-stripping expression, which drops it only when it IS a slash.
  // Measured:
  //
  //     'postgresql:_b8_finance'  → pg reads 'b8_finance', a slash-stripper reads '_b8_finance'
  //     'postgresql:b8_finance'   → pg reads '8_finance'
  //
  // The first line was a live hole — the guard approved and `pg` connected to the real ledger with
  // its host falling through to localhost, and `new Pool` on the scratch spelling really does open
  // a connection. But the READER below is now `.slice(1)`, so deleting this line would NOT reopen
  // that hole: the opaque form would be read exactly as `pg` reads it and refused on the name. What
  // this conjunct buys is FORWARD COMPATIBILITY, which is its real and sufficient justification:
  // `.slice(1)` is a latent defect on `pg`'s side rather than a specification — it reads
  // `postgresql:b8_finance` as the database `8_finance` — and the day `pg` makes that slice
  // slash-aware, a reader matching it diverges again in the UNSAFE direction. This conjunct means
  // the shape never reaches the reader at all, so that change cannot reach this guard.
  //
  // PINNED CONSEQUENCE, since the two available closures disagree about it:
  // `postgresql:_b8_p111_throwaway` is REFUSED here, not approved as `b8_p111_throwaway`. A fixture
  // holds that. The cost is nil — nothing in this repo writes an opaque form.
  if (!parsed.pathname.startsWith('/')) {
    return { name: null, why: 'its path is opaque — there is no "/" after the scheme' };
  }

  // CONJUNCT 3 — and no `host` query parameter, for the same reason one level further out. `pg`
  // lets that parameter change how the database itself is computed: when `config.host` is set from
  // the query string AND the URL's hostname is a percent-encoded socket path, `index.js:56-59`
  // PREPENDS the hostname to the pathname before slicing. Measured:
  //
  //     'postgresql://%2Fvar%2Frun/b8_finance?host=/tmp'
  //        → pg reads the database '%2Fvar%2Frun/b8_finance'
  //        → reading the path alone reads 'b8_finance'
  //
  // That divergence is in the over-refusing direction and cannot be made dangerous — the rewritten
  // path always begins `%2f`, so the sliced result always begins `2f` and can never be
  // `b8_finance`. Closed anyway, because a wrong answer in a safe direction is still the guess this
  // function's contract forbids.
  //
  // IT OVER-REFUSES A LEGITIMATE FORM, which is why the message says so rather than blaming the
  // scheme: `postgresql:///b8_p111_throwaway?host=/var/run/postgresql` is PostgreSQL's own
  // documented socket URI, `pg` reads its database correctly off the path, and this guard still
  // declines it. Deliberate — it recognises one shape rather than re-deriving `pg`'s parser — and
  // free, because nothing here writes it.
  if (parsed.searchParams.has('host')) {
    return {
      name: null,
      why: 'it carries a "host=" query parameter, which pg allows to rewrite the path the database '
        + 'is read out of',
    };
  }

  // `decodeURI`, not `decodeURIComponent`, because `decodeURI` is what `pg` itself applies to the
  // path (`config.database = decodeURI(pathname)`). The two agree on `%5F` → `_` and disagree on
  // `%2F`, and the guard has to read the name the same way the client that will connect reads it.
  let name: string;
  try {
    name = decodeURI(parsed.pathname.slice(1));
  } catch {
    return { name: null, why: 'its path contains a malformed percent-escape' };
  }
  return name === '' ? { name: null, why: 'it names no database after the host' } : { name, why: null };
}

export function databaseNameFromUrl(url: string): string | null {
  return readDatabaseName(url).name;
}

/**
 * Throws unless `url` names a database that is demonstrably not the real one.
 *
 * Three refusals, in the order a caller hits them:
 *   1. an empty string — `DATABASE_URL` unset, which would otherwise let `lib/db.ts`'s own throw be
 *      the first thing that notices, one import too late to be reassuring;
 *   2. a string whose database name cannot be read — see `databaseNameFromUrl` on why unreadable is
 *      refused rather than waved through;
 *   3. the real database's name.
 *
 * Compared case-insensitively. Postgres folds an unquoted identifier to lower case, so `B8_Finance`
 * typed at a shell reaches the same cluster database as `b8_finance`, and a guard that matched only
 * the exact bytes would be defeated by a shift key.
 *
 * THE MESSAGE NAMES THE DATABASE. An operator who hits this needs to know which name was refused —
 * and the task's own acceptance check greps for it, because a non-zero exit alone cannot
 * distinguish "the guard fired" from "the suite failed for some other reason".
 *
 * Returns the database name so a caller may log it. It never returns for the real one.
 */
export function assertScratchDatabase(url: string): string {
  if (url === '') {
    throw new Error(
      'DATABASE_URL is not set. The integration suite writes fixtures, so it refuses to run '
      + `without a connection string it can check against "${REAL_DATABASE_NAME}". Point it at a `
      + 'scratch database: DATABASE_URL=postgresql://localhost/b8_p111_throwaway',
    );
  }

  const reading = readDatabaseName(url);
  if (reading.name === null) {
    // The diagnosis is the branch's own, not a blanket one. Naming the wrong conjunct sends an
    // operator to fix a rule they did not break — see `readDatabaseName`'s docblock.
    throw new Error(
      'DATABASE_URL does not name a database this guard can read, so it cannot prove the target is '
      + `not "${REAL_DATABASE_NAME}": ${reading.why}. This guard reads one shape — `
      + 'postgres[ql]://<host>/<database>, with no host= parameter. Use the form README.md '
      + 'documents: DATABASE_URL=postgresql://localhost/b8_p111_throwaway',
    );
  }
  const name = reading.name;

  if (name.toLowerCase() === REAL_DATABASE_NAME) {
    throw new Error(
      `Refusing to run the integration suite against the database named "${name}". `
      + `"${REAL_DATABASE_NAME}" is what .env.local's DATABASE_URL and docker-compose.yml's db `
      + 'service both resolve to on a machine set up per README.md, and this suite SEEDS rows. '
      + 'Create a scratch database instead: createdb b8_p111_throwaway && '
      + 'DATABASE_URL=postgresql://localhost/b8_p111_throwaway npx node-pg-migrate up',
    );
  }

  return name;
}

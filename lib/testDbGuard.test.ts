// The scratch-database guard's own edges — the parsing, and what it does when the string is not
// something it can read.
//
// WHY THE TWO DIRECTIONAL PROOFS ARE NOT HERE. SPEC.md pins the "refuses b8_finance" and "does not
// refuse a scratch name" fixtures to the file its ⟨P⟩ abbreviation runs, which is
// `lib/overviewRead.test.ts`, so they live there beside the payload fixtures they protect. This
// file covers what those two do not: how a database name is recovered from each connection-string
// form this repo writes, and the deliberate decision to refuse a string the guard cannot read.
//
// No database, no `pg`, no network. Every value below is a fabricated connection string.

import { describe, expect, it } from 'vitest';
import { assertScratchDatabase, databaseNameFromUrl, REAL_DATABASE_NAME } from './testDbGuard';

describe('databaseNameFromUrl', () => {
  it('reads the database out of every connection-string form this repo writes', () => {
    // The forms that actually appear: README.md's scratch pattern, `.env.local`'s credentialed
    // URL, and a URL carrying libpq parameters after the name.
    expect(databaseNameFromUrl('postgresql://localhost/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(databaseNameFromUrl('postgresql://b8:secret@localhost:5432/b8_scratch')).toBe('b8_scratch');
    expect(databaseNameFromUrl('postgres://localhost:5433/b8_scratch?sslmode=require')).toBe('b8_scratch');
    // Percent-encoded, because `b8%5Ffinance` is `b8_finance` to the server and a guard comparing
    // the raw path would not notice.
    expect(databaseNameFromUrl('postgresql://localhost/b8%5Ffinance')).toBe('b8_finance');
  });

  it('refuses to read a socket: URL in either direction, because pg takes its database from the query string', () => {
    // The G3 finding, measured through `pg`'s own parser rather than reasoned about:
    //
    //   pg-connection-string.parse('socket:/var/run/postgresql?db=b8_finance')
    //     -> { host: '/var/run/postgresql', database: 'b8_finance' }
    //   new URL(same).pathname
    //     -> '/var/run/postgresql'
    //
    // `pg` reads the `db` query parameter; a path-reading guard reads the socket directory. So the
    // old code returned `var/run/postgresql`, which is a confident WRONG answer — the one thing this
    // function's contract forbids — and approved a write to the real ledger.
    expect(databaseNameFromUrl('socket:/var/run/postgresql?db=b8_finance')).toBeNull();
    // BOTH DIRECTIONS: a safe name behind the same scheme is refused too. The guard is not trying to
    // decide whether this particular socket URL is dangerous; it is declining to read a field it
    // would read incorrectly.
    expect(databaseNameFromUrl('socket:/var/run/postgresql?db=b8_p111_throwaway')).toBeNull();
    expect(() => assertScratchDatabase('socket:/var/run/postgresql?db=b8_finance')).toThrow(/cannot prove/);
    expect(() => assertScratchDatabase('socket:/var/run/postgresql?db=b8_p111_throwaway')).toThrow(/cannot prove/);

    // Every other scheme `new URL` happens to accept, on the same rule. `http:` and `file:` are the
    // two that would otherwise parse cleanly and hand back a path segment that looks like a database
    // name — and for those `pg` would in fact read the path, so reading it here is not wrong, merely
    // unearned. Refused anyway: a scheme this app never writes is not a scheme this guard should be
    // the first thing to start interpreting.
    expect(databaseNameFromUrl('http://localhost/b8_finance')).toBeNull();
    expect(databaseNameFromUrl('file:///b8_finance')).toBeNull();

    // And the scheme comparison is case-insensitive for free, because `new URL` lower-cases it.
    expect(databaseNameFromUrl('PostgreSQL://localhost/b8_scratch')).toBe('b8_scratch');
    expect(() => assertScratchDatabase('POSTGRES://localhost/b8_finance')).toThrow(/Refusing to run/);
  });

  it('refuses an opaque path, where pg drops the first character of the name and a slash-stripper does not', () => {
    // The G3 cycle-2 finding. `pg-connection-string/index.js:66` reads the database with
    // `result.pathname.slice(1)` — the first character goes UNCONDITIONALLY. A slash-stripping
    // expression drops it only when it IS a slash, so the two agree for every `//authority/db` URL
    // and diverge for every opaque one:
    //
    //     'postgresql:_b8_finance' → pg 'b8_finance', slash-stripper '_b8_finance' → APPROVED
    //
    // and the coordinator's `new Pool(...).query('select current_database()')` on the scratch
    // spelling connected, so the form is live rather than theoretical.
    expect(databaseNameFromUrl('postgresql:_b8_finance')).toBeNull();
    expect(() => assertScratchDatabase('postgresql:_b8_finance')).toThrow(/cannot prove/);
    expect(() => assertScratchDatabase('postgres:_b8_finance')).toThrow(/cannot prove/);

    // BOTH DIRECTIONS, and this case is the one where the two available closures disagree. Copying
    // `pg`'s `.slice(1)` would have APPROVED this as `b8_p111_throwaway`. Refusing is what shipped,
    // so it is refused — pinned here so the choice cannot be reversed silently.
    expect(databaseNameFromUrl('postgresql:_b8_p111_throwaway')).toBeNull();
    expect(() => assertScratchDatabase('postgresql:_b8_p111_throwaway')).toThrow(/cannot prove/);

    // And the reason `.slice(1)` was not copied, stated as a value: `pg` reads this string as the
    // database `8_finance`. That is a defect on its side, not a specification, and a copy of it
    // would have to keep matching a defect forever.
    expect(databaseNameFromUrl('postgresql:b8_finance')).toBeNull();

    // The `//authority` form it is being distinguished FROM still reads, so the conjunct refuses a
    // shape rather than everything.
    expect(databaseNameFromUrl('postgresql://localhost/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(databaseNameFromUrl('postgresql:///b8_p111_throwaway')).toBe('b8_p111_throwaway');
  });

  it('refuses a host query parameter, which pg lets rewrite the path the database is sliced out of', () => {
    // The second divergence found while re-auditing every remaining expression against `pg`, rather
    // than waiting to be told about it. When `config.host` comes from the query string AND the
    // hostname is a percent-encoded socket path, `index.js:56-59` PREPENDS the hostname to the
    // pathname before slicing:
    //
    //     'postgresql://%2Fvar%2Frun/b8_finance?host=/tmp'
    //        → pg reads '%2Fvar%2Frun/b8_finance'; the path alone reads 'b8_finance'
    //
    // Over-refusing in that direction, and it cannot be made dangerous — the rewritten path always
    // begins '%2f', so the slice always begins '2f' and can never be 'b8_finance'. Closed anyway: a
    // wrong answer in a safe direction is still a guess, and nothing in this repo writes the form.
    expect(databaseNameFromUrl('postgresql://%2Fvar%2Frun/b8_finance?host=/tmp')).toBeNull();
    expect(databaseNameFromUrl('postgresql://localhost/b8_p111_throwaway?host=/tmp')).toBeNull();
    // Other query parameters are untouched — this refuses one parameter, not a query string.
    expect(databaseNameFromUrl('postgresql://localhost/b8_p111_throwaway?sslmode=require')).toBe('b8_p111_throwaway');
  });

  it('returns null rather than guessing when there is no database name to read', () => {
    // `null` is not "safe": the caller turns it into a refusal. Recorded as its own fixture because
    // the opposite choice — treating an unreadable string as a pass — is the quiet way a control
    // like this stops controlling anything.
    expect(databaseNameFromUrl('')).toBeNull();
    expect(databaseNameFromUrl('postgresql://localhost')).toBeNull();
    expect(databaseNameFromUrl('postgresql://localhost/')).toBeNull();
    // libpq's keyword form. Nothing in this repo produces it, and this guard does not parse it.
    expect(databaseNameFromUrl('host=localhost port=5432 dbname=b8_finance')).toBeNull();
    // `pg`'s OTHER non-URL form: a string beginning with `/` is read as
    // `{ host, database }` split on a space. `new URL` rejects it outright, so it is refused — the
    // right answer by the right accident, pinned here so a future change to the parsing cannot
    // silently start approving it.
    expect(databaseNameFromUrl('/var/run/postgresql b8_finance')).toBeNull();
    // A relative reference. `pg` resolves these against `postgres://base`, so a bare `b8_finance`
    // really does reach that database; `new URL` with no base throws, and refusal is correct.
    expect(databaseNameFromUrl('b8_finance')).toBeNull();
  });
});

describe('databaseNameFromUrl, the bracketed-host form this machine actually resolves over', () => {
  it('approves an IPv6 literal in brackets, which is the form the scratch database resolves over', () => {
    // EVIDENCE.md §8 records `psql "postgresql://localhost/b8_p111_throwaway"` reporting
    // `inet_server_addr()` as `::1`, so this is not an exotic shape — it is this repo's own host,
    // written the way a URL has to write it. An over-refusal here would be found by an operator
    // rather than by a test, which is the worst way to find one, and none of the three conjuncts
    // has any business rejecting it: the scheme is allowed, the path starts with `/`, there is no
    // `host=` parameter.
    expect(databaseNameFromUrl('postgresql://[::1]:5432/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(databaseNameFromUrl('postgresql://[::1]/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(assertScratchDatabase('postgresql://[::1]:5432/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    // And the denylist still applies through the bracket form — the host is not what it reads.
    expect(() => assertScratchDatabase('postgresql://[::1]:5432/b8_finance')).toThrow(/Refusing to run/);
  });
});

describe('assertScratchDatabase, beyond the two directional proofs', () => {
  it('returns the database name it approved, so a caller can say where the fixtures landed', () => {
    expect(assertScratchDatabase('postgresql://localhost/b8_p111_throwaway')).toBe('b8_p111_throwaway');
    expect(REAL_DATABASE_NAME).toBe('b8_finance');
  });

  it('refuses a percent-encoded spelling of the real database, which a plain string compare would pass', () => {
    // The decode in `databaseNameFromUrl` is what makes this a refusal rather than a pass. Without
    // it the guard compares `b8%5Ffinance` against `b8_finance`, finds them different, and seeds
    // the owner's real ledger.
    expect(() => assertScratchDatabase('postgresql://localhost/b8%5Ffinance')).toThrow(/Refusing to run/);
  });

  it('names the scratch pattern in every refusal, so the message is actionable and not only correct', () => {
    // A guard that stops work without saying what to do instead is a guard somebody routes around.
    for (const url of ['', 'host=localhost dbname=x', 'postgresql://localhost/b8_finance']) {
      expect(() => assertScratchDatabase(url)).toThrow(/b8_p111_throwaway/);
    }
  });

  it('diagnoses the conjunct the operator actually broke, one distinct phrase per branch', () => {
    // THE FIXTURE ABOVE IS NOT ENOUGH, and that is the point of this one. Every refusal message
    // interpolates both the real database name and the scratch pattern, so a matcher on either is
    // satisfied by all of them — the message could name the wrong rule and stay green. It did: a
    // single blanket sentence blamed the scheme for every unreadable form, so an operator handed
    // PostgreSQL's own documented socket URI was told that only `postgresql://` forms are read
    // while holding a `postgresql://` form. Being correct to refuse and wrong about why is how a
    // guard gets argued with instead of obeyed.
    //
    // Each branch is asserted on ITS OWN phrase, and on the absence of a neighbour's, so a
    // regression to one blanket message fails here rather than passing everywhere.
    const cases: [string, RegExp][] = [
      ['host=localhost dbname=b8_finance',                        /it is not a URL/],
      ['socket:/var/run/postgresql?db=b8_finance',                 /its scheme is "socket:"/],
      ['postgresql:_b8_finance',                                   /its path is opaque/],
      ['postgresql:///b8_p111_throwaway?host=/var/run/postgresql', /"host=" query parameter/],
      ['postgresql://localhost/',                                  /it names no database/],
    ];
    for (const [url, phrase] of cases) {
      expect(() => assertScratchDatabase(url)).toThrow(phrase);
      // Still actionable, still names what was being protected against.
      expect(() => assertScratchDatabase(url)).toThrow(/b8_p111_throwaway/);
    }

    // No branch borrows another's diagnosis. The socket case is the one that used to be told to
    // everybody, so it is the one worth asserting is no longer said to anybody else.
    for (const [url] of cases.filter(([u]) => !u.startsWith('socket:'))) {
      expect(() => assertScratchDatabase(url)).not.toThrow(/its scheme is "socket:"/);
    }

    // The documented socket URI, called out by name: `pg` reads its database correctly off the
    // path, this guard declines it anyway, and the message says which rule it fell foul of rather
    // than blaming the scheme it did not break.
    expect(() => assertScratchDatabase('postgresql:///b8_p111_throwaway?host=/var/run/postgresql'))
      .not.toThrow(/only postgres:\/\/ and postgresql:\/\/ are read/);
  });
});

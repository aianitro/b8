// F3 — the WebAuthn expected-origin set.
//
// One block, because the four properties SPEC.md's #10 names are one rule: the set is non-empty,
// it is a strict and explicit subset of the host allowlist, it contains no wildcard, and it is not
// reachable from an incoming request. Splitting them would let three pass while the one that
// matters fails.
//
// THE LAST PROPERTY IS ASSERTED STRUCTURALLY, over the module's AST rather than its output,
// because output cannot express it: a set derived from `request.headers.get('origin')` and a set
// derived from a constant look identical from the outside on any single request. BUILD.md's A10
// is the reason it is an AST walk and not a substring search — a comment reading
// "never from the request" satisfies a grep and proves nothing.

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTNAMES } from './hostGuard';
import { EXPECTED_ORIGINS, EXPECTED_RP_IDS, expectedOriginsFrom, relyingPartyIdsFrom } from './webauthnOrigins';

/** Every identifier appearing anywhere in a TypeScript source file. */
function identifiersIn(file: string): Set<string> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  (function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  })(source);
  return names;
}

describe('the WebAuthn relying-party configuration', () => {
  it('the WebAuthn expected-origin set is a non-empty, explicit subset of the host-guard allowlist, never the wildcard, never derived from the request', () => {
    // NON-EMPTY. An empty expected-origin array is the quietest possible failure: every ceremony
    // is refused, which reads as "the authenticator is broken" rather than as a configuration bug.
    expect(EXPECTED_ORIGINS.length).toBeGreaterThan(0);
    expect(EXPECTED_RP_IDS.length).toBeGreaterThan(0);

    // A SUBSET OF THE HOST ALLOWLIST, entry by entry. Each origin's hostname must be a host this
    // server admits at the outer boundary; an origin for a host the guard would 403 is an origin
    // no legitimate ceremony can ever carry.
    for (const origin of EXPECTED_ORIGINS) {
      expect(ALLOWED_HOSTNAMES.has(new URL(origin).hostname)).toBe(true);
    }

    // A STRICT subset, and the entries missing from it are the ones that cannot be relying
    // parties. This is what distinguishes "derived" from "copied": a copy of the host allowlist
    // would carry `127.0.0.1`, and a browser refuses an IP-literal RP id with a SecurityError.
    expect(EXPECTED_RP_IDS.length).toBeLessThan(ALLOWED_HOSTNAMES.size);
    expect(EXPECTED_RP_IDS).not.toContain('127.0.0.1');
    expect(EXPECTED_RP_IDS).not.toContain('[::1]');
    expect(EXPECTED_RP_IDS).not.toContain('0.0.0.0');
    expect(EXPECTED_RP_IDS).toContain('localhost');
    expect(EXPECTED_RP_IDS).toContain('b8.tailnet.ts.net');

    // NEVER THE WILDCARD, in any of its spellings.
    for (const origin of [...EXPECTED_ORIGINS, ...EXPECTED_RP_IDS]) {
      expect(origin).not.toBe('*');
      expect(origin.includes('*')).toBe(false);
    }

    // DERIVED, NOT COPIED — re-derive from the host allowlist and require the exported constants
    // to equal the result. A hand-maintained second list passes every assertion above on the day
    // it is written and fails this one the day the allowlist moves without it.
    expect([...EXPECTED_RP_IDS]).toEqual(relyingPartyIdsFrom(ALLOWED_HOSTNAMES));
    expect([...EXPECTED_ORIGINS]).toEqual(expectedOriginsFrom(ALLOWED_HOSTNAMES));
    // And the derivation really tracks its input rather than ignoring it: a host added to the set
    // appears, an IP literal added to the set does not.
    const widened = new Set([...ALLOWED_HOSTNAMES, 'extra.example.test', '10.0.0.7']);
    expect(expectedOriginsFrom(widened)).toContain('https://extra.example.test');
    expect(expectedOriginsFrom(widened)).not.toContain('https://10.0.0.7');
    // `localhost` is the secure-context exemption and is the only `http://` origin.
    expect(EXPECTED_ORIGINS.filter((o) => o.startsWith('http://'))).toEqual(['http://localhost:3000']);

    // NEVER DERIVED FROM THE REQUEST. Neither the module that computes the set nor the module that
    // hands it to the verifier may so much as name a request. An AST walk over both files, so a
    // reference inside a comment or a string is not what is being checked.
    for (const file of ['lib/webauthnOrigins.ts', 'lib/webauthnVerify.ts']) {
      const identifiers = identifiersIn(file);
      for (const forbidden of ['NextRequest', 'Request', 'headers', 'nextUrl', 'cookies', 'req', 'request']) {
        expect({ file, identifier: forbidden, present: identifiers.has(forbidden) })
          .toEqual({ file, identifier: forbidden, present: false });
      }
    }
    // The control on the control: the walk really does see identifiers in these files, so the loop
    // above cannot be passing because it parsed nothing.
    expect(identifiersIn('lib/webauthnOrigins.ts').has('EXPECTED_ORIGINS')).toBe(true);
    expect(identifiersIn('lib/webauthnVerify.ts').has('expectedOrigin')).toBe(true);
  });
});

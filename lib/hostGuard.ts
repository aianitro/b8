// The pure predicate behind proxy.ts's Host allowlist — kept DB-free and unit-testable per
// ROADMAP.md §2's RBAC-pure-predicate pattern.
//
// The dev/start scripts already bind to 127.0.0.1 only (see package.json), so this isn't
// closing a network-reachability gap — it's defense against DNS rebinding: a page on any
// origin can get a victim's browser to send a same-machine request to this server with an
// attacker-controlled `Host` header (DNS for the attacker's domain resolves to 127.0.0.1
// after the browser's initial same-origin checks pass), bypassing same-origin protections
// entirely because the request really is being sent to 127.0.0.1. Rejecting anything but
// the expected Host values closes that off — the same mitigation webpack-dev-server and
// Vite ship by default for exactly this class of attack against local dev servers.
//
// THIS FILE IS NO LONGER THE WHOLE BOUNDARY, and that is the change P1-12 makes. Passing the
// Host check now gets a request as far as the session check in `proxy.ts` and no further; the
// guard's own docblock used to have to say that anything able to put the right Host on a
// request to the bound port reached all 28 route handlers, and that sentence is retired here
// rather than left to rot. Host is the outer of two conjuncts now, not the only one.

/**
 * The Tailscale hostname this deployment answers to on the tailnet.
 *
 * ONE NAMED ADDITION, NOT A RELAXATION — the distinction SPEC.md's negative control #3 exists
 * to hold. The allowlist gains this exact string and nothing else: no wildcard, no `.ts.net`
 * suffix match, no "any host that resolves to us". A suffix rule would admit every machine on
 * every tailnet the moment one of them is in DNS, which is the shape of relaxation that reads
 * as a one-line convenience in review.
 *
 * IT IS A PLACEHOLDER FOR A REAL NAME, stated plainly because a hostname that does not exist
 * yet cannot be tested against a live tailnet. ROADMAP.md §5 Phase 2 step 19 is what binds the
 * interface; until it runs, nothing reaches this server over the tailnet at all and this entry
 * admits nobody. When that step lands, THIS CONSTANT IS THE ONE PLACE TO CHANGE: the WebAuthn
 * expected-origin set in `lib/webauthnOrigins.ts` is derived from the allowlist below rather
 * than copied from it, so replacing this literal moves both lists at once. That derivation is
 * the point — SPEC.md names "the WebAuthn origin set hand-copied from the host allowlist" as a
 * failure that passes today and drifts the next time either changes.
 */
export const TAILNET_HOSTNAME = 'b8.tailnet.ts.net';

/**
 * Every hostname this server will answer to, exactly.
 *
 * Exported because `lib/webauthnOrigins.ts` derives the WebAuthn relying-party ids and expected
 * origins FROM this set. A second hand-maintained list of "the hosts we are" is the defect this
 * export prevents; the two lists are legitimately different (an RP ID can never be an IP
 * literal, so `127.0.0.1`, `[::1]` and `0.0.0.0` cannot appear in the WebAuthn set) and the
 * only honest way to keep them in agreement is to compute the smaller one from this one.
 *
 * Readonly at the type level so a caller cannot `.add()` a host into the boundary at runtime.
 */
export const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '0.0.0.0',
  TAILNET_HOSTNAME,
]);

export function isAllowedHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  // Host headers carry "hostname:port" (or a bracketed IPv6 literal); split on the last
  // colon so an IPv6 literal's internal colons aren't mistaken for the port separator.
  const lastColon = hostHeader.lastIndexOf(':');
  const bracketClose = hostHeader.lastIndexOf(']');
  const hostname = lastColon > bracketClose ? hostHeader.slice(0, lastColon) : hostHeader;
  return ALLOWED_HOSTNAMES.has(hostname.toLowerCase());
}

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
 * READ FROM THE ENVIRONMENT, WITH A PLACEHOLDER DEFAULT — changed 2026-09-17, when the home server
 * joined a real tailnet. This was a hard-coded literal with a comment calling it "the one place to
 * change", and that reasoning was about DERIVATION: the WebAuthn origin set is computed from the
 * allowlist below rather than copied from it, so one value moves both. Reading the value from
 * `B8_TAILNET_HOSTNAME` keeps that property exactly — it is still one value, and both lists are
 * still derived from it. What changed is where the value lives. The real name is
 * `<machine>.<tailnet-id>.ts.net`; the machine part carries the owner's surname and the repo is
 * public, so it belongs in `.env.local`, not in git.
 *
 * The placeholder stays the default, so every machine without the variable — the laptop, CI, the
 * test suite — behaves exactly as before, and the tests that assert the literal still mean
 * something.
 *
 * Normalised: lowercased, and the trailing dot `tailscale status` prints is dropped, because a
 * browser's Host header never carries one and a set lookup is an exact comparison.
 *
 * Read at module load and NEVER THROWS. This repo has been bitten twice by environment validated at
 * module scope killing `next build`; an absent value here is not an error, it is the placeholder.
 */
export const TAILNET_HOSTNAME = (process.env.B8_TAILNET_HOSTNAME?.trim() || 'b8.tailnet.ts.net')
  .toLowerCase()
  .replace(/\.$/, '');

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

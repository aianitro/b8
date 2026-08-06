// The pure predicate behind middleware.ts's localhost-only guard — kept DB-free and
// unit-testable per ROADMAP.md §2's RBAC-pure-predicate pattern.
//
// The dev/start scripts already bind to 127.0.0.1 only (see package.json), so this isn't
// closing a network-reachability gap — it's defense against DNS rebinding: a page on any
// origin can get a victim's browser to send a same-machine request to this server with an
// attacker-controlled `Host` header (DNS for the attacker's domain resolves to 127.0.0.1
// after the browser's initial same-origin checks pass), bypassing same-origin protections
// entirely because the request really is being sent to 127.0.0.1. Rejecting anything but
// the expected Host values closes that off — the same mitigation webpack-dev-server and
// Vite ship by default for exactly this class of attack against local dev servers.

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

export function isAllowedHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  // Host headers carry "hostname:port" (or a bracketed IPv6 literal); split on the last
  // colon so an IPv6 literal's internal colons aren't mistaken for the port separator.
  const lastColon = hostHeader.lastIndexOf(':');
  const bracketClose = hostHeader.lastIndexOf(']');
  const hostname = lastColon > bracketClose ? hostHeader.slice(0, lastColon) : hostHeader;
  return ALLOWED_HOSTNAMES.has(hostname.toLowerCase());
}

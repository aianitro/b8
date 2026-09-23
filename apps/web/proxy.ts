// The request boundary: a Host check, then a session check, for everything the app serves.
//
// RENAMED FROM `middleware.ts`, WHICH IS DEPRECATED IN THIS VERSION OF NEXT. The installed docs say
// so directly — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`:
// *"The `middleware` file convention is deprecated and has been renamed to `proxy`"* — and the
// rename is not cosmetic here: Proxy defaults to the Node.js runtime, which is what makes a real
// `pg` query at the boundary possible at all. There is exactly ONE of these files. SPEC.md names
// "`middleware.ts` left in place alongside `proxy.ts`" as a failure mode, and it is a real one:
// two definitions of who may reach this app, one of them invoked.
//
// WHAT CHANGED BEYOND THE NAME. Until this task, passing the Host check WAS the boundary — all 28
// route handlers and every page were reachable by anything able to put `localhost` in a header.
// Now the Host check is the outer of two conjuncts. The inner one is a server-verified session, and
// it covers every route this task's diff never touches, which is the point: protecting only the one
// `/api/v1/*` route would leave 27 handlers and every page exactly as reachable as they were.
//
// THE ALLOWLIST IS FIVE SURFACES AND NO OTHERS, and it is a set of exact paths rather than a
// prefix. `/api/v1/auth/` as a prefix would have admitted `logout` — which is meaningless without a
// session and must get the same 401 as anything else — and would admit every future endpoint added
// under that directory by default, which is the wrong default for the one directory in the app that
// is reachable before authentication.
//
// THE TWO `register/*` ENDPOINTS ARE ALLOWLISTED HERE AND GATED INSIDE THEIR HANDLERS. The boundary
// cannot count credentials without a database round trip on every request regardless of path, which
// is the wrong place for that check; the handlers do it, and SPEC.md's I2 is what holds them to it.
//
// FAIL CLOSED. Every failure path in this file ends in a refusal. There is no
// `catch { return NextResponse.next() }` — the shape that turns a transient database blip into an
// authentication bypass, and the one BUILD.md §10.3 names.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authorize } from '@/lib/requestAuth';
import { isAllowedHost } from '@/lib/hostGuard';
import { createLogger } from '@/lib/logger';
import type { ApiResponse } from '@b8/contracts/types';

const log = createLogger('proxy');

/**
 * The pre-`/api/v1/` shape of the eleven segments P1-10b moved.
 *
 * Kept in step with `MIGRATED_SEGMENTS` in `next.config.ts` by being the same list — if a segment is
 * dropped from the rewrite it should be dropped here too, and the day both are empty this constant
 * and the rewrite go together.
 */
const LEGACY_API =
  /^\/api\/(accounts|budget|categories|chat|import|plaid|properties|rules|sync|transactions|transfers)(\/|$)/;

/**
 * The five surfaces a browser may reach before a session exists.
 *
 * Exported so `proxy.test.ts` asserts over the same set the boundary uses rather than a transcribed
 * copy of it — a fixture that restated these five strings would keep passing after a sixth was
 * added here.
 */
export const PRE_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/register/options',
  '/api/v1/auth/register/verify',
  '/api/v1/auth/login/options',
  '/api/v1/auth/login/verify',
  '/login',
  // P3-23a. THE APP HAS NO SESSION YET — getting one is the point, so this cannot sit behind the
  // boundary. What makes it safe to leave open is not the boundary but the endpoint's own two gates:
  // the body must carry a SINGLE-USE code that is dead in sixty seconds and stored only as a SHA-256,
  // and `mayIssueDeviceToken` refuses any caller carrying `Sec-Fetch-*` headers, so a browser cannot
  // exchange a code even if it obtained one.
  //
  // Added with `docs/agent-authorization.md` §2 open on the desk: that write-up's whole point is that
  // an allowlist creates its holes at the special paths, and the special paths are usually the
  // powerful ones. This one mints a 30-day credential. Its checks are therefore IN THE HANDLER, not
  // inherited from a boundary it deliberately skips.
  '/api/v1/auth/device-claim',
  // The browser half of the same flow. A page, no privilege of its own: it runs the passkey ceremony
  // and cannot mint anything without one succeeding first.
  '/link-device',

  // ─── The PWA's install assets (§5 step 26b) ─────────────────────────────────────────────────
  //
  // WHAT THEY CONTAIN is the whole argument: an app name, a description, a theme colour, and a
  // drawn "b8" square. No figure, no account, no session, nothing derived from the ledger. Weighed
  // against the same write-up's warning that an allowlist creates its holes at the special paths —
  // these are the opposite of special. They are the least privileged bytes the server holds.
  //
  // WHY THEY CANNOT SIT BEHIND THE BOUNDARY, which is the part that is not obvious:
  //
  //   * iOS reads the manifest and icons AT INSTALL TIME. Behind auth they answer 307 to /login,
  //     and the Home Screen entry silently falls back to the page title and a screenshot.
  //   * A service worker precaching the shell would follow that redirect and cache the LOGIN PAGE
  //     as the app's shell — after which the installed app opens to a login screen forever, from
  //     its own cache, with no request to the server that could correct it. That failure is
  //     invisible until it is permanent, which is why this lands before the service worker rather
  //     than after it.
  //
  // The host is tailnet-only regardless, so the audience for these is already inside the network.
  // The worker itself and the page it falls back to. `/sw.js` MUST be reachable unauthenticated:
  // a redirect is not a valid service worker script and registration fails outright, silently. The
  // offline page is precached by that worker and carries no data by construction — it exists to say
  // the server is unreachable, which is the one moment no session can be checked anyway.
  '/sw.js',
  '/offline',
  '/manifest.webmanifest',
  '/apple-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]);

/**
 * The path, with one trailing slash removed.
 *
 * `/login/` and `/login` are the same surface to a user and two different strings to a `Set`.
 * Normalising toward the allowlist is safe in the direction that matters: it can only make MORE
 * requests match the five exact paths, and it cannot make a protected path stop matching, because
 * membership is exact rather than by prefix — `/api/v1/auth/register/options/anything` is not a
 * member and does not become one.
 */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * The refusal.
 *
 * TWO SHAPES, ONE DECISION. An API caller gets 401 with the envelope every other handler on this
 * API speaks — `ApiErrorResponseSchema`, aliased as `UnauthenticatedResponseSchema` in
 * `shared/contracts/auth.ts` precisely because the boundary hand-builds this body and a hand-built
 * `{ error: 'unauthorized' }` would be discovered by a client rather than by a test. A browser
 * asking for a PAGE gets a redirect to `/login`, because a JSON 401 rendered in a browser window is
 * a dead end and the one allowlisted page is where the owner has to end up anyway.
 *
 * The redirect is the boundary's, not a page's. SPEC.md names "a page protected by a `redirect()`
 * inside its own component" as the failure this replaces: that works for the page someone
 * remembered to edit and reintroduces protection-as-a-per-file-convention for every page nobody
 * did.
 */
function refuse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'This request carried no valid session.' },
      } satisfies ApiResponse<never>,
      { status: 401 }
    );
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  // A bare stopgap ahead of real auth is what this used to be (ROADMAP.md §3); it is now the outer
  // conjunct of one. The dev/start scripts bind to 127.0.0.1 only, so this is not closing a
  // network-reachability gap — it is defence against DNS rebinding, which network binding alone
  // does not close. See lib/hostGuard.ts.
  if (!isAllowedHost(request.headers.get('host'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (PRE_AUTH_PATHS.has(normalizePath(request.nextUrl.pathname))) {
    return NextResponse.next();
  }

  try {
    // Cookie OR bearer token, decided in one place — `lib/requestAuth.ts` — so this boundary and the
    // handlers behind it cannot disagree about who a request is. A bearer token reaches only the API,
    // only as a device or personal session, and only within its scope.
    const decision = await authorize(request);
    if (!decision.ok) {
      if (decision.status === 403) {
        // Authenticated, but not allowed THIS — a read-only token attempting a write. 403 rather
        // than 401, so a client does not respond by signing in again and looping.
        return NextResponse.json(
          {
            success: false,
            error: { code: decision.code, message: 'This token does not permit that request.' },
          } satisfies ApiResponse<never>,
          { status: 403 }
        );
      }
      return refuse(request);
    }
  } catch (caught) {
    // THE ONLY CATCH IN THIS FILE, AND IT REFUSES. An unreachable database, a throwing lookup, a
    // pool exhausted — every one of them means this request's session could not be verified, and
    // "could not check" is not "allowed". It is logged because a boundary that starts refusing
    // everything for an infrastructure reason must be diagnosable from the server's own output.
    log.error('session lookup failed at the boundary; refusing', {
      path: request.nextUrl.pathname,
      error: caught instanceof Error ? caught.message : String(caught),
    });
    return refuse(request);
  }

  // ─── The legacy-path watch, so the compatibility rewrite can be retired on evidence ─────────
  //
  // P1-10b moved 27 handlers under `/api/v1/` and left a rewrite in `next.config.ts` keeping the old
  // paths alive. The UI was then switched over, and a grep says nothing calls an old path any more —
  // but a grep is static, and the browser could not be exercised from the session that made the
  // change. So instead of deleting the rewrite on a belief, the boundary says when an old path is
  // used. After a period of normal use with nothing logged here, the rewrite can go.
  //
  // Placed AFTER the session check on purpose: this is telemetry about the owner's own client, not
  // a security control, and nothing about it should run for an unauthenticated caller.
  if (LEGACY_API.test(request.nextUrl.pathname)) {
    log.warn('legacy API path used; the /api/v1 rewrite is still load-bearing', {
      path: request.nextUrl.pathname,
    });
  }

  return NextResponse.next();
}

export const config = {
  // UNCHANGED FROM THE MATCHER THIS FILE INHERITED, deliberately. SPEC.md names "the proxy matcher
  // narrowed or reordered so one existing route falls outside it" as a failure mode, and the Next
  // docs name the same hazard in their own words; the safe move on a task that ADDS a conjunct to
  // the boundary is to change the set of paths the boundary sees by exactly nothing.
  //
  // WHAT THE EXCLUSION COVERS, since it is now load-bearing for a second reason. `_next/static` and
  // `_next/image` are Next's own asset routes, and `/login`'s JS chunks and CSS are served from
  // `_next/static` — so the login page an unauthenticated visitor is redirected to can fetch the
  // files it needs to render. SPEC.md's allowlist names the page and not its assets; this line is
  // why that omission is not a blank login page. `proxy.test.ts` asserts it rather than trusting it.
  //
  // The docs also record that proxy still runs for `/_next/data/*` even when excluded, which is
  // deliberate on Next's part and correct for us: a page's data route is protected alongside the
  // page rather than being a hole beside it.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

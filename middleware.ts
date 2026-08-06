import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAllowedHost } from '@/lib/hostGuard';

// A bare stopgap ahead of real auth (ROADMAP.md §3): this app is single-user, zero-auth,
// and syncs real bank accounts. The dev/start scripts already bind to 127.0.0.1 only, so
// this exists to close the DNS-rebinding gap that network binding alone doesn't — see
// lib/hostGuard.ts for why a same-machine attacker can still reach a 127.0.0.1-bound server
// with an attacker-controlled Host header despite that binding.
export function middleware(request: NextRequest) {
  if (!isAllowedHost(request.headers.get('host'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  // Excludes static assets so a rejected Host still lets the browser fetch its own error
  // page's supporting files rather than compounding the failure; nothing here is a security
  // boundary the way the route match above is.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

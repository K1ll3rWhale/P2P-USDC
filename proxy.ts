import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, cspHeaderName, newNonce, STATIC_SECURITY_HEADERS } from './lib/csp';

// Pages that need a signed-in user. For these an anonymous GET gets a real HTTP 307 to /login instead of a streamed
// loading screen. This only checks that a session cookie EXISTS. It is a convenience, not authorization: every page
// and route still validates the session server-side (lib/session.ts), so a forged or expired cookie gets nothing.
const PROTECTED = new Set(['/', '/wallet', '/send', '/activity', '/friends']);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (req.method === 'GET' && PROTECTED.has(pathname) && !req.cookies.has('session')) {
    const res = NextResponse.redirect(new URL('/login', req.url));
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  }

  // Security headers on everything else, with a per-request CSP nonce that Next reads from the request headers.
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(cspHeaderName(), csp);
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

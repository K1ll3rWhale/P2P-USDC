import { NextResponse, type NextRequest } from 'next/server';

// Early redirect so an anonymous page request gets a real HTTP 307 to /login instead of a streamed loading screen.
// This only checks that a session cookie EXISTS. It is a convenience, not authorization: every page and route
// still validates the session server-side (lib/session.ts), so a forged or expired cookie gets nothing.
export function proxy(req: NextRequest) {
  if (req.method === 'GET' && !req.cookies.has('session')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/wallet', '/send', '/activity', '/friends'] };

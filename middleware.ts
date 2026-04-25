/**
 * middleware.ts — defense-in-depth at the edge.
 *
 * Adds:
 *   - basic CSP for HTML responses
 *   - request id header for traceability
 *
 * Auth is enforced inside individual route handlers (see lib/auth.ts) so
 * webhook/cron endpoints with their own signature schemes can opt out.
 */

import { NextRequest, NextResponse } from 'next/server';

function generateRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const reqId = req.headers.get('x-request-id') ?? generateRequestId();
  res.headers.set('x-request-id', reqId);

  if (req.nextUrl.pathname.startsWith('/admin')) {
    res.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co",
    );
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

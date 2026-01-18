// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/bot', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/', // Only apply middleware to the root path
};

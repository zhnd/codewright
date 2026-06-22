import { type NextRequest, NextResponse } from 'next/server';

const AUTH_ROUTES = ['/login', '/register'];
const PUBLIC_ROUTES = [...AUTH_ROUTES];
const SESSION_COOKIE = 'better-auth.session_token';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Authenticated user visiting auth pages → redirect to dashboard
  if (hasSession && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Unauthenticated user visiting protected pages → redirect to login
  if (!hasSession && !PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};

import { NextResponse, type NextRequest } from 'next/server';
import { DOCTOR_COOKIE } from '@/lib/auth/constants';

// Cheap gate for physician pages. The cookie signature is fully verified
// server-side in getDoctor(); this just avoids rendering for anonymous users.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/doctor/login')) return NextResponse.next();
  if (!req.cookies.get(DOCTOR_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/doctor/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/doctor/:path*'] };

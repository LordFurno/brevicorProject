import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await client.auth.getUser();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/doctor/:path*', '/api/doctor/:path*', '/api/auth/:path*'] };

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function sessionClient() {
  const jar = await cookies(),
    url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for sign-in');
  return createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Server components are read-only; middleware refreshes. */
        }
      },
    },
  });
}

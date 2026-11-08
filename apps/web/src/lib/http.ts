import { NextResponse } from 'next/server';

const noStore = { 'Cache-Control': 'no-store' };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStore });
export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/**
 * Same-origin check for state-changing requests. Accepts the server's own
 * origin and, behind a proxy or tunnel (where the server sees localhost),
 * the public origin in APP_BASE_URL. Requests without an Origin header pass.
 */
export function wrongOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  if (origin === new URL(req.url).origin) return false;
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) return true;
  try {
    return origin !== new URL(base).origin;
  } catch {
    return true;
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

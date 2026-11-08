import { NextResponse } from 'next/server';

const noStore = { 'Cache-Control': 'no-store' };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStore });
export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * A sign-in photograph the school uploaded, to anyone — including whoever is looking at the
 * login page.
 *
 * Sibling of `/api/branding/logo`, and deliberately carrying no credentials for the same reason:
 * this is the picture on the school's own front door, and it has to render for someone who has
 * not opened it yet.
 *
 * A 404 here is normal, not an error — it means the school has not replaced that page's picture,
 * and `AuthShell` falls back to the one the product ships with.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  const res = await fetch(`${API_URL}/public/branding/photo/${encodeURIComponent(slot)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return new NextResponse(null, { status: 404 });

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      // Short: a school that has just replaced its picture should see the new one within the
      // minute rather than after a browser restart.
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}

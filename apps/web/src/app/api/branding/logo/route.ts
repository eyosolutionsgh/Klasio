import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The school crest, to anyone — including whoever is looking at the login page.
 *
 * Separate from `/api/proxy/*`, which attaches the session cookie and redirects to /login on 401.
 * This one deliberately carries no credentials: it is the crest on the door, and it has to render
 * for someone who has not opened it yet.
 *
 * See the carve-out note in the API's common/storage.ts. This is not a general escape from
 * "every stored object is behind auth" — it is one route, for one image, that is institutional
 * artwork rather than anything about a child.
 */
export async function GET() {
  const res = await fetch(`${API_URL}/public/branding/logo`, { cache: 'no-store' });
  if (!res.ok) return new NextResponse(null, { status: 404 });

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      // Short, and private to nobody: the crest is public, but a school that has just replaced it
      // should see the new one within the minute rather than after a browser restart.
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Narrow, UNAUTHENTICATED passthrough for the public admissions form — a prospective parent has
 * no account, no cookie and never will. Kept separate from `/api/pay` deliberately: these are
 * two unrelated public surfaces with their own lifecycles, and one short allow-list per surface
 * stays auditable at a glance, where a merged one would quietly accumulate.
 *
 * Only the two public admissions routes are reachable; anything else is refused, so this never
 * becomes an open proxy into the API. No cookie is ever forwarded.
 */
const ALLOW: RegExp[] = [
  /^admissions\/apply\/[^/]+$/, // GET the school's name and levels, POST the application
];

async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const joined = path.join('/');
  if (!ALLOW.some((re) => re.test(joined))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const res = await fetch(`${API_URL}/${joined}`, {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    body: req.method === 'GET' ? undefined : await req.text(),
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Narrow, UNAUTHENTICATED passthrough for the guardian pay flow — guardians have no login.
 * Only the handful of public payment routes are reachable; anything else is refused, so this
 * never becomes an open proxy into the API.
 */
const ALLOW: RegExp[] = [
  /^payments\/public\/[^/]+$/, // view a pay link
  /^payments\/public\/[^/]+\/checkout$/, // start checkout
  /^payments\/[^/]+\/status$/, // read-only status (cannot settle)
  /^payments\/mock\/[^/]+\/complete$/, // mock gateway completion (dev/demo only)
  /^billing\/mock\/[^/]+\/complete$/, // ditto, for a school's own subscription checkout
];

async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const joined = path.join('/');
  if (!ALLOW.some((re) => re.test(joined))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const res = await fetch(`${API_URL}/${joined}${req.nextUrl.search}`, {
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

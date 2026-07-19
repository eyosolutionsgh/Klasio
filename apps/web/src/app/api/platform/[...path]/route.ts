import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Narrow passthrough for the vendor console.
 *
 * Allowlisted to `platform/*` and reading only the platform cookie, exactly like the guardian
 * and student proxies. The staff proxy at `/api/proxy` is deliberately general; this one must
 * not be, because the cookie behind it crosses every tenant boundary in the product.
 */
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const joined = path.join('/');
  if (!/^platform\//.test(joined)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Signing in necessarily precedes having a session, so it is the one path that may pass
  // without the cookie. Everything else is refused here before it reaches the API.
  const isAuth = /^platform\/auth\//.test(joined);
  const token = req.cookies.get('eyo_platform')?.value;
  if (!token && !isAuth) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const res = await fetch(`${API_URL}/${joined}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

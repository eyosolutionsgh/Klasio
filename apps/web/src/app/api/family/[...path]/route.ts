import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Forwards guardian-portal calls with the guardian session cookie. Restricted to `guardian/*`
 * so this can never become a general route into the staff API, and it carries only the
 * guardian cookie — never the staff one.
 */
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const joined = path.join('/');
  if (!/^guardian\//.test(joined)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Sign-in runs before any session exists, so the auth routes must pass through without a
  // cookie. Everything else is ward data and requires one.
  const isAuthRoute = /^guardian\/auth\//.test(joined);
  const token = req.cookies.get('eyo_guardian')?.value;
  if (!isAuthRoute && !token) {
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

  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json') || type === '') {
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': type || 'application/json' },
    });
  }
  const buf = await res.arrayBuffer();
  const headers: Record<string, string> = { 'Content-Type': type };
  const disposition = res.headers.get('content-disposition');
  if (disposition) headers['Content-Disposition'] = disposition;
  return new NextResponse(buf, { status: res.status, headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}

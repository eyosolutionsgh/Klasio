import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Forwards student-portal calls with the student cookie. Restricted to `student/*` so it can
 * never become a general route into the staff API, and it carries only the student cookie.
 */
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const joined = path.join('/');
  if (!/^student\//.test(joined)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Sign-in happens before any session exists, so the auth route passes through without a cookie.
  const isAuthRoute = /^student\/auth\//.test(joined);
  const token = req.cookies.get('eyo_student')?.value;
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
  // JSON is forwarded as text; a learning-resource download is bytes, and reading it with
  // res.text() would decode it as UTF-8 and silently corrupt every non-text file.
  if (type.includes('application/json') || type === '') {
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': type || 'application/json' },
    });
  }
  // Streamed through, never buffered — a shared lesson video is far too big to hold here.
  const headers: Record<string, string> = { 'Content-Type': type };
  for (const header of ['content-disposition', 'content-length']) {
    const value = res.headers.get(header);
    if (value) headers[header] = value;
  }
  return new NextResponse(res.body, { status: res.status, headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}

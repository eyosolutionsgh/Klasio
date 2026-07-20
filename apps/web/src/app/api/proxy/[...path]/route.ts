import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Forwards client-side calls to the API with the httpOnly session token. */
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const token = req.cookies.get('eyo_token')?.value;
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const url = `${API_URL}/${path.join('/')}${req.nextUrl.search}`;

  const isBodyless = req.method === 'GET' || req.method === 'HEAD';
  // Preserve the client's Content-Type so multipart uploads (onboarding import) pass through.
  const contentType = req.headers.get('content-type');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!isBodyless && contentType) headers['Content-Type'] = contentType;

  const res = await fetch(url, {
    method: req.method,
    headers,
    // The request body is piped through, never buffered: a media upload can be hundreds of
    // megabytes, and this hop must not hold it in the web server's memory. `duplex` is what
    // Node's fetch requires for a streaming body; the RequestInit type has not caught up.
    body: isBodyless ? undefined : req.body,
    ...(isBodyless ? {} : { duplex: 'half' as const }),
  } as RequestInit);

  const resType = res.headers.get('content-type') ?? '';
  // JSON is forwarded as text; binary (PDF/xlsx/media) is streamed through with headers intact.
  if (resType.includes('application/json') || resType === '') {
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': resType || 'application/json' },
    });
  }
  const passthrough: Record<string, string> = { 'Content-Type': resType };
  for (const header of ['content-disposition', 'content-length']) {
    const value = res.headers.get(header);
    if (value) passthrough[header] = value;
  }
  return new NextResponse(res.body, { status: res.status, headers: passthrough });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}

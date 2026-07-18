import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Guardian sign-in. The session cookie is separate from the staff `eyo_token` so the two
 * principals can never be confused — and so a shared family device signing into the portal
 * does not disturb a staff session in the same browser.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/guardian/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: err.message ?? 'That code is not valid' }, { status: 401 });
  }
  const data = await res.json();
  const response = NextResponse.json({ ok: true, guardian: data.guardian });
  response.cookies.set('eyo_guardian', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('eyo_guardian', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}

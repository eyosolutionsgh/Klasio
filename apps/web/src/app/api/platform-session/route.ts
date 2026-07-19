import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * EYO's own session, in its own cookie.
 *
 * A third cookie alongside `eyo_token` and `eyo_guardian` for the same reason those two are
 * separate: one browser, several kinds of person, and no way for one session to be mistaken for
 * another. This one matters most — a vendor session can suspend every school on the platform —
 * so it is also the shortest lived.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/platform/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
  const data = await res.json();
  const response = NextResponse.json({ ok: true, admin: data.admin });
  response.cookies.set('eyo_platform', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Matches the token's own 8h lifetime, so the cookie never outlives what it carries.
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('eyo_platform', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Sign a new school up and leave it signed in.
 *
 * The sibling of `/api/session`, and it sets the *same* `eyo_token` cookie with the same
 * options on purpose: a session created by registering must be indistinguishable from one
 * created by logging in, or the first thing a new school would hit is a redirect to /login.
 *
 * The API's own message is passed through rather than replaced. Unlike a failed login — where
 * saying which of the email or password was wrong leaks whether an account exists — the reasons
 * a signup fails are all things the person filling in the form needs to be told.
 */
/** Check an invitation without spending it, so the page can greet the school or refuse early. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const res = await fetch(`${API_URL}/auth/invitation?token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: data.message ?? 'That invitation link is not valid.' },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('. ')
      : (data.message ?? 'Could not create that school.');
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const response = NextResponse.json({ ok: true, user: data.user, school: data.school });
  response.cookies.set('eyo_token', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}

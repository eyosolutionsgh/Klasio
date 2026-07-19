import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * First-run setup: create the school and its owner, and leave them signed in.
 *
 * The sibling of `/api/session`, and it sets the *same* `eyo_token` cookie with the same options
 * on purpose — a session created by setting the server up must be indistinguishable from one
 * created by logging in, or the first thing a brand-new school hits is a redirect to /login.
 *
 * The API's own message is passed through rather than replaced. Unlike a failed login — where
 * saying which of the email or password was wrong would leak whether an account exists — every
 * reason this can fail is something the person filling in the form needs to be told.
 */
export async function GET() {
  const res = await fetch(`${API_URL}/public/setup/state`, { cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ needsSetup: false }, { status: res.status });
  return NextResponse.json(await res.json());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/public/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('. ')
      : (data.message ?? 'Could not set this server up.');
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const response = NextResponse.json({
    ok: true,
    user: data.user,
    school: data.school,
    // A licence that was refused is reported, not thrown: the school exists and is signed in, and
    // the licence screen is where they fix it.
    licenceError: data.licenceError ?? null,
  });
  response.cookies.set('eyo_token', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}

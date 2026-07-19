import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The two unauthenticated halves of a staff password reset: ask for a link, and redeem one.
 *
 * A single route with a `step` discriminator rather than two files, because the browser must be
 * able to reach both without a session and they share exactly one concern — neither may ever
 * forward a cookie, and neither sets one. Redeeming a reset deliberately does *not* sign the
 * person in: they land back on /login and prove the new password works.
 */
export async function POST(req: NextRequest) {
  const { step, ...body } = await req.json();
  const path = step === 'request' ? 'forgot-password' : 'reset-password';

  const res = await fetch(`${API_URL}/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The API records this against the request so a reset nobody asked for can be traced.
      // Trusted for logging only — never for authorisation.
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    /**
     * Passed through, and safe to pass through.
     *
     * The request step answers identically whether or not the address has an account, so there is
     * nothing here that could confirm one exists. The redeem step's messages are all about the
     * link the person is already holding — used, superseded, expired — which they need told.
     */
    const message = Array.isArray(data.message)
      ? data.message.join('. ')
      : (data.message ?? 'Something went wrong. Please try again.');
    return NextResponse.json({ error: message }, { status: res.status });
  }

  return NextResponse.json(data);
}

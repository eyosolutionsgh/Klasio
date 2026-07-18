import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Student sign-in. A third cookie, separate from staff and guardian, so a family sharing one
 * phone can have a parent and a child signed in without either disturbing the other.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/student/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: err.message ?? 'That admission number or PIN is not right' },
      { status: 401 },
    );
  }
  const data = await res.json();
  const response = NextResponse.json({ ok: true, student: data.student });
  response.cookies.set('eyo_student', data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('eyo_student', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}

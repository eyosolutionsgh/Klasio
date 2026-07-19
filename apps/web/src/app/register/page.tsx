'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

/** Matches the API's `@MinLength(8)`, so the form can say so before the round trip. */
const MIN_PASSWORD = 8;

/**
 * Where a school starts — by invitation only.
 *
 * Registration is vendor-initiated: EYO decides who may put a school on the platform, so this
 * page is useless without a token. It checks the invitation before showing the form, so a dead
 * link says so immediately rather than after someone has typed everything in.
 *
 * The email is fixed by the invitation and cannot be edited here — it is what makes the token
 * useless to anyone it was not sent to. Everything else a school might want to tell us (logo,
 * colours, terms, levels, fees) is asked for afterwards in Setup, where it can be changed.
 */
function Register() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') ?? '';

  const [checking, setChecking] = useState(true);
  const [invitation, setInvitation] = useState<{ schoolName: string; email: string } | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This page needs an invitation link from EYO.');
      setChecking(false);
      return;
    }
    fetch(`/api/register?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'That invitation link is not valid.');
        setInvitation(data);
        setSchoolName(data.schoolName);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setChecking(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, schoolName, ownerName, email: invitation?.email, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? 'Could not create that school.');
      return;
    }
    // Straight into Setup rather than the dashboard: a school with no terms or classes yet has
    // an empty dashboard, and the first useful thing to do is tell us its year and its levels.
    router.push('/settings/school');
    router.refresh();
  }

  const footer = (
    <p className="text-[13px] text-oat">
      Already registered?{' '}
      <Link href="/login" className="text-brand hover:underline">
        Sign in
      </Link>
    </p>
  );

  if (checking) {
    return (
      <AuthShell title="Register your school">
        <p className="text-sm text-oat">Checking your invitation…</p>
      </AuthShell>
    );
  }

  // No usable invitation: say so plainly and offer nothing else. There is deliberately no way to
  // request one from here — EYO decides who joins, and a form that pretended otherwise would set
  // an expectation the product does not meet.
  if (!invitation) {
    return (
      <AuthShell
        title="Invitation needed"
        subtitle="Schools join EYO by invitation. If you have spoken to us, use the link we sent you — it may also have expired."
        footer={footer}
      >
        {error && <AuthError>{error}</AuthError>}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Register your school"
      subtitle={`Invitation confirmed for ${invitation.email}. A few details to get started — you can change any of them later.`}
      footer={footer}
    >
      <form onSubmit={submit} aria-label="Register your school">
        <AuthFieldGroup>
          <AuthField
            label="School name"
            required
            autoFocus
            maxLength={120}
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="Sunbeam International School"
          />
          <AuthField
            label="Your name"
            required
            autoComplete="name"
            maxLength={80}
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Mrs. Ama Owusu"
          />
          {/*
            Fixed by the invitation, not typed. This is what stops a forwarded link from being
            usable by whoever received it — the API refuses any other address anyway, so an
            editable field here would only invite a rejection.
          */}
          <AuthField
            label="Email address"
            type="email"
            readOnly
            value={invitation.email}
            className="text-oat"
          />
          <AuthField
            label="Password"
            revealable
            required
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </AuthFieldGroup>

        <p className="mt-3 text-[12.5px] text-oat leading-relaxed">
          This account owns the school. You can add heads, bursars and teachers once you are in.
        </p>

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7">
          <AuthButton busy={busy} busyLabel="Creating your school…">
            Create school
          </AuthButton>
        </div>
      </form>
    </AuthShell>
  );
}

// `useSearchParams` suspends; the invitation token lives in the query string, so there is
// nothing to render before it is known.
export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthShell title="Register your school">{null}</AuthShell>}>
      <Register />
    </Suspense>
  );
}

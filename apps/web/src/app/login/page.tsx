'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/dashboard');
      router.refresh();
    } else {
      setError('That email or password is not right. Please try again.');
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} aria-label="Sign in">
        <AuthFieldGroup>
          <AuthField
            label="Email address"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu.gh"
          />
          <AuthField
            label="Password"
            revealable
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </AuthFieldGroup>

        <div className="mt-4 flex justify-end">
          <Link
            href="/forgot-password"
            className="min-h-11 inline-flex items-center text-[13px] text-oat hover:text-brand transition"
          >
            Forgot password?
          </Link>
        </div>

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7">
          <AuthButton busy={busy} busyLabel="Signing in…">
            Log in
          </AuthButton>
        </div>

        {/*
          No sign-up link. Schools join by invitation from EYO, so a link to /register would only
          lead to a page telling them they need one — see the register page's own empty state.
        */}
      </form>
    </AuthShell>
  );
}

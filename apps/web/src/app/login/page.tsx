'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { useAsyncAction } from '@/components/Button';
import { LockIcon, MailIcon } from '@/components/icons';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signIn = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('That email or password is not right. Please try again.');
      // Thrown so the button settles on failed rather than claiming a sign-in that did not happen.
      throw new Error('rejected');
    }
    router.push('/dashboard');
    router.refresh();
  });

  return (
    <AuthShell title="Sign in">
      <form onSubmit={signIn.run} aria-label="Sign in">
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
            icon={<MailIcon />}
          />
          <AuthField
            label="Password"
            icon={<LockIcon />}
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
          <AuthButton
            state={signIn.state}
            busyLabel="Signing in…"
            doneLabel="Signed in!"
            icon={<LockIcon />}
          >
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { useAsyncAction } from '@/components/Button';
import { LockIcon, MailIcon } from '@/components/icons';

/**
 * EYO's own sign-in.
 *
 * Shares `AuthShell` with the three school-facing logins so it is recognisably the same product,
 * but it is a different door: this account belongs to the vendor, and nothing here is scoped to
 * a school. There is no sign-up link, and there never will be — platform accounts are made by
 * seeding, not by asking.
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signIn = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/platform-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('That email or password is not right.');
      // Thrown so the button settles on failed rather than claiming a sign-in that did not happen.
      throw new Error('rejected');
    }
    router.push('/platform/schools');
    router.refresh();
  });

  return (
    <AuthShell
      title="Klasio Platform"
      subtitle="Klasio staff sign-in. This is not a school account."
    >
      <form onSubmit={signIn.run} aria-label="Platform sign in">
        <AuthFieldGroup>
          <AuthField
            label="Email address"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@eyo.gh"
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
      </form>
    </AuthShell>
  );
}

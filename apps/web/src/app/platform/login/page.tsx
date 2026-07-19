'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

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
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/platform-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/platform/schools');
      router.refresh();
    } else {
      setError('That email or password is not right.');
    }
  }

  return (
    <AuthShell title="EYO Platform" subtitle="EYO staff sign-in. This is not a school account.">
      <form onSubmit={submit} aria-label="Platform sign in">
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

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7">
          <AuthButton busy={busy} busyLabel="Signing in…">
            Log in
          </AuthButton>
        </div>
      </form>
    </AuthShell>
  );
}

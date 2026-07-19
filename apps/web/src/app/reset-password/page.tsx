'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

/** Matches the API's `@MinLength(8)`, so the form refuses before a round trip does. */
const MIN_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'redeem', token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    // The API's message is shown as-is: used, superseded and expired all call for different
    // actions, and a single "invalid link" would leave the person guessing which.
    if (res.ok) setDone(true);
    else setError(data.error ?? 'That reset link is not valid. Ask for a new one.');
  }

  if (!token) {
    return (
      <AuthShell title="Reset your password">
        <p className="text-sm text-oat leading-relaxed">
          That link is incomplete. Open the most recent link from your email, or ask for a new one.
        </p>
        <div className="mt-7">
          <Link href="/forgot-password" className="text-sm text-oat hover:text-brand transition">
            Ask for a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  /**
   * Not signed in automatically.
   *
   * Redeeming a reset ends every session the old password had opened — including, if the reset
   * was prompted by a lost laptop, someone else's. Handing back a fresh session here would
   * quietly undo half of that. Signing in once proves the new password actually works.
   */
  if (done) {
    return (
      <AuthShell title="Password changed">
        <p className="text-sm text-oat leading-relaxed">
          Your new password is set. Any other device that was signed in has been signed out.
        </p>
        <div className="mt-7">
          <button
            onClick={() => router.push('/login')}
            className="min-h-11 rounded-lg px-10 text-sm font-semibold uppercase tracking-wider text-ink bg-gradient-to-r from-[#e2bb55] to-gold hover:from-gold hover:to-[#b0831f] transition-all"
          >
            Sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} aria-label="Choose a new password">
        <AuthFieldGroup>
          <AuthField
            label="New password"
            revealable
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <AuthField
            label="Confirm new password"
            revealable
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </AuthFieldGroup>

        <p className="mt-3 text-[13px] text-oat">At least {MIN_LENGTH} characters.</p>

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7 flex items-center gap-5">
          <AuthButton busy={busy} busyLabel="Saving…">
            Set password
          </AuthButton>
          <Link href="/login" className="text-sm text-oat hover:text-brand transition">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

/**
 * `useSearchParams` opts the whole route into client rendering unless it sits under a Suspense
 * boundary; without one the build fails rather than degrading.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell title="Choose a new password">{null}</AuthShell>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

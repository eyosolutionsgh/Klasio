'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { Button, useAsyncAction } from '@/components/Button';
import { KeyIcon, LockIcon, SaveIcon } from '@/components/icons';

/** Matches the API's `@MinLength(8)`, so the form refuses before a round trip does. */
const MIN_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  /**
   * Two ways in, told apart by which the link carries.
   *
   * `?token=` is the emailed link. `?email=` is the SMS path, where the person holds six digits
   * instead and types them here. No token and no email means the link was truncated in transit,
   * which is the case the guard below still catches.
   */
  const emailParam = params.get('email') ?? '';
  const byCode = !token && !!emailParam;
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useAsyncAction(async () => {
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      // Thrown, not returned: a bare return would settle the button on "Saved!" for a password
      // that was never sent anywhere.
      throw new Error('mismatch');
    }
    setError(null);
    const res = await fetch('/api/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        byCode
          ? { step: 'redeem-code', email: emailParam, code, password }
          : { step: 'redeem', token, password },
      ),
    });
    const data = await res.json().catch(() => ({}));
    // The API's message is shown as-is: used, superseded and expired all call for different
    // actions, and a single "invalid link" would leave the person guessing which.
    if (!res.ok) {
      setError(
        data.error ??
          (byCode
            ? 'That code is not valid. Ask for a new one.'
            : 'That reset link is not valid. Ask for a new one.'),
      );
      throw new Error('rejected');
    }
    setDone(true);
  });

  if (!token && !byCode) {
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
          <Button variant="accent" className="px-10" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      {byCode && (
        <p className="mb-5 text-sm text-oat leading-relaxed">
          Enter the six-digit code sent to the mobile number on{' '}
          <span className="text-ink">{emailParam}</span>, then choose a new password.
        </p>
      )}
      <form onSubmit={submit.run} aria-label="Choose a new password">
        <AuthFieldGroup>
          {byCode && (
            <AuthField
              label="Six-digit code"
              icon={<KeyIcon />}
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
          )}
          <AuthField
            label="New password"
            icon={<LockIcon />}
            revealable
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            autoFocus={!byCode}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <AuthField
            label="Confirm new password"
            icon={<LockIcon />}
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
          {/* "Set" is not a conjugated verb, so the working/settled wording is given explicitly. */}
          <AuthButton
            state={submit.state}
            busyLabel="Saving…"
            doneLabel="Saved!"
            icon={<SaveIcon />}
          >
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

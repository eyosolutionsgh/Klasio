'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';
import { useAsyncAction } from '@/components/Button';
import { LockIcon, UserIcon } from '@/components/icons';

/**
 * Student sign-in: admission number and a PIN the school issues. No email — a JHS student may
 * not have one, but every student knows their admission number.
 */
export default function StudentLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const signIn = useAsyncAction(async (e: React.FormEvent<HTMLFormElement>) => {
    // Read synchronously: `currentTarget` is cleared once the event finishes dispatching, so the
    // form's values have to be lifted out before the first await.
    const f = new FormData(e.currentTarget);
    setError(null);
    const res = await fetch('/api/student-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admissionNo: String(f.get('admissionNo') ?? '').trim(),
        pin: String(f.get('pin') ?? '').trim(),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'That admission number or PIN is not right.');
      // Thrown so the button settles on failed rather than claiming a sign-in that did not happen.
      throw new Error('rejected');
    }
    router.push('/student');
    router.refresh();
  });

  return (
    <AuthShell
      title="Student portal"
      subtitle="Sign in with your admission number and the PIN the school gave you."
      footer={
        <p className="text-[13px] text-oat">Lost your PIN? Ask the school office for a new one.</p>
      }
    >
      <form onSubmit={signIn.run} aria-label="Student sign in">
        <AuthFieldGroup>
          <AuthField
            label="Admission number"
            name="admissionNo"
            icon={<UserIcon />}
            required
            autoFocus
            autoComplete="username"
            placeholder="BA-0001"
            className="tabular"
          />
          <AuthField
            label="PIN"
            name="pin"
            icon={<LockIcon />}
            revealable
            inputMode="numeric"
            autoComplete="current-password"
            required
            minLength={4}
            placeholder="••••••"
            className="tabular tracking-[0.2em]"
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

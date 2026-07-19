'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

/**
 * Student sign-in: admission number and a PIN the school issues. No email — a JHS student may
 * not have one, but every student knows their admission number.
 */
export default function StudentLoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/student-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admissionNo: String(f.get('admissionNo') ?? '').trim(),
        pin: String(f.get('pin') ?? '').trim(),
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/student');
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'That admission number or PIN is not right.');
    }
  }

  return (
    <AuthShell
      title="Student portal"
      subtitle="Sign in with your admission number and the PIN the school gave you."
      footer={
        <p className="text-[13px] text-oat">Lost your PIN? Ask the school office for a new one.</p>
      }
    >
      <form onSubmit={submit} aria-label="Student sign in">
        <AuthFieldGroup>
          <AuthField
            label="Admission number"
            name="admissionNo"
            required
            autoFocus
            autoComplete="username"
            placeholder="BA-0001"
            className="tabular"
          />
          <AuthField
            label="PIN"
            name="pin"
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
          <AuthButton busy={busy} busyLabel="Signing in…">
            Log in
          </AuthButton>
        </div>
      </form>
    </AuthShell>
  );
}

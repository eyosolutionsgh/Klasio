'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Student sign-in: admission number and a PIN the school issues. No email — a JHS student may
 * not have one, but every student knows their admission number.
 */
export default function StudentLoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field =
    'w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 py-3 text-base outline-none focus:border-forest focus:ring-2 focus:ring-forest/15';

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
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-8 relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
        <p className="font-display text-2xl mt-2">Student portal</p>
        <p className="text-sm text-oat mt-1.5">
          Sign in with your admission number and the PIN the school gave you.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm font-medium">
            Admission number
            <input
              name="admissionNo"
              required
              autoFocus
              autoComplete="username"
              placeholder="BA-0001"
              className={`${field} mt-1.5 tabular`}
            />
          </label>
          <label className="block text-sm font-medium">
            PIN
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              minLength={4}
              placeholder="••••••"
              className={`${field} mt-1.5 tabular tracking-[0.2em]`}
            />
          </label>
          <button
            disabled={busy}
            className="w-full min-h-11 rounded-lg bg-forest text-paper font-medium py-3 hover:bg-forest-deep transition disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-danger text-center">{error}</p>}
        <p className="mt-6 text-[11px] text-oat text-center">
          Lost your PIN? Ask the school office for a new one.
        </p>
      </div>
    </main>
  );
}

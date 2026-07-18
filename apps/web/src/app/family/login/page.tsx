'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Guardian sign-in: phone number, then a code by SMS. No password and no email — guardians in
 * Ghana are reachable by phone, and many share a device.
 */
export default function FamilyLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    await fetch('/api/family/guardian/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).catch(() => undefined);
    setBusy(false);
    // Always advance: the API deliberately does not reveal whether a number is registered.
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/guardian-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/family');
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? 'That code is not valid.');
    }
  }

  const field =
    'w-full rounded-lg border border-mist bg-white px-3.5 py-3 text-base outline-none focus:border-forest focus:ring-2 focus:ring-forest/15';

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-8 relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
        <p className="font-display text-2xl mt-2">Parent &amp; guardian</p>
        <p className="text-sm text-oat mt-1.5">
          {step === 'phone'
            ? 'Enter the phone number the school has for you.'
            : `We sent a 6-digit code to ${phone}. It expires in 10 minutes.`}
        </p>

        {step === 'phone' ? (
          <form onSubmit={requestCode} className="mt-6">
            <label className="block text-sm font-medium mb-1.5" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              inputMode="tel"
              required
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 123 4567"
              className={field}
            />
            <button
              disabled={busy}
              className="mt-5 w-full rounded-lg bg-forest text-paper font-medium py-3 hover:bg-forest-deep transition disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6">
            <label className="block text-sm font-medium mb-1.5" htmlFor="code">
              6-digit code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`${field} tabular tracking-[0.3em] text-center`}
            />
            <button
              disabled={busy}
              className="mt-5 w-full rounded-lg bg-forest text-paper font-medium py-3 hover:bg-forest-deep transition disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
              className="mt-3 w-full text-[13px] text-oat hover:text-forest transition"
            >
              Use a different number
            </button>
          </form>
        )}
        {error && <p className="mt-4 text-sm text-danger text-center">{error}</p>}
        <p className="mt-6 text-[11px] text-oat text-center">
          Never share your code. The school will never ask you for it.
        </p>
      </div>
    </main>
  );
}

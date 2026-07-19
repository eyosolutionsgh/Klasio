'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

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

  return (
    <AuthShell
      title="Parent & guardian"
      subtitle={
        step === 'phone'
          ? 'Enter the phone number the school has for you.'
          : `We sent a 6-digit code to ${phone}. It expires in 10 minutes.`
      }
      footer={
        <p className="text-[13px] text-oat">
          Never share your code. The school will never ask you for it.
        </p>
      }
    >
      {step === 'phone' ? (
        <form onSubmit={requestCode} aria-label="Request a sign-in code">
          <AuthFieldGroup>
            <AuthField
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="024 123 4567"
            />
          </AuthFieldGroup>
          {error && <AuthError>{error}</AuthError>}
          <div className="mt-7">
            <AuthButton busy={busy} busyLabel="Sending…">
              Send me a code
            </AuthButton>
          </div>
        </form>
      ) : (
        <form onSubmit={verify} aria-label="Enter your sign-in code">
          <AuthFieldGroup>
            {/*
              Not `revealable`: a one-time code is typed once from a message the person is already
              holding, so a reveal toggle buys nothing and puts the code on screen in a shared room.
            */}
            <AuthField
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="tabular tracking-[0.3em]"
            />
          </AuthFieldGroup>
          {error && <AuthError>{error}</AuthError>}
          <div className="mt-7 flex items-center gap-2 flex-wrap">
            <AuthButton busy={busy} busyLabel="Checking…">
              Sign in
            </AuthButton>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
              className="min-h-11 px-3 text-[13px] text-oat hover:text-brand transition"
            >
              Use a different number
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

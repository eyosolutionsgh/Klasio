'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/AuthShell';
import { AuthButton, AuthError, AuthField, AuthFieldGroup } from '@/components/AuthField';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/dashboard');
      router.refresh();
    } else {
      setError('That email or password is not right. Please try again.');
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} aria-label="Sign in">
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

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowHelp((s) => !s)}
            aria-expanded={showHelp}
            className="min-h-11 text-[13px] text-oat hover:text-brand transition"
          >
            Forgot password?
          </button>
        </div>

        {/*
          There is no self-service reset in this product — the only reset is the one an
          administrator performs from Staff. Rather than a link to a page that cannot exist, this
          says who can actually help, which is what a locked-out teacher needs at 7am.
        */}
        {showHelp && (
          <p className="-mt-1 mb-1 text-[13px] text-oat leading-relaxed bg-parchment/70 border border-mist rounded-lg px-3 py-2.5">
            Ask whoever manages accounts at your school — the proprietor, head or IT administrator.
            They can set a new password for you from <span className="text-ink">Staff</span> in the
            portal.
          </p>
        )}

        {error && <AuthError>{error}</AuthError>}

        <div className="mt-7">
          <AuthButton busy={busy} busyLabel="Signing in…">
            Log in
          </AuthButton>
        </div>

        {/*
          Working credentials, so this must never render anywhere real. It was unconditional:
          anyone reaching a school's login page was handed a bursar account for any deployment
          where the demo seed had been run.
        */}
        {process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'true' && (
          <p className="mt-8 text-xs text-oat leading-relaxed">
            Demo school: <span className="font-medium text-ink">bursar@demo.school</span> ·{' '}
            <span className="font-medium text-ink">head@demo.school</span> ·{' '}
            <span className="font-medium text-ink">teacher@demo.school</span> — password{' '}
            <span className="font-medium text-ink">Password1!</span>
          </p>
        )}
      </form>
    </AuthShell>
  );
}

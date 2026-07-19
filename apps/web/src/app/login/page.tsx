'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <main className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      {/* Centred, not spread: the wordmark and the motto that anchored the top and bottom are
          gone, and justify-between would strand the headline against the ceiling. */}
      <section className="hidden lg:flex flex-col justify-center bg-forest-deep text-paper p-12 relative overflow-hidden">
        <div className="kente-stripe h-1.5 absolute top-0 left-0 right-0" />
        <div className="rise rise-2">
          <h1 className="font-display text-5xl leading-[1.05] max-w-md">
            The school office, <em className="text-gold not-italic">beautifully</em> in order.
          </h1>
          <p className="mt-6 max-w-sm text-paper/70 leading-relaxed">
            Records, attendance, terminal reports and fees — built for private schools in Ghana and
            across Africa.
          </p>
        </div>
        <div
          className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(circle, #c9982f 0%, transparent 70%)' }}
        />
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm rise rise-2" aria-label="Sign in">
          <div className="lg:hidden mb-10">
            <p className="font-display text-2xl text-forest">EYO</p>
          </div>
          {/* The strapline below this carried the gap to the first field; it moves onto the
              heading now that it is gone. */}
          <h2 className="font-display text-3xl text-ink mb-8">Sign in</h2>

          <label className="block text-sm font-medium mb-1.5" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-forest focus:ring-2 focus:ring-forest/15 transition"
            placeholder="you@school.edu.gh"
          />

          <label className="block text-sm font-medium mb-1.5 mt-5" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-forest focus:ring-2 focus:ring-forest/15 transition"
            placeholder="••••••••"
          />

          {error && (
            <p
              role="alert"
              className="mt-4 text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-7 w-full rounded-lg bg-forest text-paper font-medium py-2.5 hover:bg-forest-deep transition disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

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
      </section>
    </main>
  );
}

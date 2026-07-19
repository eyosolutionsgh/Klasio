'use client';

import { useActionState } from 'react';
import { signIn } from '@/lib/actions';

export default function LoginPage() {
  const [error, action, pending] = useActionState(signIn, null);

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <form action={action} className="card p-8 w-full max-w-sm">
        <p className="text-[11px] uppercase tracking-widest text-oat">Klasio</p>
        <h1 className="text-2xl font-semibold mt-1">Licensing</h1>
        <p className="text-sm text-oat mt-2">
          Vendor staff only. This is not a school&apos;s portal.
        </p>

        <label className="block mt-6 text-sm">
          <span className="text-oat">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>
        <label className="block mt-4 text-sm">
          <span className="text-oat">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-mist px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded bg-navy text-paper py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

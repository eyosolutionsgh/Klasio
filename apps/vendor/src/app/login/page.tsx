'use client';

import { useActionState } from 'react';
import { signIn } from '@/lib/actions';

export default function LoginPage() {
  const [error, action, pending] = useActionState(signIn, null);

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center">
          {/* The mark, at the size a wordmark deserves when it is the only thing on the page. */}
          <img src="/brand/klasio-lockup.png" alt="Klasio" className="h-12 w-auto" />
          <p className="mt-4 text-sm text-slate">Licensing &amp; monitoring</p>
        </div>

        {/*
          One field, because there is no password. What signs somebody in is a code — emailed, or
          from their authenticator — and this step only says who is asking.
        */}
        <form action={action} className="card p-7 mt-6">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              className="field"
            />
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}

          <button type="submit" disabled={pending} className="btn btn-primary w-full mt-6">
            {pending ? 'Continuing…' : 'Continue'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-oat">
          We will send you a sign-in code. For Klasio staff — schools sign in on their own server.
        </p>
      </div>
    </main>
  );
}

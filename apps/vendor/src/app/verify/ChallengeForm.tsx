'use client';

import { useActionState, useState } from 'react';
import { requestEmailCode, verifyMfa } from '@/lib/actions';

type Factor = 'totp' | 'email' | 'recovery';

/**
 * Three ways to sign in, one at a time.
 *
 * The emailed code leads because a code was already sent when the address was submitted, so for
 * most people it is waiting for them. The authenticator is offered to everyone rather than only to
 * those enrolled — the page has no account to ask, and offering it conditionally would answer
 * "does this address have an authenticator?" to anybody who typed it.
 */
export default function ChallengeForm({ canEmail }: { canEmail: boolean }) {
  const [error, action, pending] = useActionState(verifyMfa, null);
  const [emailState, sendEmail, sending] = useActionState(requestEmailCode, null);
  const [factor, setFactor] = useState<Factor>(canEmail ? 'email' : 'totp');
  const [sent, setSent] = useState(false);

  const label =
    factor === 'totp'
      ? 'Code from your authenticator app'
      : factor === 'email'
        ? 'Code we emailed you'
        : 'One of your recovery codes';

  const hint =
    factor === 'email'
      ? 'Sent when you entered your address. It works for 10 minutes.'
      : factor === 'totp'
        ? 'Six digits, from the app you set up.'
        : 'Each one works once.';

  return (
    <>
      <form action={action}>
        <input type="hidden" name="factor" value={factor} />
        <label htmlFor="code" className="label">
          {label}
        </label>
        <p className="text-xs text-oat mb-1.5 -mt-1">{hint}</p>
        <input
          id="code"
          name="code"
          inputMode={factor === 'recovery' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          autoFocus
          placeholder={factor === 'recovery' ? 'XXXXX-XXXXX' : '000000'}
          className={`field font-mono ${factor === 'recovery' ? '' : 'text-center tracking-[0.4em]'}`}
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full mt-4">
          {pending ? 'Checking…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-5 border-t border-mist pt-4 text-xs text-slate space-y-2">
        {factor !== 'totp' && (
          <button
            type="button"
            onClick={() => setFactor('totp')}
            className="block text-navy underline"
          >
            Use my authenticator app
          </button>
        )}

        {canEmail && factor !== 'email' && (
          <button
            type="button"
            onClick={() => setFactor('email')}
            className="block text-navy underline"
          >
            Email a code to me instead
          </button>
        )}

        {factor === 'email' && (
          /*
            Its own form, so asking for a code cannot submit the code field beside it — and so a
            failed send reports separately from a failed code.
          */
          <form action={sendEmail} onSubmit={() => setSent(true)}>
            <button type="submit" disabled={sending} className="text-navy underline">
              {sending ? 'Sending…' : 'Send another code'}
            </button>
            {emailState ? (
              <span role="alert" className="block text-danger mt-1">
                {emailState}
              </span>
            ) : (
              sent &&
              !sending && (
                <span className="block text-oat mt-1">Sent. It works for 10 minutes.</span>
              )
            )}
          </form>
        )}

        {factor !== 'recovery' && (
          <button
            type="button"
            onClick={() => setFactor('recovery')}
            className="block text-navy underline"
          >
            I have lost my phone
          </button>
        )}
      </div>
    </>
  );
}

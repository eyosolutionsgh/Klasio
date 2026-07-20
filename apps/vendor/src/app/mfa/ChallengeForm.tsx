'use client';

import { useActionState, useState } from 'react';
import { requestEmailCode, verifyMfa } from '@/lib/actions';

type Factor = 'totp' | 'email' | 'recovery';

/**
 * Three ways to finish signing in, one at a time.
 *
 * The authenticator app leads because it is the one that always works — it needs no network, no
 * mail provider and no inbox, which on a portal sold partly on working from anywhere is the point.
 * Email is offered only when this server can actually send, so nobody clicks an option that was
 * never going to arrive.
 */
export default function ChallengeForm({ canEmail }: { canEmail: boolean }) {
  const [error, action, pending] = useActionState(verifyMfa, null);
  const [emailState, sendEmail, sending] = useActionState(requestEmailCode, null);
  const [factor, setFactor] = useState<Factor>('totp');
  const [sent, setSent] = useState(false);

  const label =
    factor === 'totp'
      ? 'Code from your authenticator app'
      : factor === 'email'
        ? 'Code we emailed you'
        : 'One of your recovery codes';

  return (
    <>
      <form action={action}>
        <input type="hidden" name="factor" value={factor} />
        <label htmlFor="code" className="label">
          {label}
        </label>
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
              {sending ? 'Sending…' : sent ? 'Send another code' : 'Send me a code'}
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

'use client';

import { useState, useTransition } from 'react';
import { turnOffAuthenticator } from '@/lib/actions';

/**
 * The switch that turns an authenticator app on and off.
 *
 * Off → on reveals the setup steps rather than doing anything: the secret is not real until a code
 * from it has been accepted, so the switch only sits at "on" once enrolment has actually finished.
 * A switch that flipped itself the moment it was pressed would claim a factor nobody had proved
 * they held.
 *
 * On → off is the side that can hurt, so it asks first and says what it costs. It is also refused
 * outright by the server when email is unavailable, because then this is the only way in — the
 * button being absent is not the guard, `disableAuthenticator` is.
 */
export default function AuthenticatorToggle({
  enrolled,
  canTurnOff,
  whyNot,
  children,
}: {
  enrolled: boolean;
  canTurnOff: boolean;
  /** Shown in place of the switch when turning it off would lock this account out. */
  whyNot?: string;
  /** The enrolment steps, revealed by switching on. */
  children: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const on = enrolled || revealed;

  function toggle() {
    setError(null);
    if (!enrolled) {
      setRevealed((v) => !v);
      return;
    }
    setConfirming(true);
  }

  function confirmOff() {
    startTransition(async () => {
      const result = await turnOffAuthenticator();
      if (result.error) setError(result.error);
      else setConfirming(false);
    });
  }

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Enable authenticator app</p>
          <p className="text-sm text-slate mt-0.5">
            {enrolled
              ? 'On. You can sign in with a code from your app instead of waiting for email — which also works when this server cannot send mail, or you cannot reach your inbox.'
              : 'Optional, and worth it: a code from an app arrives instantly and needs no inbox.'}
          </p>
        </div>

        {canTurnOff || !enrolled ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Enable authenticator app"
            onClick={toggle}
            disabled={pending}
            className={`relative shrink-0 mt-0.5 h-6 w-11 rounded-full transition disabled:opacity-60 ${
              on ? 'bg-teal' : 'bg-mist'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                on ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        ) : (
          <span className="shrink-0 text-xs text-oat max-w-[13rem] text-right">{whyNot}</span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {confirming && (
        <div className="mt-4 rounded-lg border border-mist bg-hush/60 p-4">
          <p className="text-sm font-medium text-ink">Turn the authenticator off?</p>
          <p className="text-sm text-slate mt-1">
            You will sign in with an emailed code until you set one up again. Your recovery codes
            stop working — they exist to get past a missing authenticator, so they go with it.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={confirmOff}
              disabled={pending}
              className="btn btn-primary"
            >
              {pending ? 'Turning off…' : 'Turn it off'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="btn"
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {!enrolled && revealed && children}
    </div>
  );
}

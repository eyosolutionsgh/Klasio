'use client';

import { useActionState } from 'react';
import { completeEnrolment, finishEnrolment, type EnrolmentResult } from '@/lib/actions';

const EMPTY: EnrolmentResult = {};

/**
 * The last step of enrolment, and the only moment recovery codes exist in readable form.
 *
 * They are stored hashed, so the portal genuinely cannot show them again — which is why this
 * replaces the form rather than flashing a message: somebody who navigates away has lost them, and
 * the screen should be hard to leave by accident.
 */
export default function EnrolForm() {
  const [result, action, pending] = useActionState(completeEnrolment, EMPTY);

  if (result.recoveryCodes) {
    return (
      <div className="mt-4">
        <p className="text-sm font-medium">Save these recovery codes now.</p>
        <p className="text-xs text-slate mt-1">
          Each one signs you in once if you lose your phone. They cannot be shown again — this
          portal stores them hashed and cannot read them back.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[13px] select-all">
          {result.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        {/* A form, not a link: this is the step that exchanges the pending session for a real one. */}
        <form action={finishEnrolment}>
          <button type="submit" className="btn btn-primary w-full mt-6">
            I have saved them — continue
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="mt-3">
      <label htmlFor="code" className="sr-only">
        Six-digit code
      </label>
      <input
        id="code"
        name="code"
        // Numeric keypad on a phone, and no autocorrect mangling a code that is only digits.
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
        autoFocus
        placeholder="000000"
        className="field text-center tracking-[0.4em] font-mono"
      />
      {result.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {result.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full mt-4">
        {pending ? 'Checking…' : 'Confirm and sign in'}
      </button>
    </form>
  );
}

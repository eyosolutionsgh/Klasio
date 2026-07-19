'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useAsyncAction } from './Button';
import { CloseIcon, KeyIcon, TrashIcon } from './icons';

/**
 * Give a student their sign-in PIN, or take it away.
 *
 * The student portal was fully built — a login page, a session route, a whole student view — and
 * nothing anywhere could issue the PIN it asks for. The login page told children "ask the school
 * office for a new one" and the office had no button. This is that button.
 *
 * The PIN is shown once, here, at the moment it is created. The API stores only a hash, so it
 * genuinely cannot be recovered afterwards — losing it means issuing a new one, which is the
 * right trade for a credential a child carries.
 */
export default function StudentPortalAccess({
  studentId,
  studentName,
  admissionNo,
  hasPin,
}: {
  studentId: string;
  studentName: string;
  admissionNo: string;
  hasPin: boolean;
}) {
  const router = useRouter();
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}/portal-pin`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.message ?? 'Could not create a PIN.');
      throw new Error('rejected');
    }
    setPin(body.pin);
    router.refresh();
  });

  const revoke = useAsyncAction(async () => {
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}/portal-pin`, { method: 'DELETE' });
    if (!res.ok) {
      setError('Could not remove the PIN.');
      throw new Error('rejected');
    }
    setPin(null);
    router.refresh();
  });

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">Student sign-in</h2>
      <p className="text-xs text-oat mt-1">
        Lets {studentName} see their own terminal reports and school notices at the student portal.
      </p>

      {pin ? (
        <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-4">
          <p className="text-[11px] uppercase tracking-widest text-oat">Write this down now</p>
          <p className="font-display text-3xl tabular tracking-[0.2em] mt-1">{pin}</p>
          <p className="text-[12px] text-oat mt-2">
            Sign in with admission number{' '}
            <span className="font-medium text-ink">{admissionNo}</span> and this PIN. It is stored
            scrambled, so nobody — including the school — can look it up later. If it is lost,
            create a new one.
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={<CloseIcon />}
            className="mt-3"
            onClick={() => setPin(null)}
          >
            Done — hide it
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {/* KeyIcon: what the button hands over is a credential, not a saved record. */}
          <Button
            onClick={issue.run}
            state={issue.state}
            icon={<KeyIcon />}
            disabled={revoke.state === 'pending'}
          >
            {hasPin ? 'Create a new PIN' : 'Create a PIN'}
          </Button>
          {hasPin && (
            <>
              <span className="text-[12px] text-leaf">Can sign in</span>
              {/* The confirm stays outside `run`, so backing out of it does not read as done. */}
              <Button
                onClick={() => {
                  if (
                    !confirm(
                      `Stop ${studentName} signing in? They will need a new PIN to get back in.`,
                    )
                  )
                    return;
                  revoke.run();
                }}
                state={revoke.state}
                variant="danger"
                size="sm"
                icon={<TrashIcon />}
                disabled={issue.state === 'pending'}
              >
                Remove access
              </Button>
            </>
          )}
          {!hasPin && <span className="text-[12px] text-oat">No PIN yet — cannot sign in</span>}
        </div>
      )}

      {hasPin && !pin && (
        <p className="text-[11px] text-oat mt-2">
          Creating a new PIN replaces the old one straight away.
        </p>
      )}
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
    </section>
  );
}

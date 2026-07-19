'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}/portal-pin`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setPin(body.pin);
      router.refresh();
    } else {
      setError(body.message ?? 'Could not create a PIN.');
    }
  }

  async function revoke() {
    if (!confirm(`Stop ${studentName} signing in? They will need a new PIN to get back in.`))
      return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/proxy/students/${studentId}/portal-pin`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      setPin(null);
      router.refresh();
    } else {
      setError('Could not remove the PIN.');
    }
  }

  return (
    <section className="card p-6 rise rise-4">
      <h2 className="font-display text-xl">Student sign-in</h2>
      <p className="text-xs text-oat mt-1">
        Lets {studentName} see their own report cards and school notices at the student portal.
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
          <button
            onClick={() => setPin(null)}
            className="mt-3 text-[12px] font-medium text-brand hover:underline underline-offset-2"
          >
            Done — hide it
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={issue}
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand text-paper text-sm font-medium px-4 hover:bg-brand-deep transition disabled:opacity-60"
          >
            {busy ? 'Working…' : hasPin ? 'Create a new PIN' : 'Create a PIN'}
          </button>
          {hasPin && (
            <>
              <span className="text-[12px] text-leaf">Can sign in</span>
              <button
                onClick={revoke}
                disabled={busy}
                className="min-h-11 px-3 text-[12.5px] text-oat hover:text-danger transition"
              >
                Remove access
              </button>
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

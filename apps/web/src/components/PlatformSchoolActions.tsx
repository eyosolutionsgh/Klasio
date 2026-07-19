'use client';

import { useState } from 'react';
import { isSignedOut, platformCall } from '@/lib/platform-client';

export interface ActionableSchool {
  id: string;
  name: string;
  suspended: boolean;
}

/**
 * The four things Klasio can do to one school: close its doors, open them again, say something to
 * it, and — only when its proprietor is locked out with nobody left to help — hand back the keys.
 *
 * Shared by the school list and the school detail page so the two cannot drift — the wording of
 * a suspension warning is not something that should depend on which screen you happened to be
 * on when you did it.
 */
export default function PlatformSchoolActions({
  school,
  onDone,
  onError,
  compact = false,
}: {
  school: ActionableSchool;
  /** Called after anything succeeds, with a sentence for the caller to show. */
  onDone: (note: string) => void;
  onError: (message: string) => void;
  /** List rows want buttons only; the detail page has room for the form inline. */
  compact?: boolean;
}) {
  const [contacting, setContacting] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<'INFO' | 'WARNING'>('INFO');
  const [busy, setBusy] = useState(false);
  /** Shown once, never fetchable again — so it lives here until the page is left. */
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const btn =
    'min-h-11 rounded-lg text-sm font-medium px-4 transition disabled:opacity-50 disabled:cursor-not-allowed';

  async function run(fn: () => Promise<unknown>, note: string) {
    setBusy(true);
    try {
      await fn();
      onDone(note);
    } catch (e) {
      if (!isSignedOut(e)) onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function suspend() {
    // `window.confirm`/`prompt` is the house pattern for destructive confirmation here, and the
    // text spells out the consequence rather than asking "are you sure?".
    const reason = window.prompt(
      `Suspend ${school.name}?\n\nNobody at the school will be able to sign in, and anyone already signed in stops at their next click. No records are deleted and nothing is downgraded.\n\nReason (the school is shown this):`,
    );
    if (!reason?.trim()) return;
    run(
      () =>
        platformCall(`schools/${school.id}/suspend`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      `${school.name} suspended.`,
    );
  }

  function restore() {
    if (!window.confirm(`Restore access for ${school.name}? They will be able to sign in again.`))
      return;
    run(
      () => platformCall(`schools/${school.id}/restore`, { method: 'POST' }),
      `${school.name} restored.`,
    );
  }

  /**
   * Hand a locked-out proprietor their school back.
   *
   * Gated behind typing the school's name rather than an "are you sure?", because this is the one
   * button in the console that creates a working credential for someone else's school. The
   * confirmation text says what the school will see, since they are told either way — a vendor
   * that can quietly change a proprietor's password is indistinguishable from a compromised one.
   */
  function resetOwner() {
    const typed = window.prompt(
      `Reset the owner password for ${school.name}?\n\n` +
        `Only do this once you have confirmed, by phone, that you are speaking to the proprietor.\n\n` +
        `A new password is shown once. Every device signed in as the owner is signed out, any reset link they already asked for stops working, and the school is told in their portal that Klasio did this.\n\n` +
        `Type the school's name to confirm:`,
    );
    if (typed?.trim().toLowerCase() !== school.name.trim().toLowerCase()) return;
    run(async () => {
      const res = await platformCall<{
        owner: { name: string; email: string };
        temporaryPassword: string;
      }>(`schools/${school.id}/reset-owner-password`, { method: 'POST' });
      setIssued({ email: res.owner.email, password: res.temporaryPassword });
    }, `A new owner password was issued for ${school.name}.`);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        platformCall(`schools/${school.id}/contact`, {
          method: 'POST',
          body: JSON.stringify({ subject, body, level }),
        }),
      `Notice sent to ${school.name}.`,
    ).then(() => {
      setContacting(false);
      setSubject('');
      setBody('');
      setLevel('INFO');
    });
  }

  return (
    <div className={compact ? '' : 'mt-4'}>
      <div className="flex gap-2 flex-wrap">
        <button
          disabled={busy}
          onClick={() => setContacting((c) => !c)}
          className={`${btn} border border-mist bg-white hover:border-ink`}
        >
          Contact
        </button>
        <button
          disabled={busy}
          onClick={resetOwner}
          className={`${btn} border border-mist bg-white hover:border-ink`}
        >
          Reset owner password
        </button>
        {school.suspended ? (
          <button
            disabled={busy}
            onClick={restore}
            className={`${btn} bg-ink text-paper hover:bg-ink/90`}
          >
            Restore
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={suspend}
            className={`${btn} border border-danger/40 text-danger bg-white hover:bg-danger/5`}
          >
            Suspend
          </button>
        )}
      </div>

      {issued && (
        <div className="card p-5 mt-3 border-danger/30">
          <p className="text-[12.5px] text-oat leading-relaxed">
            Read this to <span className="text-ink">{issued.email}</span> now. It is shown once and
            cannot be retrieved — if it is lost, issue another.
          </p>
          <p className="mt-3 font-mono text-lg tracking-wider text-ink select-all">
            {issued.password}
          </p>
          <button
            onClick={() => setIssued(null)}
            className={`${btn} border border-mist bg-white hover:border-ink mt-4`}
          >
            Done
          </button>
        </div>
      )}

      {contacting && (
        <form onSubmit={send} className={compact ? 'card p-5 mt-3' : 'mt-4'}>
          <p className="text-[12.5px] text-oat leading-relaxed">
            This appears inside their portal, marked as coming from Klasio. It is not an
            announcement in their own name, and it does not spend their SMS credits.
          </p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="Subject"
            className="mt-3 w-full min-h-11 rounded-lg border border-mist bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={2}
            maxLength={4000}
            rows={5}
            placeholder="Message"
            className="mt-3 w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={level === 'WARNING'}
                onChange={(e) => setLevel(e.target.checked ? 'WARNING' : 'INFO')}
              />
              Needs their attention
            </label>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setContacting(false)}
                className={`${btn} border border-mist bg-white hover:border-ink`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`${btn} bg-brand text-paper hover:bg-brand-deep`}
              >
                {busy ? 'Sending…' : 'Send notice'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

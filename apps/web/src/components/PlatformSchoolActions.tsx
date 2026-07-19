'use client';

import { useState } from 'react';
import { isSignedOut, platformCall } from '@/lib/platform-client';
import { Button, useAsyncAction } from '@/components/Button';
import { KeyIcon, LockIcon, RefreshIcon, SendIcon } from '@/components/icons';

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
  /** Shown once, never fetchable again — so it lives here until the page is left. */
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  /**
   * Run one console action, tell the caller how it went, then rethrow.
   *
   * The rethrow is what lets the button that started it settle on a failure rather than a tick:
   * `useAsyncAction` reads a rejection, not a return value.
   */
  async function call(fn: () => Promise<unknown>, note: string) {
    try {
      await fn();
      onDone(note);
    } catch (e) {
      if (!isSignedOut(e)) onError((e as Error).message);
      throw e;
    }
  }

  const suspendAction = useAsyncAction((reason: string) =>
    call(
      () =>
        platformCall(`schools/${school.id}/suspend`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      `${school.name} suspended.`,
    ),
  );

  const restoreAction = useAsyncAction(() =>
    call(
      () => platformCall(`schools/${school.id}/restore`, { method: 'POST' }),
      `${school.name} restored.`,
    ),
  );

  const resetAction = useAsyncAction(() =>
    call(async () => {
      const res = await platformCall<{
        owner: { name: string; email: string };
        temporaryPassword: string;
      }>(`schools/${school.id}/reset-owner-password`, { method: 'POST' });
      setIssued({ email: res.owner.email, password: res.temporaryPassword });
    }, `A new owner password was issued for ${school.name}.`),
  );

  const sendAction = useAsyncAction(async () => {
    await call(
      () =>
        platformCall(`schools/${school.id}/contact`, {
          method: 'POST',
          body: JSON.stringify({ subject, body, level }),
        }),
      `Notice sent to ${school.name}.`,
    );
    // Only reached when the send actually landed, so a rejected notice keeps its typing.
    setContacting(false);
    setSubject('');
    setBody('');
    setLevel('INFO');
  });

  /** One action at a time, as before — the console talks to a live school. */
  const busy = [suspendAction, restoreAction, resetAction, sendAction].some(
    (a) => a.state === 'pending',
  );

  function suspend() {
    // `window.confirm`/`prompt` is the house pattern for destructive confirmation here, and the
    // text spells out the consequence rather than asking "are you sure?".
    const reason = window.prompt(
      `Suspend ${school.name}?\n\nNobody at the school will be able to sign in, and anyone already signed in stops at their next click. No records are deleted and nothing is downgraded.\n\nReason (the school is shown this):`,
    );
    // Answered before the action starts, so backing out of the prompt leaves the button idle
    // rather than ticking for something that never ran. The catch is only there to keep a
    // rejection from going unhandled — `call` has already shown the reason.
    if (!reason?.trim()) return;
    void suspendAction.run(reason.trim()).catch(() => {});
  }

  function restore() {
    if (!window.confirm(`Restore access for ${school.name}? They will be able to sign in again.`))
      return;
    void restoreAction.run().catch(() => {});
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
    void resetAction.run().catch(() => {});
  }

  return (
    <div className={compact ? '' : 'mt-4'}>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setContacting((c) => !c)}
          // No icon: this writes a notice inside their portal, and a mail glyph would promise
          // an email the school never gets.
        >
          Contact
        </Button>
        <Button
          variant="secondary"
          icon={<KeyIcon />}
          disabled={busy}
          state={resetAction.state}
          onClick={resetOwner}
          pendingLabel="Resetting…"
          doneLabel="New password issued"
          failedLabel="Couldn't reset"
        >
          Reset owner password
        </Button>
        {school.suspended ? (
          <Button
            icon={<RefreshIcon />}
            disabled={busy}
            state={restoreAction.state}
            onClick={restore}
            pendingLabel="Restoring…"
            doneLabel="Restored!"
            failedLabel="Couldn't restore"
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="danger"
            icon={<LockIcon />}
            disabled={busy}
            state={suspendAction.state}
            onClick={suspend}
            pendingLabel="Suspending…"
            doneLabel="Suspended"
            failedLabel="Couldn't suspend"
          >
            Suspend
          </Button>
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
          <Button variant="secondary" className="mt-4" onClick={() => setIssued(null)}>
            Done
          </Button>
        </div>
      )}

      {contacting && (
        <form onSubmit={sendAction.run} className={compact ? 'card p-5 mt-3' : 'mt-4'}>
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
              <Button type="button" variant="secondary" onClick={() => setContacting(false)}>
                Cancel
              </Button>
              <Button type="submit" icon={<SendIcon />} state={sendAction.state}>
                Send notice
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

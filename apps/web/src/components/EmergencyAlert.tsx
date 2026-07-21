'use client';

import { useEffect, useState } from 'react';
import { Button, useAsyncAction } from '@/components/Button';

const KINDS = [
  { value: 'LOCKDOWN', label: 'Lockdown', hint: 'Threat on or near the premises. Doors locked.' },
  { value: 'EVACUATION', label: 'Evacuation', hint: 'Leave the buildings now.' },
  { value: 'ALL_CLEAR', label: 'All clear', hint: 'The earlier alert is over.' },
  { value: 'GENERAL', label: 'Urgent notice', hint: 'Anything else that cannot wait.' },
] as const;

/**
 * The red button. Texts every family and every member of staff at once, and posts to every
 * portal — so it hides from anyone without the permission, and demands the alert word be typed
 * back before it will send. A tap can be accidental; typing LOCKDOWN is a decision.
 */
export default function EmergencyAlert() {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('LOCKDOWN');
  const [message, setMessage] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState('');

  useEffect(() => {
    fetch('/api/proxy/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        const perms: string[] = me?.permissions ?? me?.user?.permissions ?? [];
        setAllowed(me?.user?.role === 'OWNER' || perms.includes('safety.emergency'));
      })
      .catch(() => setAllowed(false));
  }, []);

  // One key per opened form: reopening composes a new alert, retrying the same form does not.
  useEffect(() => {
    if (open) setKey(crypto.randomUUID());
  }, [open]);

  const requiredWord = KINDS.find((k) => k.value === kind)!
    .label.toUpperCase()
    .replace(' ', ' ');

  const send = useAsyncAction(async () => {
    setError(null);
    const res = await fetch('/api/proxy/broadcasts/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message: message.trim(), idempotencyKey: key }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.message ?? 'Could not send the alert.');
      throw new Error('rejected');
    }
    setDone('Alert sent to every family and every member of staff.');
    setOpen(false);
    setMessage('');
    setConfirmWord('');
  });

  if (!allowed) return null;

  return (
    <section className="card p-6 rise rise-3 border-danger/30">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-danger">Emergency</h2>
          <p className="text-sm text-oat mt-1">
            Lockdown, evacuation or an urgent notice — everyone, at once.
          </p>
        </div>
        {!open && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Raise an alert…
          </Button>
        )}
      </div>

      {done && !open && (
        <p className="text-sm text-leaf bg-leaf/10 border border-leaf/20 rounded-lg px-3 py-2 mt-3">
          {done}
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                onClick={() => {
                  setKind(k.value);
                  setConfirmWord('');
                }}
                className={`text-left rounded-lg border px-4 py-3 transition ${
                  kind === k.value
                    ? 'border-danger bg-danger/5'
                    : 'border-mist hover:border-danger/50'
                }`}
              >
                <span className="block text-sm font-medium">{k.label}</span>
                <span className="block text-[12px] text-oat mt-0.5">{k.hint}</span>
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="What is happening and what should people do? This goes out word for word."
            className="w-full rounded-lg border border-mist bg-white px-3.5 py-2.5 text-sm outline-none focus:border-danger focus:ring-2 focus:ring-danger/15"
          />
          <label className="block text-[13px]">
            <span className="block text-oat mb-1">
              Type <span className="font-medium text-danger">{requiredWord}</span> to confirm — this
              texts every family and every member of staff, and cannot be recalled.
            </span>
            <input
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              className="w-48 min-h-11 rounded-lg border border-mist bg-white px-3.5 py-2 text-sm outline-none focus:border-danger"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              variant="danger"
              onClick={send.run}
              state={send.state}
              disabled={
                message.trim().length < 10 || confirmWord.trim().toUpperCase() !== requiredWord
              }
              pendingLabel="Sending…"
              doneLabel="Sent"
              failedLabel="Couldn't send"
            >
              Send alert now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}

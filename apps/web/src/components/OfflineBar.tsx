'use client';

import { useCallback, useEffect, useState } from 'react';
import { flush, pending, type FlushFailure } from '@/lib/offline';

/**
 * Tells the user the truth about where their work is: on this device, or on the server.
 *
 * Silence would be worse than a warning — a teacher who does not know the register is only
 * saved locally might close the tab on a different device and assume it is done.
 */
export default function OfflineBar() {
  const [online, setOnline] = useState(true);
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /**
   * Discarded writes stay on screen until dismissed.
   *
   * A note that fades after six seconds is fine for "3 synced" and useless for "your Basic 4
   * register was rejected" — that one needs re-entering, and the teacher has to be able to read
   * which one it was. Previously the whole message only appeared when something *had* synced, so
   * a flush that discarded three registers and saved none rendered nothing at all and the
   * "3 waiting" counter simply dropped to zero, which reads as success.
   */
  const [discarded, setDiscarded] = useState<FlushFailure[]>([]);
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCount((await pending()).length);
    } catch {
      /* IndexedDB unavailable (private mode) — the app still works online. */
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    const res = await flush();
    setSyncing(false);
    await refresh();
    setExpired(res.needsSignIn);
    if (res.failures.length > 0) setDiscarded((d) => [...d, ...res.failures]);
    if (res.synced > 0) {
      setNote(`${res.synced} change${res.synced === 1 ? '' : 's'} synced.`);
      setTimeout(() => setNote(null), 6000);
    }
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();

    const goOnline = () => {
      setOnline(true);
      sync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Anything left from a previous session goes out as soon as we load.
    if (navigator.onLine) sync();

    const poll = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(poll);
    };
  }, [refresh, sync]);

  if (online && count === 0 && !note && discarded.length === 0 && !expired) return null;

  return (
    <div className="no-print mb-4 space-y-2">
      {/* Nothing was lost here — the work is still on the device, waiting for a valid session. */}
      {expired && (
        <div
          role="alert"
          className="rounded-lg border border-gold/40 bg-gold-soft/50 px-4 py-2.5 text-[13px] text-ink"
        >
          Your session has expired, so{' '}
          {count > 0
            ? `${count} saved change${count === 1 ? '' : 's'} could not be sent`
            : 'changes could not be sent'}
          . They are still on this device —{' '}
          <a href="/login" className="underline underline-offset-2 font-medium">
            sign in again
          </a>{' '}
          and they will sync.
        </div>
      )}

      {/* These are gone. Name them, and let the teacher dismiss it when they have re-entered. */}
      {discarded.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-[13px] text-ink"
        >
          <p className="font-medium text-danger">
            {discarded.length} change{discarded.length === 1 ? '' : 's'} could not be saved and{' '}
            {discarded.length === 1 ? 'was' : 'were'} discarded. Please enter{' '}
            {discarded.length === 1 ? 'it' : 'them'} again.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {discarded.map((f, i) => (
              <li key={i} className="text-oat">
                <span className="text-ink">{f.label}</span> — {f.message}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setDiscarded([])}
            className="mt-2 underline underline-offset-2 text-[12.5px] text-oat hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {(!online || count > 0 || note) && (
        <div
          role="status"
          className={`rounded-lg px-4 py-2.5 text-[13px] flex items-center justify-between gap-3 ${
            !online
              ? 'bg-clay/10 border border-clay/30 text-clay'
              : count > 0
                ? 'bg-gold-soft/50 border border-gold/30 text-ink'
                : 'bg-leaf/10 border border-leaf/20 text-leaf'
          }`}
        >
          <span>
            {!online
              ? count > 0
                ? `Offline — ${count} change${count === 1 ? '' : 's'} saved on this device. They will sync when the connection returns.`
                : 'Offline — your work will be saved on this device and synced later.'
              : syncing
                ? 'Syncing…'
                : count > 0
                  ? `${count} change${count === 1 ? '' : 's'} waiting to sync.`
                  : note}
          </span>
          {online && count > 0 && !syncing && (
            <button onClick={sync} className="shrink-0 underline underline-offset-2 font-medium">
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

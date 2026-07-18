'use client';

import { useCallback, useEffect, useState } from 'react';
import { flush, pending } from '@/lib/offline';

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
    if (res.synced > 0) {
      setNote(
        `${res.synced} change${res.synced === 1 ? '' : 's'} synced.` +
          (res.failed ? ` ${res.failed} could not be saved and were discarded.` : ''),
      );
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

  if (online && count === 0 && !note) return null;

  return (
    <div
      role="status"
      className={`no-print mb-4 rounded-lg px-4 py-2.5 text-[13px] flex items-center justify-between gap-3 ${
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
  );
}

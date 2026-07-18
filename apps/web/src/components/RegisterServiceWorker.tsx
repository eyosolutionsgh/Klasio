'use client';

import { useEffect } from 'react';

/** Registers the app-shell cache so the portal opens without a connection. */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registration failing is not worth surfacing — the app works online regardless.
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}

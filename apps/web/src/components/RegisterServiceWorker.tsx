'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell cache so the portal opens without a connection.
 *
 * Two things this deliberately does not do.
 *
 * **It does not register in development.** Next serves dev chunks under stable, unhashed names —
 * `/_next/static/chunks/main.js` and friends — and the worker caches `/_next/static` cache-first
 * because in production those names carry a content hash and are immutable. In development that
 * combination pins the first copy of every chunk forever: pages fetch fresh HTML and then hydrate
 * with stale code, so an edit appears to do nothing. That cost real time to diagnose, and no part
 * of offline support is useful while running a dev server anyway.
 *
 * **It does not register at a constant URL.** The browser only looks for a new worker when the
 * registration URL changes (or after 24 hours), so the build id rides in the query string. That is
 * also where the worker reads its cache name from, which is what makes a deploy actually rotate
 * the cache.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      /**
       * Clean up after a worker an earlier build installed, caches included — unregistering alone
       * leaves the cached chunks behind.
       *
       * This cannot rescue a machine that already has the old worker: that worker serves the old
       * bundle, so this code never runs to do the rescuing. Anyone in that state clears it once by
       * hand (DevTools → Application → Service workers → Unregister). From then on the guard keeps
       * it from happening again.
       */
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .then(() => caches.keys())
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith('eyo-shell-')).map((k) => caches.delete(k))),
        )
        .catch(() => undefined);
      return;
    }

    // Registration failing is not worth surfacing — the app works online regardless.
    void navigator.serviceWorker.register(`/sw.js?v=${BUILD_ID}`).catch(() => undefined);

    /**
     * Reload once when a new worker takes over.
     *
     * The worker calls skipWaiting and clients.claim, so it activates immediately and deletes the
     * previous build's cache. Any tab still open is then running code whose lazily-loaded chunks
     * have gone from both the cache and the server. `controller` is null on a first install, so
     * this only fires for an update — never on the visit that installs the worker.
     */
    if (!navigator.serviceWorker.controller) return;
    let reloading = false;
    const onChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);
  return null;
}

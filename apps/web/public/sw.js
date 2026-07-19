/*
 * App-shell cache so the portal opens when the network does not.
 *
 * Without this the offline write queue is useless on a reload: the teacher would face a browser
 * error page rather than the register. Deliberately conservative —
 *   - build assets are immutable, so cache-first
 *   - pages are network-first with a cached fallback, so nobody sees stale data while online
 *   - API calls are never cached; a stale balance or register is worse than an honest failure,
 *     and writes are handled by the IndexedDB queue instead.
 *
 * ── Cache versioning ────────────────────────────────────────────────────────
 *
 * The cache name carries the build it belongs to, taken from the `?v=` on this script's own URL
 * (see RegisterServiceWorker). It used to be the hardcoded string `eyo-shell-v1`, which meant the
 * name never changed and so `activate` — which deletes every cache that is not the current one —
 * never had anything to delete. A deploy left the previous build's assets cached under the same
 * key, and cache-first served them.
 *
 * Because the version rides in the URL, a new build registers a *different* script, which is what
 * makes the browser install a new worker at all. A constant here plus a constant URL means the
 * browser has no reason to look at this file again for up to 24 hours.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `eyo-shell-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([OFFLINE_URL]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Every cache from an older build. Now that the name moves, this finally bites.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve an API response from cache — see the note above.
  if (url.pathname.startsWith('/api/')) return;

  // Build output and /textures both get cache-first: their contents never change for a given
  // URL. The textures matter offline — without them the page background loses its grain and
  // visibly changes tone, which reads as the app half-loading rather than working offline.
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/textures/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? caches.match(OFFLINE_URL)),
    );
  }
});

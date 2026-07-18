/*
 * App-shell cache so the portal opens when the network does not.
 *
 * Without this the offline write queue is useless on a reload: the teacher would face a browser
 * error page rather than the register. Deliberately conservative —
 *   - build assets are immutable, so cache-first
 *   - pages are network-first with a cached fallback, so nobody sees stale data while online
 *   - API calls are never cached; a stale balance or register is worse than an honest failure,
 *     and writes are handled by the IndexedDB queue instead.
 */
const CACHE = 'eyo-shell-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL])).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
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

  if (url.pathname.startsWith('/_next/static')) {
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

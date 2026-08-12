// Minimal offline support for the installed PWA. Without a service worker a
// standalone-launched app white-screens when offline — worse than a browser
// tab, because there's no URL bar to explain why.
//
// Strategy:
//   * /api/*      → never intercepted (always network).
//   * vendor/*    → stale-while-revalidate (multi-MB Stockfish wasm, piece
//                   sprites: serve the cache instantly, refresh it in the
//                   background so a deploy's new vendor files are picked up
//                   on the next load instead of being frozen forever).
//   * everything else (app shell, lib modules) → network-first with cache
//     fallback, so deploys are picked up immediately but the last good copy
//     still boots offline.

const CACHE_NAME = "chess-teacher-v2";
const PRECACHE = ["/", "/app.js", "/styles.css", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/vendor/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    // Serve instantly; the refresh keeps running in the background.
    refresh.catch(() => {});
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  throw new Error("offline and uncached");
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw error;
  }
}

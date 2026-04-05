// Minimal service worker for PWA installability and app shell caching.
// Does NOT cache audio streams — only static assets.

const CACHE_NAME = "crate-listen-v1";
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only cache GET requests for static assets, not API calls or streams
  if (request.method !== "GET") return;
  if (request.url.includes("/api/")) return;
  if (request.url.includes("/stream/")) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      // Network-first for navigation, cache-first for assets
      if (request.mode === "navigate") {
        return fetch(request).catch(() => cached || caches.match("/index.html"));
      }
      return cached || fetch(request);
    })
  );
});

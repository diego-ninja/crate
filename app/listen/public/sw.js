// App-shell caching + transparent offline mirror for canonical stream URLs.

const CACHE_NAME = "crate-listen-v1";
const OFFLINE_CACHE_PREFIX = "crate-listen-offline-media::";
const APP_SHELL = ["/", "/index.html"];
let activeOfflineProfile = null;

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
        names
          .filter((n) => n !== CACHE_NAME && !n.startsWith(OFFLINE_CACHE_PREFIX))
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "crate:set-offline-profile") {
    activeOfflineProfile = typeof data.profileKey === "string" && data.profileKey ? data.profileKey : null;
  }
});

function getOfflineCacheName() {
  return activeOfflineProfile ? `${OFFLINE_CACHE_PREFIX}${activeOfflineProfile}` : null;
}

function getOfflineStreamKey(requestUrl) {
  const url = new URL(requestUrl);
  if (!/\/api\/tracks\/by-storage\/[^/]+\/stream$/.test(url.pathname)) return null;
  return `${url.origin}${url.pathname}`;
}

async function buildRangeResponse(cachedResponse, rangeHeader) {
  const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader || "");
  if (!match) return cachedResponse;

  const buffer = await cachedResponse.arrayBuffer();
  const total = buffer.byteLength;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${total}`,
      },
    });
  }

  const chunk = buffer.slice(start, Math.min(end + 1, total));
  const headers = new Headers(cachedResponse.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(chunk.byteLength));
  headers.set("Content-Range", `bytes ${start}-${Math.min(end, total - 1)}/${total}`);

  return new Response(chunk, {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const offlineStreamKey = getOfflineStreamKey(request.url);
  if (offlineStreamKey) {
    event.respondWith((async () => {
      const cacheName = getOfflineCacheName();
      if (cacheName) {
        const cache = await caches.open(cacheName);
        const cached = await cache.match(offlineStreamKey);
        if (cached) {
          const rangeHeader = request.headers.get("range");
          if (rangeHeader) {
            return buildRangeResponse(cached, rangeHeader);
          }
          return cached;
        }
      }
      return fetch(request);
    })());
    return;
  }

  // Only cache GET requests for static assets, not general API calls.
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
